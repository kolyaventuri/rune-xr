import type {SceneObject, SceneSnapshot, Tile, TileSurfaceModel} from '@rune-xr/protocol'

const BENCHMARK_BASE_X = 3200
const BENCHMARK_BASE_Y = 3200
const BENCHMARK_PLANE = 0
const FLAT_TERRAIN_TEXTURE_ID = 12
const MODELED_TERRAIN_TEXTURE_ID = 13
const OBJECT_TEXTURE_ID = 1000
const OBJECT_GRID_COLUMNS = 15
const OBJECT_GRID_ROWS = 10
const OBJECT_MODEL_X_SEGMENTS = 16
const OBJECT_MODEL_Z_SEGMENTS = 8

type ObjectModel = NonNullable<SceneObject['model']>
type TileSurfaceFace = TileSurfaceModel['faces'][number]

export type MeshBenchmarkScenarioId =
  | 'large-flat-terrain'
  | 'modeled-terrain-seams'
  | 'model-heavy-objects'

export type MeshBenchmarkScenario = {
  id: MeshBenchmarkScenarioId;
  kind: 'terrain' | 'objects';
  label: string;
  summary: string;
  snapshot: SceneSnapshot;
  details: Record<string, number>;
}

export const meshBenchmarkScenarios = createMeshBenchmarkScenarios()

export function createMeshBenchmarkScenarios(): MeshBenchmarkScenario[] {
  return [
    createLargeFlatTerrainScenario(),
    createModeledTerrainScenario(),
    createModelHeavyObjectsScenario(),
  ]
}

function createLargeFlatTerrainScenario(): MeshBenchmarkScenario {
  const widthCells = 64
  const heightCells = 64
  const snapshot = createSnapshotWithTiles({
    widthCells,
    heightCells,
    tileFactory: (xIndex, yIndex) => ({
      x: BENCHMARK_BASE_X + xIndex,
      y: BENCHMARK_BASE_Y + yIndex,
      plane: BENCHMARK_PLANE,
      height: 0,
      surface: {texture: FLAT_TERRAIN_TEXTURE_ID},
    }),
  })

  return {
    id: 'large-flat-terrain',
    kind: 'terrain',
    label: 'Large Flat Terrain',
    summary: '64x64 textured flat cells to baseline terrain rebuild cost.',
    snapshot,
    details: {
      tiles: snapshot.tiles.length,
      cells: widthCells * heightCells,
      texturedCells: widthCells * heightCells,
    },
  }
}

function createModeledTerrainScenario(): MeshBenchmarkScenario {
  const widthCells = 32
  const heightCells = 32
  let modeledTiles = 0
  const snapshot = createSnapshotWithTiles({
    widthCells,
    heightCells,
    tileFactory: (xIndex, yIndex) => {
      const height = modeledTerrainHeightAt(xIndex, yIndex)
      const isCellTile = xIndex < widthCells && yIndex < heightCells
      const useModeledSurface = isCellTile && ((xIndex + yIndex) % 2 === 0)

      if (useModeledSurface) {
        modeledTiles += 1

        return {
          x: BENCHMARK_BASE_X + xIndex,
          y: BENCHMARK_BASE_Y + yIndex,
          plane: BENCHMARK_PLANE,
          height,
          surface: {
            texture: MODELED_TERRAIN_TEXTURE_ID,
            model: createModeledTileSurfaceModel(xIndex, yIndex),
          },
        }
      }

      const surface = isCellTile ? {texture: FLAT_TERRAIN_TEXTURE_ID} : undefined

      return surface
        ? {
          x: BENCHMARK_BASE_X + xIndex,
          y: BENCHMARK_BASE_Y + yIndex,
          plane: BENCHMARK_PLANE,
          height,
          surface,
        }
        : {
          x: BENCHMARK_BASE_X + xIndex,
          y: BENCHMARK_BASE_Y + yIndex,
          plane: BENCHMARK_PLANE,
          height,
        }
    },
  })

  return {
    id: 'modeled-terrain-seams',
    kind: 'terrain',
    label: 'Modeled Terrain Seams',
    summary: '32x32 cells with checkerboard modeled tiles and stitched boundaries.',
    snapshot,
    details: {
      tiles: snapshot.tiles.length,
      cells: widthCells * heightCells,
      modeledTiles,
    },
  }
}

function createModelHeavyObjectsScenario(): MeshBenchmarkScenario {
  const objectModel = createBenchmarkObjectModel()
  const snapshot = createSnapshotWithTiles({
    widthCells: OBJECT_GRID_COLUMNS,
    heightCells: OBJECT_GRID_ROWS,
    tileFactory: (xIndex, yIndex) => ({
      x: BENCHMARK_BASE_X + xIndex,
      y: BENCHMARK_BASE_Y + yIndex,
      plane: BENCHMARK_PLANE,
      height: Math.round(((xIndex % 3) + (yIndex % 2)) * 0.5),
    }),
  })

  snapshot.objects = createBenchmarkObjects(objectModel)

  return {
    id: 'model-heavy-objects',
    kind: 'objects',
    label: 'Model-Heavy Objects',
    summary: '150 objects sharing a 256-face model with mixed textured and colored faces.',
    snapshot,
    details: {
      tiles: snapshot.tiles.length,
      objects: snapshot.objects.length,
      facesPerObject: objectModel.faces.length,
      totalFaces: objectModel.faces.length * snapshot.objects.length,
    },
  }
}

function createSnapshotWithTiles({
  widthCells,
  heightCells,
  tileFactory,
}: {
  widthCells: number;
  heightCells: number;
  tileFactory: (xIndex: number, yIndex: number) => Tile;
}): SceneSnapshot {
  const tiles: Tile[] = []

  for (let xIndex = 0; xIndex <= widthCells; xIndex += 1) {
    for (let yIndex = 0; yIndex <= heightCells; yIndex += 1) {
      tiles.push(tileFactory(xIndex, yIndex))
    }
  }

  return {
    version: 1,
    timestamp: 1,
    baseX: BENCHMARK_BASE_X,
    baseY: BENCHMARK_BASE_Y,
    plane: BENCHMARK_PLANE,
    tiles,
    actors: [],
    objects: [],
  }
}

function modeledTerrainHeightAt(xIndex: number, yIndex: number) {
  return Math.round(
    18
    + (Math.sin(xIndex / 3) * 5)
    + (Math.cos(yIndex / 4) * 4)
    + (((xIndex * 7) + (yIndex * 3)) % 4),
  )
}

function createModeledTileSurfaceModel(xIndex: number, yIndex: number): TileSurfaceModel {
  const southWest = modeledTerrainHeightAt(xIndex, yIndex)
  const southEast = modeledTerrainHeightAt(xIndex + 1, yIndex)
  const northWest = modeledTerrainHeightAt(xIndex, yIndex + 1)
  const northEast = modeledTerrainHeightAt(xIndex + 1, yIndex + 1)
  const southMid = midpointHeight(southWest, southEast, boundaryOffset(xIndex, yIndex, 1))
  const eastMid = midpointHeight(southEast, northEast, boundaryOffset(xIndex, yIndex, 2))
  const northMid = midpointHeight(northWest, northEast, boundaryOffset(xIndex, yIndex, 3))
  const westMid = midpointHeight(southWest, northWest, boundaryOffset(xIndex, yIndex, 4))
  const center = Math.round((
    southWest
    + southEast
    + northWest
    + northEast
  ) / 4) + centerOffset(xIndex, yIndex)

  return {
    vertices: [
      {x: 0, y: southWest, z: 0},
      {x: 64, y: southMid, z: 0},
      {x: 128, y: southEast, z: 0},
      {x: 0, y: westMid, z: 64},
      {x: 64, y: center, z: 64},
      {x: 128, y: eastMid, z: 64},
      {x: 0, y: northWest, z: 128},
      {x: 64, y: northMid, z: 128},
      {x: 128, y: northEast, z: 128},
    ],
    faces: [
      {a: 0, b: 1, c: 4},
      {a: 0, b: 4, c: 3},
      {a: 1, b: 2, c: 5},
      {a: 1, b: 5, c: 4},
      {a: 3, b: 4, c: 7},
      {a: 3, b: 7, c: 6},
      {a: 4, b: 5, c: 8},
      {a: 4, b: 8, c: 7},
    ],
  }
}

function midpointHeight(start: number, end: number, offset: number) {
  return Math.round((start + end) / 2) + offset
}

function boundaryOffset(xIndex: number, yIndex: number, seed: number) {
  return (((xIndex * 11) + (yIndex * 17) + seed) % 5) - 2
}

function centerOffset(xIndex: number, yIndex: number) {
  return (((xIndex * 5) + (yIndex * 9)) % 7) - 3
}

function createBenchmarkObjectModel(): ObjectModel {
  const vertices: ObjectModel['vertices'] = []
  const faces: ObjectModel['faces'] = []

  for (let zIndex = 0; zIndex <= OBJECT_MODEL_Z_SEGMENTS; zIndex += 1) {
    for (let xIndex = 0; xIndex <= OBJECT_MODEL_X_SEGMENTS; xIndex += 1) {
      const xAlpha = xIndex / OBJECT_MODEL_X_SEGMENTS
      const zAlpha = zIndex / OBJECT_MODEL_Z_SEGMENTS
      const ridge = Math.sin(xAlpha * Math.PI) * Math.cos(zAlpha * Math.PI * 0.5)

      vertices.push({
        x: Math.round(xAlpha * 128),
        y: Math.round(18 + (ridge * 40) + (zAlpha * 10)),
        z: Math.round(zAlpha * 128),
      })
    }
  }

  for (let zIndex = 0; zIndex < OBJECT_MODEL_Z_SEGMENTS; zIndex += 1) {
    for (let xIndex = 0; xIndex < OBJECT_MODEL_X_SEGMENTS; xIndex += 1) {
      const southWest = objectVertexIndex(xIndex, zIndex)
      const southEast = objectVertexIndex(xIndex + 1, zIndex)
      const northWest = objectVertexIndex(xIndex, zIndex + 1)
      const northEast = objectVertexIndex(xIndex + 1, zIndex + 1)
      const texturedCell = ((xIndex + zIndex) % 2) === 0
      const color = objectFaceColor(xIndex, zIndex)
      const southU = xIndex / OBJECT_MODEL_X_SEGMENTS
      const eastU = (xIndex + 1) / OBJECT_MODEL_X_SEGMENTS
      const southV = zIndex / OBJECT_MODEL_Z_SEGMENTS
      const northV = (zIndex + 1) / OBJECT_MODEL_Z_SEGMENTS

      faces.push(createObjectFace(southWest, southEast, northWest, {
        textured: texturedCell,
        color,
        uA: southU,
        vA: southV,
        uB: eastU,
        vB: southV,
        uC: southU,
        vC: northV,
      }))
      faces.push(createObjectFace(southEast, northEast, northWest, {
        textured: texturedCell,
        color,
        uA: eastU,
        vA: southV,
        uB: eastU,
        vB: northV,
        uC: southU,
        vC: northV,
      }))
    }
  }

  return {vertices, faces}
}

function objectVertexIndex(xIndex: number, zIndex: number) {
  return (zIndex * (OBJECT_MODEL_X_SEGMENTS + 1)) + xIndex
}

function objectFaceColor(xIndex: number, zIndex: number) {
  const palette = [0x7f8b3a, 0x8e744a, 0xb98a58, 0xa36432]
  return palette[(xIndex + zIndex) % palette.length] ?? palette[0]!
}

function createObjectFace(
  a: number,
  b: number,
  c: number,
  {
    textured,
    color,
    uA,
    vA,
    uB,
    vB,
    uC,
    vC,
  }: {
    textured: boolean;
    color: number;
    uA: number;
    vA: number;
    uB: number;
    vB: number;
    uC: number;
    vC: number;
  },
): TileSurfaceFace {
  return {
    a,
    b,
    c,
    rgb: color,
    ...(textured ? {texture: OBJECT_TEXTURE_ID} : {}),
    uA,
    vA,
    uB,
    vB,
    uC,
    vC,
  }
}

function createBenchmarkObjects(model: ObjectModel): SceneObject[] {
  const objects: SceneObject[] = []

  for (let row = 0; row < OBJECT_GRID_ROWS; row += 1) {
    for (let column = 0; column < OBJECT_GRID_COLUMNS; column += 1) {
      objects.push({
        id: `benchmark-object-${column}-${row}`,
        kind: row % 3 === 0 ? 'decor' : 'game',
        name: 'Benchmark prop',
        x: BENCHMARK_BASE_X + column,
        y: BENCHMARK_BASE_Y + row,
        plane: BENCHMARK_PLANE,
        model,
      })
    }
  }

  return objects
}
