import type {SceneObject} from '@rune-xr/protocol'
import type {ObjectMeshBuildData, SceneMeshSnapshot, TerrainMeshBuildData} from './MeshBuildData.js'
import type {
  SceneMeshBuildWorkerRequest,
  SceneMeshBuildWorkerResponse,
} from './SceneMeshBuildWorkerProtocol.js'
import {buildObjectMeshData} from './ObjectMeshBuilder.js'
import {buildTerrainMeshData} from './TerrainMeshBuilder.js'

type MaybePromise<T> = Promise<T> | T

type PendingWorkerRequest =
  | {
    kind: 'build-terrain';
    snapshot: SceneMeshSnapshot;
    resolve: (data: TerrainMeshBuildData | ObjectMeshBuildData) => void;
    reject: (error?: unknown) => void;
  }
  | {
    kind: 'build-objects';
    snapshot: SceneMeshSnapshot;
    objects: SceneObject[];
    loadedTextureIds: number[];
    resolve: (data: TerrainMeshBuildData | ObjectMeshBuildData) => void;
    reject: (error?: unknown) => void;
  }

export type SceneMeshBuildRunner = {
  buildObjects: (
    snapshot: SceneMeshSnapshot,
    objects: SceneObject[],
    loadedTextureIds: number[],
  ) => MaybePromise<ObjectMeshBuildData>;
  buildTerrain: (snapshot: SceneMeshSnapshot) => MaybePromise<TerrainMeshBuildData>;
  destroy: () => void;
}

export function createSceneMeshBuildRunner(): SceneMeshBuildRunner {
  if (typeof Worker !== 'function') {
    return createInlineSceneMeshBuildRunner()
  }

  try {
    return new WorkerSceneMeshBuildRunner()
  } catch {
    return createInlineSceneMeshBuildRunner()
  }
}

function createInlineSceneMeshBuildRunner(): SceneMeshBuildRunner {
  return {
    buildTerrain(snapshot) {
      return buildTerrainMeshData(snapshot)
    },
    buildObjects(snapshot, objects, loadedTextureIds) {
      const loadedTextureIdSet = new Set(loadedTextureIds)

      return buildObjectMeshData(snapshot, objects, textureId => loadedTextureIdSet.has(textureId))
    },
    destroy() {},
  }
}

class WorkerSceneMeshBuildRunner implements SceneMeshBuildRunner {
  private readonly fallbackRunner = createInlineSceneMeshBuildRunner()
  private worker: Worker | undefined = new Worker(new URL('./SceneMeshBuildWorker.ts', import.meta.url), {type: 'module'})
  private nextRequestId = 0
  private readonly pendingRequests = new Map<number, PendingWorkerRequest>()
  private workerFailed = false

  constructor() {
    const worker = this.worker

    if (!worker) {
      throw new Error('Scene mesh worker was not created.')
    }

    worker.addEventListener('message', event => {
      this.handleWorkerMessage(event as MessageEvent<SceneMeshBuildWorkerResponse>)
    })
    worker.addEventListener('error', event => {
      this.switchToInlineRunner(event.error ?? new Error(event.message))
    })
    worker.addEventListener('messageerror', () => {
      this.switchToInlineRunner(new Error('Scene mesh worker could not deserialize a message.'))
    })
  }

  buildTerrain(snapshot: SceneMeshSnapshot) {
    if (!this.worker || this.workerFailed) {
      return this.fallbackRunner.buildTerrain(snapshot)
    }

    return new Promise<TerrainMeshBuildData>((resolve, reject) => {
      const requestId = this.allocateRequestId()
      const worker = this.worker

      if (!worker) {
        resolve(this.fallbackRunner.buildTerrain(snapshot) as TerrainMeshBuildData)
        return
      }

      this.pendingRequests.set(requestId, {
        kind: 'build-terrain',
        snapshot,
        resolve: data => resolve(data as TerrainMeshBuildData),
        reject,
      })

      try {
        worker.postMessage({
          kind: 'build-terrain',
          requestId,
          snapshot,
        } satisfies SceneMeshBuildWorkerRequest)
      } catch (error) {
        this.pendingRequests.delete(requestId)
        this.switchToInlineRunner(error)
        Promise.resolve(this.fallbackRunner.buildTerrain(snapshot)).then(resolve, reject)
      }
    })
  }

  buildObjects(snapshot: SceneMeshSnapshot, objects: SceneObject[], loadedTextureIds: number[]) {
    if (!this.worker || this.workerFailed) {
      return this.fallbackRunner.buildObjects(snapshot, objects, loadedTextureIds)
    }

    return new Promise<ObjectMeshBuildData>((resolve, reject) => {
      const requestId = this.allocateRequestId()
      const worker = this.worker

      if (!worker) {
        resolve(this.fallbackRunner.buildObjects(snapshot, objects, loadedTextureIds) as ObjectMeshBuildData)
        return
      }

      this.pendingRequests.set(requestId, {
        kind: 'build-objects',
        snapshot,
        objects,
        loadedTextureIds,
        resolve: data => resolve(data as ObjectMeshBuildData),
        reject,
      })

      try {
        worker.postMessage({
          kind: 'build-objects',
          requestId,
          snapshot,
          objects,
          loadedTextureIds,
        } satisfies SceneMeshBuildWorkerRequest)
      } catch (error) {
        this.pendingRequests.delete(requestId)
        this.switchToInlineRunner(error)
        Promise.resolve(this.fallbackRunner.buildObjects(snapshot, objects, loadedTextureIds)).then(resolve, reject)
      }
    })
  }

  destroy() {
    this.failPendingRequests(new Error('Scene mesh worker was terminated.'))
    this.worker?.terminate()
    this.worker = undefined
  }

  private handleWorkerMessage(event: MessageEvent<SceneMeshBuildWorkerResponse>) {
    const response = event.data
    const pendingRequest = this.pendingRequests.get(response.requestId)

    if (!pendingRequest) {
      return
    }

    this.pendingRequests.delete(response.requestId)
    pendingRequest.resolve(response.data)
  }

  private switchToInlineRunner(error: unknown) {
    if (this.workerFailed) {
      return
    }

    this.workerFailed = true
    this.worker?.terminate()
    this.worker = undefined

    const pendingRequests = [...this.pendingRequests.values()]
    this.pendingRequests.clear()

    console.warn('Scene mesh worker failed, falling back to inline mesh builds.', error)

    for (const pendingRequest of pendingRequests) {
      try {
        if (pendingRequest.kind === 'build-terrain') {
          pendingRequest.resolve(this.fallbackRunner.buildTerrain(pendingRequest.snapshot) as TerrainMeshBuildData)
          continue
        }

        pendingRequest.resolve(this.fallbackRunner.buildObjects(
          pendingRequest.snapshot,
          pendingRequest.objects,
          pendingRequest.loadedTextureIds,
        ) as ObjectMeshBuildData)
      } catch (fallbackError) {
        pendingRequest.reject(fallbackError)
      }
    }
  }

  private failPendingRequests(error: unknown) {
    for (const pendingRequest of this.pendingRequests.values()) {
      pendingRequest.reject(error)
    }

    this.pendingRequests.clear()
  }

  private allocateRequestId() {
    const requestId = this.nextRequestId + 1

    this.nextRequestId = requestId
    return requestId
  }
}
