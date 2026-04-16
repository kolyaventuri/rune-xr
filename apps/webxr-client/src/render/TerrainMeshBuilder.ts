import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import type {SceneSnapshot, Tile, TileSurfaceFace, TileSurfaceVertex} from '@rune-xr/protocol';
import {HEIGHT_SCALE, TILE_WORLD_SIZE} from '../config.js';

const LOCAL_TILE_SIZE = 128;
type TileMap = Map<string, Tile>;
type BoundarySide = 'west' | 'east' | 'south' | 'north';

export function buildTerrainMesh(snapshot: SceneSnapshot) {
  const geometry = buildTerrainGeometry(snapshot);
  const material = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    metalness: 0.02,
    roughness: 0.94,
  });
  const mesh = new Mesh(geometry, material);

  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

export function buildTerrainGeometry(snapshot: SceneSnapshot) {
  if (snapshot.tiles.length === 0) {
    return new BufferGeometry();
  }

  const tiles = new Map(snapshot.tiles.map(tile => [`${tile.x}:${tile.y}`, tile] as const));
  const xValues = [...new Set(snapshot.tiles.map(tile => tile.x))].sort((left, right) => left - right);
  const yValues = [...new Set(snapshot.tiles.map(tile => tile.y))].sort((left, right) => left - right);
  const maxY = Math.max(...yValues);
  const heights = snapshot.tiles.map(tile => tile.height);
  const minHeight = Math.min(...heights);
  const maxHeight = Math.max(...heights);
  const positions: number[] = [];
  const colors: number[] = [];

  for (let xIndex = 0; xIndex < xValues.length - 1; xIndex += 1) {
    for (let yIndex = 0; yIndex < yValues.length - 1; yIndex += 1) {
      const x = xValues[xIndex];
      const nextX = xValues[xIndex + 1];
      const y = yValues[yIndex];
      const nextY = yValues[yIndex + 1];

      if (x === undefined || nextX === undefined || y === undefined || nextY === undefined) {
        continue;
      }

      const a = tiles.get(`${x}:${y}`);
      const b = tiles.get(`${nextX}:${y}`);
      const c = tiles.get(`${x}:${nextY}`);
      const d = tiles.get(`${nextX}:${nextY}`);

      if (!a || !b || !c || !d) {
        continue;
      }

      if (a.surface?.model) {
        appendModeledTile(snapshot, maxY, a, tiles, positions, colors, minHeight, maxHeight);
        continue;
      }

      // Mirroring RuneScape north/south into board-space flips handedness on the
      // X/Z plane, so use the mirrored CCW order here to keep top faces visible.
      const quad = [
        a,
        b,
        c,
        b,
        d,
        c,
      ];

      for (const tile of quad) {
        positions.push(
          (tile.x - snapshot.baseX) * TILE_WORLD_SIZE,
          tile.height * HEIGHT_SCALE,
          toBoardZ(maxY, tile.y),
        );

        const color = resolveTileColor(tile, minHeight, maxHeight);

        colors.push(color.r, color.g, color.b);
      }
    }
  }

  const geometry = new BufferGeometry();

  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometry.computeVertexNormals();

  return geometry;
}

function normalize(value: number, min: number, max: number) {
  if (max === min) {
    return 0.5;
  }

  return (value - min) / (max - min);
}

function resolveTileColor(tile: Tile, minHeight: number, maxHeight: number) {
  if (tile.surface?.rgb !== undefined) {
    return new Color(tile.surface.rgb);
  }

  const alpha = normalize(tile.height, minHeight, maxHeight);
  return new Color('#4c8f58').lerp(new Color('#b8db76'), alpha);
}

function appendModeledTile(
  snapshot: SceneSnapshot,
  maxY: number,
  tile: Tile,
  tiles: TileMap,
  positions: number[],
  colors: number[],
  minHeight: number,
  maxHeight: number,
) {
  const model = tile.surface?.model;

  if (!model) {
    return;
  }

  for (const face of model.faces) {
    const a = model.vertices[face.a];
    const b = model.vertices[face.b];
    const c = model.vertices[face.c];

    if (!a || !b || !c) {
      continue;
    }

    const faceColor = resolveFaceColor(face, tile, minHeight, maxHeight);

    appendModelVertex(snapshot, maxY, tile, a, positions);
    colors.push(faceColor.r, faceColor.g, faceColor.b);
    appendModelVertex(snapshot, maxY, tile, b, positions);
    colors.push(faceColor.r, faceColor.g, faceColor.b);
    appendModelVertex(snapshot, maxY, tile, c, positions);
    colors.push(faceColor.r, faceColor.g, faceColor.b);
  }

  appendModeledTileStitches(snapshot, maxY, tile, tiles, positions, colors, minHeight, maxHeight);
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
  );
}

function resolveFaceColor(face: TileSurfaceFace, tile: Tile, minHeight: number, maxHeight: number) {
  if (face.rgb !== undefined) {
    return new Color(face.rgb);
  }

  return resolveTileColor(tile, minHeight, maxHeight);
}

function appendModeledTileStitches(
  snapshot: SceneSnapshot,
  maxY: number,
  tile: Tile,
  tiles: TileMap,
  positions: number[],
  colors: number[],
  minHeight: number,
  maxHeight: number,
) {
  const model = tile.surface?.model;

  if (!model) {
    return;
  }

  for (const edge of collectBoundaryEdges(model.vertices, model.faces)) {
    const startHeight = sampleGridEdgeHeight(tile, edge.side, edgeT(edge.start, edge.side), tiles);
    const endHeight = sampleGridEdgeHeight(tile, edge.side, edgeT(edge.end, edge.side), tiles);

    if (startHeight === undefined || endHeight === undefined) {
      continue;
    }

    if (startHeight === edge.start.y && endHeight === edge.end.y) {
      continue;
    }

    const seamColor = resolveSeamColor(tile, edge.side, tiles, minHeight, maxHeight);

    appendSeamQuad(
      snapshot,
      tile,
      edge.start,
      edge.end,
      {x: edge.start.x, y: startHeight, z: edge.start.z},
      {x: edge.end.x, y: endHeight, z: edge.end.z},
      seamColor,
      positions,
      colors,
      maxY,
    );
  }
}

function collectBoundaryEdges(vertices: TileSurfaceVertex[], faces: TileSurfaceFace[]) {
  const edges = new Map<string, {count: number; start: number; end: number}>();

  for (const face of faces) {
    for (const [start, end] of [[face.a, face.b], [face.b, face.c], [face.c, face.a]]) {
      const key = edgeKey(start, end);
      const existing = edges.get(key);

      if (existing) {
        existing.count += 1;
        continue;
      }

      edges.set(key, {count: 1, start, end});
    }
  }

  const boundaryEdges: Array<{start: TileSurfaceVertex; end: TileSurfaceVertex; side: BoundarySide}> = [];

  for (const edge of edges.values()) {
    if (edge.count !== 1) {
      continue;
    }

    const start = vertices[edge.start];
    const end = vertices[edge.end];

    if (!start || !end) {
      continue;
    }

    const side = classifyBoundarySide(start, end);

    if (!side) {
      continue;
    }

    boundaryEdges.push({start, end, side});
  }

  return boundaryEdges;
}

function edgeKey(start: number, end: number) {
  return start < end ? `${start}:${end}` : `${end}:${start}`;
}

function classifyBoundarySide(start: TileSurfaceVertex, end: TileSurfaceVertex): BoundarySide | undefined {
  if (start.x === 0 && end.x === 0) {
    return 'west';
  }

  if (start.x === LOCAL_TILE_SIZE && end.x === LOCAL_TILE_SIZE) {
    return 'east';
  }

  if (start.z === 0 && end.z === 0) {
    return 'south';
  }

  if (start.z === LOCAL_TILE_SIZE && end.z === LOCAL_TILE_SIZE) {
    return 'north';
  }

  return undefined;
}

function edgeT(vertex: TileSurfaceVertex, side: BoundarySide) {
  if (side === 'west' || side === 'east') {
    return vertex.z / LOCAL_TILE_SIZE;
  }

  return vertex.x / LOCAL_TILE_SIZE;
}

function sampleGridEdgeHeight(tile: Tile, side: BoundarySide, t: number, tiles: TileMap) {
  const [startTile, endTile] = edgeHeightTiles(tile, side, tiles) ?? [];

  if (!startTile || !endTile) {
    return undefined;
  }

  return startTile.height + (endTile.height - startTile.height) * t;
}

function edgeHeightTiles(tile: Tile, side: BoundarySide, tiles: TileMap) {
  switch (side) {
    case 'west':
      return [
        tiles.get(tileKey(tile.x, tile.y)),
        tiles.get(tileKey(tile.x, tile.y + 1)),
      ] as const;
    case 'east':
      return [
        tiles.get(tileKey(tile.x + 1, tile.y)),
        tiles.get(tileKey(tile.x + 1, tile.y + 1)),
      ] as const;
    case 'south':
      return [
        tiles.get(tileKey(tile.x, tile.y)),
        tiles.get(tileKey(tile.x + 1, tile.y)),
      ] as const;
    case 'north':
      return [
        tiles.get(tileKey(tile.x, tile.y + 1)),
        tiles.get(tileKey(tile.x + 1, tile.y + 1)),
      ] as const;
  }
}

function resolveSeamColor(
  tile: Tile,
  side: BoundarySide,
  tiles: TileMap,
  minHeight: number,
  maxHeight: number,
) {
  const baseColor = resolveTileColor(tile, minHeight, maxHeight);
  const neighbor = neighborTile(tile, side, tiles);

  if (!neighbor) {
    return baseColor;
  }

  return baseColor.clone().lerp(resolveTileColor(neighbor, minHeight, maxHeight), 0.5);
}

function neighborTile(tile: Tile, side: BoundarySide, tiles: TileMap) {
  switch (side) {
    case 'west':
      return tiles.get(tileKey(tile.x - 1, tile.y));
    case 'east':
      return tiles.get(tileKey(tile.x + 1, tile.y));
    case 'south':
      return tiles.get(tileKey(tile.x, tile.y - 1));
    case 'north':
      return tiles.get(tileKey(tile.x, tile.y + 1));
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
  positions: number[],
  colors: number[],
  maxY: number,
) {
  appendLocalTriangle(snapshot, maxY, tile, start, end, startTarget, color, positions, colors);
  appendLocalTriangle(snapshot, maxY, tile, end, endTarget, startTarget, color, positions, colors);

  // Duplicate the seam with reversed winding so steep transition faces stay
  // visible from either side of the stitched edge.
  appendLocalTriangle(snapshot, maxY, tile, startTarget, end, start, color, positions, colors);
  appendLocalTriangle(snapshot, maxY, tile, startTarget, endTarget, end, color, positions, colors);
}

function appendLocalTriangle(
  snapshot: SceneSnapshot,
  maxY: number,
  tile: Tile,
  a: TileSurfaceVertex,
  b: TileSurfaceVertex,
  c: TileSurfaceVertex,
  color: Color,
  positions: number[],
  colors: number[],
) {
  appendModelVertex(snapshot, maxY, tile, a, positions);
  colors.push(color.r, color.g, color.b);
  appendModelVertex(snapshot, maxY, tile, b, positions);
  colors.push(color.r, color.g, color.b);
  appendModelVertex(snapshot, maxY, tile, c, positions);
  colors.push(color.r, color.g, color.b);
}

function tileKey(x: number, y: number) {
  return `${x}:${y}`;
}

function toBoardZ(maxY: number, worldY: number) {
  return (maxY - worldY) * TILE_WORLD_SIZE;
}
