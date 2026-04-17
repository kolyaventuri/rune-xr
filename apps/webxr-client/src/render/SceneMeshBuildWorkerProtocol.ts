import type {SceneObject} from '@rune-xr/protocol'
import type {ObjectMeshBuildData, SceneMeshSnapshot, TerrainMeshBuildData} from './MeshBuildData.js'

export type SceneMeshBuildWorkerRequest =
  | {
    kind: 'build-terrain';
    requestId: number;
    snapshot: SceneMeshSnapshot;
  }
  | {
    kind: 'build-objects';
    requestId: number;
    snapshot: SceneMeshSnapshot;
    objects: SceneObject[];
    loadedTextureIds: number[];
  }

export type SceneMeshBuildWorkerResponse =
  | {
    kind: 'terrain-built';
    requestId: number;
    data: TerrainMeshBuildData;
  }
  | {
    kind: 'objects-built';
    requestId: number;
    data: ObjectMeshBuildData;
  }
