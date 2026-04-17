/// <reference lib="webworker" />

import {buildObjectMeshData} from './ObjectMeshBuilder.js'
import {
  collectObjectMeshBuildTransfers,
  collectTerrainMeshBuildTransfers,
} from './MeshBuildData.js'
import type {
  SceneMeshBuildWorkerRequest,
  SceneMeshBuildWorkerResponse,
} from './SceneMeshBuildWorkerProtocol.js'
import {buildTerrainMeshData} from './TerrainMeshBuilder.js'

declare const self: DedicatedWorkerGlobalScope

self.addEventListener('message', event => {
  const message = event.data as SceneMeshBuildWorkerRequest

  if (message.kind === 'build-terrain') {
    const data = buildTerrainMeshData(message.snapshot)
    const response: SceneMeshBuildWorkerResponse = {
      kind: 'terrain-built',
      requestId: message.requestId,
      data,
    }

    self.postMessage(response, collectTerrainMeshBuildTransfers(data))
    return
  }

  const loadedTextureIds = new Set(message.loadedTextureIds)
  const data = buildObjectMeshData(
    message.snapshot,
    message.objects,
    textureId => loadedTextureIds.has(textureId),
  )
  const response: SceneMeshBuildWorkerResponse = {
    kind: 'objects-built',
    requestId: message.requestId,
    data,
  }

  self.postMessage(response, collectObjectMeshBuildTransfers(data))
})
