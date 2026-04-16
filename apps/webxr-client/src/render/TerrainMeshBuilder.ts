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
        appendModeledTile(snapshot, a, positions, colors, minHeight, maxHeight);
        continue;
      }

      // Keep the terrain triangles wound counter-clockwise when viewed from above
      // so the generated normals point upward and the top faces are rendered.
      const quad = [
        a,
        c,
        b,
        b,
        c,
        d,
      ];

      for (const tile of quad) {
        positions.push(
          (tile.x - snapshot.baseX) * TILE_WORLD_SIZE,
          tile.height * HEIGHT_SCALE,
          (tile.y - snapshot.baseY) * TILE_WORLD_SIZE,
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
  tile: Tile,
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

    // The RuneLite model Y axis is inverted before we emit into Three.js Y-up
    // space, which flips triangle handedness. Swap the last two vertices so
    // modeled tiles remain front-facing from above.
    appendModelVertex(snapshot, tile, a, positions);
    colors.push(faceColor.r, faceColor.g, faceColor.b);
    appendModelVertex(snapshot, tile, c, positions);
    colors.push(faceColor.r, faceColor.g, faceColor.b);
    appendModelVertex(snapshot, tile, b, positions);
    colors.push(faceColor.r, faceColor.g, faceColor.b);
  }
}

function appendModelVertex(snapshot: SceneSnapshot, tile: Tile, vertex: TileSurfaceVertex, positions: number[]) {
  positions.push(
    (tile.x - snapshot.baseX + vertex.x / LOCAL_TILE_SIZE) * TILE_WORLD_SIZE,
    vertex.y * HEIGHT_SCALE,
    (tile.y - snapshot.baseY + vertex.z / LOCAL_TILE_SIZE) * TILE_WORLD_SIZE,
  );
}

function resolveFaceColor(face: TileSurfaceFace, tile: Tile, minHeight: number, maxHeight: number) {
  if (face.rgb !== undefined) {
    return new Color(face.rgb);
  }

  return resolveTileColor(tile, minHeight, maxHeight);
}
