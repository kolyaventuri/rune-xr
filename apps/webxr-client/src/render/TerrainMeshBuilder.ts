import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  type Texture,
} from 'three'
import type {SceneSnapshot, Tile, TileSurfaceModel} from '@rune-xr/protocol'
import {HEIGHT_SCALE, TILE_WORLD_SIZE} from '../config.js'
import {getTerrainTextureSlotBounds, isTerrainTextureId} from './TerrainTextureAtlas.js'

const LOCAL_TILE_SIZE = 128
type TileMap = Map<string, Tile>
type BoundarySide = 'west' | 'east' | 'south' | 'north'
type TileSurfaceFace = TileSurfaceModel['faces'][number]
type TileSurfaceVertex = TileSurfaceModel['vertices'][number]
type BoundaryEdge = {start: TileSurfaceVertex; end: TileSurfaceVertex; side: BoundarySide}
type BoundaryProfile = {kind: 'grid'} | {kind: 'modeled'; edges: BoundaryEdge[]; side: BoundarySide}
type BoundaryEdgeCache = Map<string, BoundaryEdge[]>
type GeometryBuffers = {
  positions: number[];
  colors: number[];
  uvs: number[];
}

const TRIANGLE_EPSILON = 1e-6
const EDGE_EPSILON = 1e-6

export function buildTerrainMeshes(snapshot: SceneSnapshot, terrainTextureAtlas: Texture) {
  const {colorGeometry, texturedGeometry} = buildTerrainGeometries(snapshot)
  const colorMaterial = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    metalness: 0.02,
    roughness: 0.94,
    side: DoubleSide,
  })
  const colorMesh = new Mesh(colorGeometry, colorMaterial)

  colorMesh.name = 'terrain-color'
  colorMesh.receiveShadow = true
  colorMesh.castShadow = false

  const texturedPositionAttribute = texturedGeometry.getAttribute('position')
  const texturedMesh = texturedPositionAttribute && texturedPositionAttribute.count > 0
    ? new Mesh(texturedGeometry, new MeshStandardMaterial({
      map: terrainTextureAtlas,
      flatShading: true,
      metalness: 0.02,
      roughness: 0.9,
      side: DoubleSide,
      transparent: true,
      alphaTest: 0.01,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }))
    : undefined

  if (texturedMesh) {
    texturedMesh.name = 'terrain-texture'
    texturedMesh.receiveShadow = true
    texturedMesh.castShadow = false
    texturedMesh.renderOrder = 1
  }

  return {colorMesh, texturedMesh}
}

export function buildTerrainGeometry(snapshot: SceneSnapshot) {
  return buildTerrainGeometries(snapshot).colorGeometry
}

export function buildTexturedTerrainGeometry(snapshot: SceneSnapshot) {
  return buildTerrainGeometries(snapshot).texturedGeometry
}

function buildTerrainGeometries(snapshot: SceneSnapshot) {
  if (snapshot.tiles.length === 0) {
    return {
      colorGeometry: new BufferGeometry(),
      texturedGeometry: new BufferGeometry(),
    }
  }

  const tiles = new Map(snapshot.tiles.map(tile => [`${tile.x}:${tile.y}`, tile] as const))
  const xValues = [...new Set(snapshot.tiles.map(tile => tile.x))].sort((left, right) => left - right)
  const yValues = [...new Set(snapshot.tiles.map(tile => tile.y))].sort((left, right) => left - right)
  const maxY = Math.max(...yValues)
  const heights = snapshot.tiles.map(tile => tile.height)
  const minHeight = Math.min(...heights)
  const maxHeight = Math.max(...heights)
  const colorBuffers = createGeometryBuffers()
  const texturedBuffers = createGeometryBuffers()
  const boundaryEdges = new Map<string, BoundaryEdge[]>()

  for (let xIndex = 0; xIndex < xValues.length - 1; xIndex += 1) {
    for (let yIndex = 0; yIndex < yValues.length - 1; yIndex += 1) {
      const x = xValues[xIndex]
      const nextX = xValues[xIndex + 1]
      const y = yValues[yIndex]
      const nextY = yValues[yIndex + 1]

      if (x === undefined || nextX === undefined || y === undefined || nextY === undefined) {
        continue
      }

      const a = tiles.get(`${x}:${y}`)
      const b = tiles.get(`${nextX}:${y}`)
      const c = tiles.get(`${x}:${nextY}`)
      const d = tiles.get(`${nextX}:${nextY}`)

      if (!a || !b || !c || !d) {
        continue
      }

      if (a.surface?.model) {
        appendModeledTile(
          snapshot,
          maxY,
          a,
          tiles,
          colorBuffers,
          texturedBuffers,
          minHeight,
          maxHeight,
          boundaryEdges,
        )
        continue
      }

      appendFlatTile(snapshot, maxY, a, b, c, d, colorBuffers, texturedBuffers, minHeight, maxHeight)
    }
  }

  return {
    colorGeometry: buildColorGeometry(colorBuffers),
    texturedGeometry: buildTexturedGeometry(texturedBuffers),
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

function appendFlatTile(
  snapshot: SceneSnapshot,
  maxY: number,
  a: Tile,
  b: Tile,
  c: Tile,
  d: Tile,
  colorBuffers: GeometryBuffers,
  texturedBuffers: GeometryBuffers,
  minHeight: number,
  maxHeight: number,
) {
  // Mirroring RuneScape north/south into board-space flips handedness on the
  // X/Z plane, so use the mirrored CCW order here to keep top faces visible.
  const quad = [a, b, c, b, d, c]

  for (const tile of quad) {
    colorBuffers.positions.push(
      (tile.x - snapshot.baseX) * TILE_WORLD_SIZE,
      tile.height * HEIGHT_SCALE,
      toBoardZ(maxY, tile.y),
    )

    const color = resolveTileColor(tile, minHeight, maxHeight)

    colorBuffers.colors.push(color.r, color.g, color.b)
  }

  const textureId = resolveTileTexture(a)

  if (textureId === undefined) {
    return
  }

  const localA = {x: 0, y: a.height, z: 0}
  const localB = {x: LOCAL_TILE_SIZE, y: b.height, z: 0}
  const localC = {x: 0, y: c.height, z: LOCAL_TILE_SIZE}
  const localD = {x: LOCAL_TILE_SIZE, y: d.height, z: LOCAL_TILE_SIZE}

  appendTexturedTriangle(snapshot, maxY, a, localA, localB, localC, textureId, texturedBuffers)
  appendTexturedTriangle(snapshot, maxY, a, localB, localD, localC, textureId, texturedBuffers)
}

function normalize(value: number, min: number, max: number) {
  if (max === min) {
    return 0.5
  }

  return (value - min) / (max - min)
}

function resolveTileColor(tile: Tile, minHeight: number, maxHeight: number) {
  if (tile.surface?.rgb !== undefined) {
    return new Color(tile.surface.rgb)
  }

  const alpha = normalize(tile.height, minHeight, maxHeight)
  return new Color('#4c8f58').lerp(new Color('#b8db76'), alpha)
}

function resolveTileTexture(tile: Tile) {
  const textureId = tile.surface?.texture
  return isTerrainTextureId(textureId) ? textureId : undefined
}

function resolveFaceTexture(face: TileSurfaceFace, tile: Tile) {
  const textureId = face.texture ?? tile.surface?.texture
  return isTerrainTextureId(textureId) ? textureId : undefined
}

function appendModeledTile(
  snapshot: SceneSnapshot,
  maxY: number,
  tile: Tile,
  tiles: TileMap,
  colorBuffers: GeometryBuffers,
  texturedBuffers: GeometryBuffers,
  minHeight: number,
  maxHeight: number,
  boundaryEdges: BoundaryEdgeCache,
) {
  const model = tile.surface?.model

  if (!model) {
    return
  }

  for (const face of model.faces) {
    const a = model.vertices[face.a]
    const b = model.vertices[face.b]
    const c = model.vertices[face.c]

    if (!a || !b || !c) {
      continue
    }

    const faceColor = resolveFaceColor(face, tile, minHeight, maxHeight)

    appendLocalTriangle(
      snapshot,
      maxY,
      tile,
      a,
      b,
      c,
      faceColor,
      colorBuffers,
      {preferUpward: true},
    )

    const textureId = resolveFaceTexture(face, tile)

    if (textureId !== undefined) {
      appendTexturedTriangle(
        snapshot,
        maxY,
        tile,
        a,
        b,
        c,
        textureId,
        texturedBuffers,
        {preferUpward: true},
      )
    }
  }

  appendModeledTileStitches(
    snapshot,
    maxY,
    tile,
    tiles,
    colorBuffers,
    texturedBuffers,
    minHeight,
    maxHeight,
    boundaryEdges,
  )
}

function appendModelVertex(
  snapshot: SceneSnapshot,
  maxY: number,
  tile: Tile,
  vertex: TileSurfaceVertex,
  positions: number[],
) {
  positions.push(
    (tile.x - snapshot.baseX + vertex.x / LOCAL_TILE_SIZE) * TILE_WORLD_SIZE,
    vertex.y * HEIGHT_SCALE,
    toBoardZ(maxY, tile.y + vertex.z / LOCAL_TILE_SIZE),
  )
}

function appendModelUv(vertex: TileSurfaceVertex, textureId: number, uvs: number[]) {
  const bounds = getTerrainTextureSlotBounds(textureId)

  if (!bounds) {
    return
  }

  const uAlpha = clamp01(vertex.x / LOCAL_TILE_SIZE)
  const vAlpha = clamp01(vertex.z / LOCAL_TILE_SIZE)

  uvs.push(
    bounds.uMin + ((bounds.uMax - bounds.uMin) * uAlpha),
    bounds.vMin + ((bounds.vMax - bounds.vMin) * vAlpha),
  )
}

function resolveFaceColor(face: TileSurfaceFace, tile: Tile, minHeight: number, maxHeight: number) {
  if (face.rgb !== undefined) {
    return new Color(face.rgb)
  }

  return resolveTileColor(tile, minHeight, maxHeight)
}

function appendModeledTileStitches(
  snapshot: SceneSnapshot,
  maxY: number,
  tile: Tile,
  tiles: TileMap,
  colorBuffers: GeometryBuffers,
  texturedBuffers: GeometryBuffers,
  minHeight: number,
  maxHeight: number,
  boundaryEdges: BoundaryEdgeCache,
) {
  const model = tile.surface?.model

  if (!model) {
    return
  }

  const seamTextureId = resolveTileTexture(tile)

  for (const edge of boundaryEdgesForTile(tile, boundaryEdges)) {
    const profile = resolveBoundaryProfile(tile, edge.side, tiles, boundaryEdges)

    if (profile.kind === 'modeled' && !ownsSharedModeledBoundary(edge.side)) {
      continue
    }

    const seamColor = resolveSeamColor(tile, edge.side, tiles, minHeight, maxHeight)

    for (const [startT, endT] of collectBoundaryIntervals(edge, profile)) {
      const start = interpolateBoundaryVertex(edge.start, edge.end, edge.side, startT)
      const end = interpolateBoundaryVertex(edge.start, edge.end, edge.side, endT)
      const startHeight = sampleBoundaryProfileHeight(tile, edge.side, startT, tiles, profile)
      const endHeight = sampleBoundaryProfileHeight(tile, edge.side, endT, tiles, profile)

      if (startHeight === undefined || endHeight === undefined) {
        continue
      }

      const startTarget = {x: start.x, y: startHeight, z: start.z}
      const endTarget = {x: end.x, y: endHeight, z: end.z}

      if (verticesMatch(start, startTarget) && verticesMatch(end, endTarget)) {
        continue
      }

      appendSeamQuad(
        snapshot,
        tile,
        start,
        end,
        startTarget,
        endTarget,
        seamColor,
        colorBuffers,
        maxY,
      )

      if (seamTextureId !== undefined) {
        appendTexturedSeamQuad(
          snapshot,
          tile,
          start,
          end,
          startTarget,
          endTarget,
          seamTextureId,
          texturedBuffers,
          maxY,
        )
      }
    }
  }
}

function boundaryEdgesForTile(tile: Tile, cache: BoundaryEdgeCache) {
  const cached = cache.get(tileKey(tile.x, tile.y))

  if (cached) {
    return cached
  }

  const model = tile.surface?.model
  const edges = model ? collectBoundaryEdges(model.vertices, model.faces) : []

  cache.set(tileKey(tile.x, tile.y), edges)
  return edges
}

function collectBoundaryEdges(vertices: TileSurfaceVertex[], faces: TileSurfaceFace[]) {
  const edges = new Map<string, {count: number; start: number; end: number}>()

  for (const face of faces) {
    const faceEdges: Array<[number, number]> = [
      [face.a, face.b],
      [face.b, face.c],
      [face.c, face.a],
    ]

    for (const [start, end] of faceEdges) {
      const key = edgeKey(start, end)
      const existing = edges.get(key)

      if (existing) {
        existing.count += 1
        continue
      }

      edges.set(key, {count: 1, start, end})
    }
  }

  const boundaryEdges: Array<{start: TileSurfaceVertex; end: TileSurfaceVertex; side: BoundarySide}> = []

  for (const edge of edges.values()) {
    if (edge.count !== 1) {
      continue
    }

    const start = vertices[edge.start]
    const end = vertices[edge.end]

    if (!start || !end) {
      continue
    }

    const side = classifyBoundarySide(start, end)

    if (!side) {
      continue
    }

    boundaryEdges.push({start, end, side})
  }

  return boundaryEdges
}

function resolveBoundaryProfile(
  tile: Tile,
  side: BoundarySide,
  tiles: TileMap,
  boundaryEdges: BoundaryEdgeCache,
): BoundaryProfile {
  const neighbor = neighborTile(tile, side, tiles)

  if (!neighbor?.surface?.model) {
    return {kind: 'grid'}
  }

  const oppositeSide = oppositeBoundarySide(side)
  const edges = boundaryEdgesForTile(neighbor, boundaryEdges).filter(edge => edge.side === oppositeSide)

  if (edges.length === 0) {
    return {kind: 'grid'}
  }

  return {kind: 'modeled', edges, side: oppositeSide}
}

function oppositeBoundarySide(side: BoundarySide): BoundarySide {
  switch (side) {
    case 'west':
      return 'east'
    case 'east':
      return 'west'
    case 'south':
      return 'north'
    case 'north':
      return 'south'
  }
}

function ownsSharedModeledBoundary(side: BoundarySide) {
  return side === 'east' || side === 'north'
}

function edgeKey(start: number, end: number) {
  return start < end ? `${start}:${end}` : `${end}:${start}`
}

function classifyBoundarySide(start: TileSurfaceVertex, end: TileSurfaceVertex): BoundarySide | undefined {
  if (start.x === 0 && end.x === 0) {
    return 'west'
  }

  if (start.x === LOCAL_TILE_SIZE && end.x === LOCAL_TILE_SIZE) {
    return 'east'
  }

  if (start.z === 0 && end.z === 0) {
    return 'south'
  }

  if (start.z === LOCAL_TILE_SIZE && end.z === LOCAL_TILE_SIZE) {
    return 'north'
  }

  return undefined
}

function edgeT(vertex: TileSurfaceVertex, side: BoundarySide) {
  if (side === 'west' || side === 'east') {
    return vertex.z / LOCAL_TILE_SIZE
  }

  return vertex.x / LOCAL_TILE_SIZE
}

function sampleGridEdgeHeight(tile: Tile, side: BoundarySide, t: number, tiles: TileMap) {
  const [startTile, endTile] = edgeHeightTiles(tile, side, tiles) ?? []

  if (!startTile || !endTile) {
    return undefined
  }

  return startTile.height + ((endTile.height - startTile.height) * t)
}

function collectBoundaryIntervals(edge: BoundaryEdge, profile: BoundaryProfile) {
  const startT = edgeT(edge.start, edge.side)
  const endT = edgeT(edge.end, edge.side)
  const direction = Math.sign(endT - startT) || 1
  const minT = Math.min(startT, endT) - EDGE_EPSILON
  const maxT = Math.max(startT, endT) + EDGE_EPSILON
  const splitPoints = [startT, endT]

  if (profile.kind === 'modeled') {
    for (const boundaryEdge of profile.edges) {
      pushSplitPoint(splitPoints, edgeT(boundaryEdge.start, profile.side), minT, maxT)
      pushSplitPoint(splitPoints, edgeT(boundaryEdge.end, profile.side), minT, maxT)
    }
  }

  splitPoints.sort((left, right) => direction > 0 ? left - right : right - left)

  const intervals: Array<[number, number]> = []

  for (let index = 0; index < splitPoints.length - 1; index += 1) {
    const segmentStart = splitPoints[index]
    const segmentEnd = splitPoints[index + 1]

    if (segmentStart === undefined || segmentEnd === undefined || Math.abs(segmentEnd - segmentStart) <= EDGE_EPSILON) {
      continue
    }

    intervals.push([segmentStart, segmentEnd])
  }

  return intervals
}

function pushSplitPoint(points: number[], value: number, min: number, max: number) {
  if (value < min || value > max) {
    return
  }

  if (points.some(existing => Math.abs(existing - value) <= EDGE_EPSILON)) {
    return
  }

  points.push(value)
}

function sampleBoundaryProfileHeight(
  tile: Tile,
  side: BoundarySide,
  t: number,
  tiles: TileMap,
  profile: BoundaryProfile,
) {
  if (profile.kind === 'grid') {
    return sampleGridEdgeHeight(tile, side, t, tiles)
  }

  return sampleModeledBoundaryHeight(profile.edges, profile.side, t) ?? sampleGridEdgeHeight(tile, side, t, tiles)
}

function sampleModeledBoundaryHeight(edges: BoundaryEdge[], side: BoundarySide, t: number) {
  for (const edge of edges) {
    const startT = edgeT(edge.start, side)
    const endT = edgeT(edge.end, side)
    const minT = Math.min(startT, endT) - EDGE_EPSILON
    const maxT = Math.max(startT, endT) + EDGE_EPSILON

    if (t < minT || t > maxT) {
      continue
    }

    const span = endT - startT

    if (Math.abs(span) <= EDGE_EPSILON) {
      return edge.start.y
    }

    const alpha = clamp01((t - startT) / span)
    return edge.start.y + ((edge.end.y - edge.start.y) * alpha)
  }
}

function interpolateBoundaryVertex(
  start: TileSurfaceVertex,
  end: TileSurfaceVertex,
  side: BoundarySide,
  t: number,
): TileSurfaceVertex {
  const startT = edgeT(start, side)
  const endT = edgeT(end, side)
  const span = endT - startT

  if (Math.abs(span) <= EDGE_EPSILON) {
    return start
  }

  const alpha = clamp01((t - startT) / span)
  return {
    x: start.x + ((end.x - start.x) * alpha),
    y: start.y + ((end.y - start.y) * alpha),
    z: start.z + ((end.z - start.z) * alpha),
  }
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function verticesMatch(left: TileSurfaceVertex, right: TileSurfaceVertex) {
  return Math.abs(left.x - right.x) <= EDGE_EPSILON
    && Math.abs(left.y - right.y) <= EDGE_EPSILON
    && Math.abs(left.z - right.z) <= EDGE_EPSILON
}

function edgeHeightTiles(tile: Tile, side: BoundarySide, tiles: TileMap) {
  switch (side) {
    case 'west':
      return [
        tiles.get(tileKey(tile.x, tile.y)),
        tiles.get(tileKey(tile.x, tile.y + 1)),
      ] as const
    case 'east':
      return [
        tiles.get(tileKey(tile.x + 1, tile.y)),
        tiles.get(tileKey(tile.x + 1, tile.y + 1)),
      ] as const
    case 'south':
      return [
        tiles.get(tileKey(tile.x, tile.y)),
        tiles.get(tileKey(tile.x + 1, tile.y)),
      ] as const
    case 'north':
      return [
        tiles.get(tileKey(tile.x, tile.y + 1)),
        tiles.get(tileKey(tile.x + 1, tile.y + 1)),
      ] as const
  }
}

function resolveSeamColor(
  tile: Tile,
  side: BoundarySide,
  tiles: TileMap,
  minHeight: number,
  maxHeight: number,
) {
  const baseColor = resolveTileColor(tile, minHeight, maxHeight)
  const neighbor = neighborTile(tile, side, tiles)

  if (!neighbor) {
    return baseColor
  }

  return baseColor.clone().lerp(resolveTileColor(neighbor, minHeight, maxHeight), 0.5)
}

function neighborTile(tile: Tile, side: BoundarySide, tiles: TileMap) {
  switch (side) {
    case 'west':
      return tiles.get(tileKey(tile.x - 1, tile.y))
    case 'east':
      return tiles.get(tileKey(tile.x + 1, tile.y))
    case 'south':
      return tiles.get(tileKey(tile.x, tile.y - 1))
    case 'north':
      return tiles.get(tileKey(tile.x, tile.y + 1))
  }
}

function appendSeamQuad(
  snapshot: SceneSnapshot,
  tile: Tile,
  start: TileSurfaceVertex,
  end: TileSurfaceVertex,
  startTarget: TileSurfaceVertex,
  endTarget: TileSurfaceVertex,
  color: Color,
  colorBuffers: GeometryBuffers,
  maxY: number,
) {
  appendLocalTriangle(snapshot, maxY, tile, start, end, startTarget, color, colorBuffers)
  appendLocalTriangle(snapshot, maxY, tile, end, endTarget, startTarget, color, colorBuffers)
}

function appendTexturedSeamQuad(
  snapshot: SceneSnapshot,
  tile: Tile,
  start: TileSurfaceVertex,
  end: TileSurfaceVertex,
  startTarget: TileSurfaceVertex,
  endTarget: TileSurfaceVertex,
  textureId: number,
  texturedBuffers: GeometryBuffers,
  maxY: number,
) {
  appendTexturedTriangle(snapshot, maxY, tile, start, end, startTarget, textureId, texturedBuffers)
  appendTexturedTriangle(snapshot, maxY, tile, end, endTarget, startTarget, textureId, texturedBuffers)
}

function appendLocalTriangle(
  snapshot: SceneSnapshot,
  maxY: number,
  tile: Tile,
  a: TileSurfaceVertex,
  b: TileSurfaceVertex,
  c: TileSurfaceVertex,
  color: Color,
  colorBuffers: GeometryBuffers,
  options?: {preferUpward?: boolean},
) {
  const [first, second, third] = orientTriangle(a, b, c, options)

  if (isDegenerateTriangle(first, second, third)) {
    return
  }

  appendModelVertex(snapshot, maxY, tile, first, colorBuffers.positions)
  colorBuffers.colors.push(color.r, color.g, color.b)
  appendModelVertex(snapshot, maxY, tile, second, colorBuffers.positions)
  colorBuffers.colors.push(color.r, color.g, color.b)
  appendModelVertex(snapshot, maxY, tile, third, colorBuffers.positions)
  colorBuffers.colors.push(color.r, color.g, color.b)
}

function appendTexturedTriangle(
  snapshot: SceneSnapshot,
  maxY: number,
  tile: Tile,
  a: TileSurfaceVertex,
  b: TileSurfaceVertex,
  c: TileSurfaceVertex,
  textureId: number,
  texturedBuffers: GeometryBuffers,
  options?: {preferUpward?: boolean},
) {
  const [first, second, third] = orientTriangle(a, b, c, options)

  if (isDegenerateTriangle(first, second, third)) {
    return
  }

  appendModelVertex(snapshot, maxY, tile, first, texturedBuffers.positions)
  appendModelUv(first, textureId, texturedBuffers.uvs)
  appendModelVertex(snapshot, maxY, tile, second, texturedBuffers.positions)
  appendModelUv(second, textureId, texturedBuffers.uvs)
  appendModelVertex(snapshot, maxY, tile, third, texturedBuffers.positions)
  appendModelUv(third, textureId, texturedBuffers.uvs)
}

function orientTriangle(
  a: TileSurfaceVertex,
  b: TileSurfaceVertex,
  c: TileSurfaceVertex,
  options?: {preferUpward?: boolean},
) {
  if (!options?.preferUpward) {
    return [a, b, c] as const
  }

  return triangleNormal(a, b, c).y < 0 ? [a, c, b] as const : [a, b, c] as const
}

function isDegenerateTriangle(a: TileSurfaceVertex, b: TileSurfaceVertex, c: TileSurfaceVertex) {
  const normal = triangleNormal(a, b, c)
  return (normal.x ** 2) + (normal.y ** 2) + (normal.z ** 2) <= TRIANGLE_EPSILON
}

function triangleNormal(a: TileSurfaceVertex, b: TileSurfaceVertex, c: TileSurfaceVertex) {
  const ux = b.x - a.x
  const uy = b.y - a.y
  const uz = a.z - b.z
  const vx = c.x - a.x
  const vy = c.y - a.y
  const vz = a.z - c.z

  return {
    x: (uy * vz) - (uz * vy),
    y: (uz * vx) - (ux * vz),
    z: (ux * vy) - (uy * vx),
  }
}

function tileKey(x: number, y: number) {
  return `${x}:${y}`
}

function toBoardZ(maxY: number, worldY: number) {
  return (maxY - worldY) * TILE_WORLD_SIZE
}
