import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  Mesh,
  type Texture,
} from 'three'
import type {SceneObject, SceneSnapshot} from '@rune-xr/protocol'
import {HEIGHT_SCALE, TILE_WORLD_SIZE} from '../config.js'
import {isObjectTextureId} from './TerrainTextureAtlas.js'

const LOCAL_TILE_SIZE = 128
type ObjectModel = NonNullable<SceneObject['model']>
type ObjectVertex = ObjectModel['vertices'][number]
type ObjectFace = ObjectModel['faces'][number]

type GeometryBuffers = {
  positions: number[];
  colors: number[];
  uvs: number[];
}

export function buildObjectMeshes(
  snapshot: SceneSnapshot,
  objects: SceneObject[],
  getObjectTexture: (textureId: number) => Texture | undefined,
  hasObjectTexture: (textureId: number) => boolean,
) {
  const maxY = Math.max(snapshot.baseY, ...snapshot.tiles.map(tile => tile.y))
  const colorBuffers = createGeometryBuffers()
  const texturedBuffersByTexture = new Map<number, GeometryBuffers>()

  for (const object of objects) {
    appendObject(object, snapshot, maxY, colorBuffers, texturedBuffersByTexture, hasObjectTexture)
  }

  const colorGeometry = buildColorGeometry(colorBuffers)

  const colorMesh = new Mesh(colorGeometry, new MeshBasicMaterial({
    vertexColors: true,
    side: DoubleSide,
  }))

  colorMesh.name = 'object-color'
  colorMesh.castShadow = true
  colorMesh.receiveShadow = true

  const texturedMeshes: Mesh[] = []

  for (const [textureId, buffers] of texturedBuffersByTexture) {
    const texturedGeometry = buildTexturedGeometry(buffers)
    const texturedPositionAttribute = texturedGeometry.getAttribute('position')

    if (!texturedPositionAttribute || texturedPositionAttribute.count === 0) {
      continue
    }

    const texture = getObjectTexture(textureId)

    if (!texture) {
      continue
    }

    const texturedMesh = new Mesh(texturedGeometry, new MeshBasicMaterial({
      map: texture,
      vertexColors: true,
      side: DoubleSide,
      alphaTest: 0.01,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      depthWrite: false,
    }))

    texturedMesh.name = 'object-texture'
    texturedMesh.castShadow = true
    texturedMesh.receiveShadow = true
    texturedMesh.renderOrder = 2
    texturedMesh.userData.textureId = textureId
    texturedMeshes.push(texturedMesh)
  }

  return {colorMesh, texturedMeshes}
}

function appendObject(
  object: SceneObject,
  snapshot: SceneSnapshot,
  maxY: number,
  colorBuffers: GeometryBuffers,
  texturedBuffersByTexture: Map<number, GeometryBuffers>,
  hasObjectTexture: (textureId: number) => boolean,
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

    const textureId = isObjectTextureId(face.texture) ? face.texture : undefined
    const textureLoaded = textureId !== undefined && hasObjectTexture(textureId)

    if (!textureLoaded) {
      appendColorVertex(snapshot, maxY, object, a, colorBuffers, resolveFaceVertexColor(face, 'A', fallbackColor))
      appendColorVertex(snapshot, maxY, object, b, colorBuffers, resolveFaceVertexColor(face, 'B', fallbackColor))
      appendColorVertex(snapshot, maxY, object, c, colorBuffers, resolveFaceVertexColor(face, 'C', fallbackColor))
      continue
    }

    const texturedBuffers = getTextureBuffers(texturedBuffersByTexture, textureId)

    appendTexturedVertex(snapshot, maxY, object, a, texturedBuffers, face, resolveFaceVertexColor(face, 'A', fallbackColor), 'A')
    appendTexturedVertex(snapshot, maxY, object, b, texturedBuffers, face, resolveFaceVertexColor(face, 'B', fallbackColor), 'B')
    appendTexturedVertex(snapshot, maxY, object, c, texturedBuffers, face, resolveFaceVertexColor(face, 'C', fallbackColor), 'C')
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
  color: Color,
  suffix: 'A' | 'B' | 'C',
) {
  appendPosition(snapshot, maxY, object, vertex, buffers.positions)
  appendUv(face, buffers.uvs, suffix)
  buffers.colors.push(color.r, color.g, color.b)
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

function appendUv(face: ObjectFace, uvs: number[], suffix: 'A' | 'B' | 'C') {
  const [u, v] = faceUvs(face, suffix)

  uvs.push(u, v)
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

function resolveFaceVertexColor(face: ObjectFace, suffix: 'A' | 'B' | 'C', fallbackColor: Color) {
  const rgb = switchFaceVertexRgb(face, suffix)

  if (rgb !== undefined) {
    return new Color(rgb)
  }

  if (face.rgb !== undefined) {
    return new Color(face.rgb)
  }

  return fallbackColor
}

function switchFaceVertexRgb(face: ObjectFace, suffix: 'A' | 'B' | 'C') {
  switch (suffix) {
    case 'A':
      return face.rgbA
    case 'B':
      return face.rgbB
    case 'C':
      return face.rgbC
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

function getTextureBuffers(texturedBuffersByTexture: Map<number, GeometryBuffers>, textureId: number) {
  let buffers = texturedBuffersByTexture.get(textureId)

  if (!buffers) {
    buffers = createGeometryBuffers()
    texturedBuffersByTexture.set(textureId, buffers)
  }

  return buffers
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
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(buffers.colors), 3))
  geometry.computeVertexNormals()

  return geometry
}
