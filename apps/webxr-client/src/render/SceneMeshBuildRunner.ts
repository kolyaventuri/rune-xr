import type {SceneObject} from '@rune-xr/protocol'
import type {ObjectMeshBuildData, SceneMeshSnapshot, TerrainMeshBuildData} from './MeshBuildData.js'
import type {
  SceneMeshBuildWorkerRequest,
  SceneMeshBuildWorkerResponse,
} from './SceneMeshBuildWorkerProtocol.js'
import {buildObjectMeshData} from './ObjectMeshBuilder.js'
import {buildTerrainMeshData} from './TerrainMeshBuilder.js'

type MaybePromise<T> = Promise<T> | T

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
  private readonly worker = new Worker(new URL('./SceneMeshBuildWorker.ts', import.meta.url), {type: 'module'})
  private nextRequestId = 0
  private readonly pendingRequests = new Map<number, {
    resolve: (data: ObjectMeshBuildData | TerrainMeshBuildData) => void;
    reject: (error?: unknown) => void;
  }>()

  constructor() {
    this.worker.addEventListener('message', event => {
      this.handleWorkerMessage(event as MessageEvent<SceneMeshBuildWorkerResponse>)
    })
    this.worker.addEventListener('error', event => {
      this.failPendingRequests(event.error ?? new Error(event.message))
    })
    this.worker.addEventListener('messageerror', () => {
      this.failPendingRequests(new Error('Scene mesh worker could not deserialize a message.'))
    })
  }

  buildTerrain(snapshot: SceneMeshSnapshot) {
    return new Promise<TerrainMeshBuildData>((resolve, reject) => {
      const requestId = this.allocateRequestId()

      this.pendingRequests.set(requestId, {
        resolve: data => resolve(data as TerrainMeshBuildData),
        reject,
      })
      this.worker.postMessage({
        kind: 'build-terrain',
        requestId,
        snapshot,
      } satisfies SceneMeshBuildWorkerRequest)
    })
  }

  buildObjects(snapshot: SceneMeshSnapshot, objects: SceneObject[], loadedTextureIds: number[]) {
    return new Promise<ObjectMeshBuildData>((resolve, reject) => {
      const requestId = this.allocateRequestId()

      this.pendingRequests.set(requestId, {
        resolve: data => resolve(data as ObjectMeshBuildData),
        reject,
      })
      this.worker.postMessage({
        kind: 'build-objects',
        requestId,
        snapshot,
        objects,
        loadedTextureIds,
      } satisfies SceneMeshBuildWorkerRequest)
    })
  }

  destroy() {
    this.failPendingRequests(new Error('Scene mesh worker was terminated.'))
    this.worker.terminate()
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
