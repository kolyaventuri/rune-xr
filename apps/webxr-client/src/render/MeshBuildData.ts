import {BufferAttribute, BufferGeometry} from 'three'
import type {SceneSnapshot} from '@rune-xr/protocol'

export type SceneMeshSnapshot = Pick<SceneSnapshot, 'baseX' | 'baseY' | 'tiles'>

export type GeometryBuildData = {
  positions: Float32Array;
  normals: Float32Array;
  colors?: Float32Array;
  uvs?: Float32Array;
}

export type TerrainMeshBuildData = {
  color?: GeometryBuildData;
  textured?: GeometryBuildData;
  bridge?: GeometryBuildData;
}

export type ObjectMeshBuildData = {
  color?: GeometryBuildData;
  textured: Array<{
    textureId: number;
    geometry: GeometryBuildData;
  }>;
}

export function createBufferGeometryFromBuildData(data?: GeometryBuildData) {
  const geometry = new BufferGeometry()

  if (!data) {
    return geometry
  }

  geometry.setAttribute('position', new BufferAttribute(data.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(data.normals, 3))

  if (data.colors) {
    geometry.setAttribute('color', new BufferAttribute(data.colors, 3))
  }

  if (data.uvs) {
    geometry.setAttribute('uv', new BufferAttribute(data.uvs, 2))
  }

  return geometry
}

export function extractGeometryBuildData(geometry: BufferGeometry) {
  const positions = geometry.getAttribute('position')

  if (!positions || positions.count === 0) {
    return undefined
  }

  const normals = geometry.getAttribute('normal')
  const colors = geometry.getAttribute('color')
  const uvs = geometry.getAttribute('uv')
  const data: GeometryBuildData = {
    positions: positions.array as Float32Array,
    normals: normals
      ? normals.array as Float32Array
      : new Float32Array((positions.array as Float32Array).length),
  }

  if (colors) {
    data.colors = colors.array as Float32Array
  }

  if (uvs) {
    data.uvs = uvs.array as Float32Array
  }

  return data
}

export function collectTerrainMeshBuildTransfers(data: TerrainMeshBuildData) {
  return [
    ...collectGeometryBuildTransfers(data.color),
    ...collectGeometryBuildTransfers(data.textured),
    ...collectGeometryBuildTransfers(data.bridge),
  ]
}

export function collectObjectMeshBuildTransfers(data: ObjectMeshBuildData) {
  return [
    ...collectGeometryBuildTransfers(data.color),
    ...data.textured.flatMap(({geometry}) => collectGeometryBuildTransfers(geometry)),
  ]
}

function collectGeometryBuildTransfers(data?: GeometryBuildData) {
  if (!data) {
    return [] as Transferable[]
  }

  const transfers: Transferable[] = [data.positions.buffer, data.normals.buffer]

  if (data.colors) {
    transfers.push(data.colors.buffer)
  }

  if (data.uvs) {
    transfers.push(data.uvs.buffer)
  }

  return transfers
}
