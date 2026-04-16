import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  type Texture,
} from 'three'
import type {SceneObject, SceneSnapshot} from '@rune-xr/protocol'
import {HEIGHT_SCALE, TILE_WORLD_SIZE} from '../config.js'
import {getTerrainTextureSlotBounds, isTerrainTextureId} from './TerrainTextureAtlas.js'

const LOCAL_TILE_SIZE = 128
type ObjectModel = NonNullable<SceneObject['model']>
type ObjectVertex = ObjectModel['vertices'][number]
type ObjectFace = ObjectModel['faces'][number]

type GeometryBuffers = {
  positions: number[];
  colors: number[];
  uvs: number[];
}

export function buildObjectMeshes(snapshot: SceneSnapshot, objects: SceneObject[], terrainTextureAtlas: Texture) {
  const maxY = Math.max(snapshot.baseY, ...snapshot.tiles.map(tile => tile.y))
  const colorBuffers = createGeometryBuffers()
  const texturedBuffers = createGeometryBuffers()

  for (const object of objects) {
    appendObject(object, snapshot, maxY, colorBuffers, texturedBuffers)
  }

  const colorGeometry = buildColorGeometry(colorBuffers)
  const texturedGeometry = buildTexturedGeometry(texturedBuffers)

  const colorMesh = new Mesh(colorGeometry, new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    metalness: 0.06,
    roughness: 0.92,
    side: DoubleSide,
  }))

  colorMesh.name = 'object-color'
  colorMesh.castShadow = true
  colorMesh.receiveShadow = true

  const texturedPositionAttribute = texturedGeometry.getAttribute('position')
  const texturedMesh = texturedPositionAttribute && texturedPositionAttribute.count > 0
    ? new Mesh(texturedGeometry, new MeshStandardMaterial({
      map: terrainTextureAtlas,
      flatShading: true,
      metalness: 0.06,
      roughness: 0.88,
      side: DoubleSide,
      transparent: true,
      alphaTest: 0.01,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }))
    : undefined

  if (texturedMesh) {
    texturedMesh.name = 'object-texture'
    texturedMesh.castShadow = true
    texturedMesh.receiveShadow = true
    texturedMesh.renderOrder = 2
  }

  return {colorMesh, texturedMesh}
}

function appendObject(
  object: SceneObject,
  snapshot: SceneSnapshot,
  maxY: number,
  colorBuffers: GeometryBuffers,
  texturedBuffers: GeometryBuffers,
) {
  const model = object.model

  if (!model) {
    return
  }

  const fallbackColor = defaultObjectColor(object)

  for (const face of model.faces) {
    const a = model.vertices[face.a]
    const b = model.vertices[face.b]
    const c = model.vertices[face.c]

    if (!a || !b || !c) {
      continue
    }

    const faceColor = face.rgb === undefined ? fallbackColor : new Color(face.rgb)

    appendColorVertex(snapshot, maxY, object, a, colorBuffers, faceColor)
    appendColorVertex(snapshot, maxY, object, b, colorBuffers, faceColor)
    appendColorVertex(snapshot, maxY, object, c, colorBuffers, faceColor)

    if (!isTerrainTextureId(face.texture)) {
      continue
    }

    appendTexturedVertex(snapshot, maxY, object, a, texturedBuffers, face, face.texture, 'A')
    appendTexturedVertex(snapshot, maxY, object, b, texturedBuffers, face, face.texture, 'B')
    appendTexturedVertex(snapshot, maxY, object, c, texturedBuffers, face, face.texture, 'C')
  }
}

function appendColorVertex(
  snapshot: SceneSnapshot,
  maxY: number,
  object: SceneObject,
  vertex: ObjectVertex,
  buffers: GeometryBuffers,
  color: Color,
) {
  appendPosition(snapshot, maxY, object, vertex, buffers.positions)
  buffers.colors.push(color.r, color.g, color.b)
}

function appendTexturedVertex(
  snapshot: SceneSnapshot,
  maxY: number,
  object: SceneObject,
  vertex: ObjectVertex,
  buffers: GeometryBuffers,
  face: ObjectFace,
  textureId: number,
  suffix: 'A' | 'B' | 'C',
) {
  appendPosition(snapshot, maxY, object, vertex, buffers.positions)
  appendUv(face, textureId, buffers.uvs, suffix)
}

function appendPosition(
  snapshot: SceneSnapshot,
  maxY: number,
  object: SceneObject,
  vertex: ObjectVertex,
  positions: number[],
) {
  positions.push(
    (object.x - snapshot.baseX + vertex.x / LOCAL_TILE_SIZE) * TILE_WORLD_SIZE,
    vertex.y * HEIGHT_SCALE,
    (maxY - (object.y + vertex.z / LOCAL_TILE_SIZE)) * TILE_WORLD_SIZE,
  )
}

function appendUv(face: ObjectFace, textureId: number, uvs: number[], suffix: 'A' | 'B' | 'C') {
  const bounds = getTerrainTextureSlotBounds(textureId)

  if (!bounds) {
    return
  }

  const [u, v] = faceUvs(face, suffix)

  uvs.push(
    bounds.uMin + ((bounds.uMax - bounds.uMin) * u),
    bounds.vMin + ((bounds.vMax - bounds.vMin) * v),
  )
}

function faceUvs(face: ObjectFace, suffix: 'A' | 'B' | 'C') {
  switch (suffix) {
    case 'A':
      return [face.uA ?? 0, face.vA ?? 0] as const
    case 'B':
      return [face.uB ?? 1, face.vB ?? 0] as const
    case 'C':
      return [face.uC ?? 0, face.vC ?? 1] as const
  }
}

function defaultObjectColor(object: SceneObject) {
  switch (object.kind) {
    case 'wall':
      return new Color('#766d62')
    case 'decor':
      return new Color('#d17a2b')
    case 'ground':
      return new Color('#86664f')
    default:
      return new Color('#8e744a')
  }
}

function createGeometryBuffers(): GeometryBuffers {
  return {
    positions: [],
    colors: [],
    uvs: [],
  }
}

function buildColorGeometry(buffers: GeometryBuffers) {
  const geometry = new BufferGeometry()

  if (buffers.positions.length === 0) {
    return geometry
  }

  geometry.setAttribute('position', new BufferAttribute(new Float32Array(buffers.positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(buffers.colors), 3))
  geometry.computeVertexNormals()

  return geometry
}

function buildTexturedGeometry(buffers: GeometryBuffers) {
  const geometry = new BufferGeometry()

  if (buffers.positions.length === 0) {
    return geometry
  }

  geometry.setAttribute('position', new BufferAttribute(new Float32Array(buffers.positions), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(buffers.uvs), 2))
  geometry.computeVertexNormals()

  return geometry
}
