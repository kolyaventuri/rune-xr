import {Color, Texture} from 'three';
import {describe, expect, it} from 'vitest';
import type {SceneSnapshot} from '@rune-xr/protocol';
import {buildTerrainGeometry, buildTerrainMeshes, buildTexturedTerrainGeometry} from '../render/TerrainMeshBuilder.js';

describe('TerrainMeshBuilder', () => {
  it('builds upward-facing normals for flat terrain quads', () => {
    const snapshot: SceneSnapshot = {
      version: 1,
      timestamp: 1,
      baseX: 3200,
      baseY: 3200,
      plane: 0,
      tiles: [
        {
          x: 3200, y: 3200, plane: 0, height: 0,
        },
        {
          x: 3201, y: 3200, plane: 0, height: 0,
        },
        {
          x: 3200, y: 3201, plane: 0, height: 0,
        },
        {
          x: 3201, y: 3201, plane: 0, height: 0,
        },
      ],
      actors: [],
      objects: [],
    };

    const geometry = buildTerrainGeometry(snapshot);
    const normals = geometry.getAttribute('normal');

    expect(normals.count).toBe(6);

    for (let index = 0; index < normals.count; index += 1) {
      expect(normals.getY(index)).toBeCloseTo(1, 5);
      expect(Math.abs(normals.getX(index))).toBeLessThan(1e-5);
      expect(Math.abs(normals.getZ(index))).toBeLessThan(1e-5);
    }
  });

  it('prefers RuneLite surface rgb metadata when present', () => {
    const snapshot: SceneSnapshot = {
      version: 1,
      timestamp: 1,
      baseX: 3200,
      baseY: 3200,
      plane: 0,
      tiles: [
        {
          x: 3200, y: 3200, plane: 0, height: 0, surface: {rgb: 0x3366cc},
        },
        {
          x: 3201, y: 3200, plane: 0, height: 0, surface: {rgb: 0x3366cc},
        },
        {
          x: 3200, y: 3201, plane: 0, height: 0, surface: {rgb: 0x3366cc},
        },
        {
          x: 3201, y: 3201, plane: 0, height: 0, surface: {rgb: 0x3366cc},
        },
      ],
      actors: [],
      objects: [],
    };

    const geometry = buildTerrainGeometry(snapshot);
    const colors = geometry.getAttribute('color');
    const expected = new Color(0x3366cc);

    expect(colors.getX(0)).toBeCloseTo(expected.r, 5);
    expect(colors.getY(0)).toBeCloseTo(expected.g, 5);
    expect(colors.getZ(0)).toBeCloseTo(expected.b, 5);
  });

  it('renders a raised bridge deck above the base terrain', () => {
    const snapshot: SceneSnapshot = {
      version: 1,
      timestamp: 1,
      baseX: 3200,
      baseY: 3200,
      plane: 0,
      tiles: [
        {
          x: 3200, y: 3200, plane: 0, height: 0, surface: {rgb: 0x3366cc, hasBridge: true, bridgeHeight: 30},
        },
        {
          x: 3201, y: 3200, plane: 0, height: 0, surface: {rgb: 0x3366cc, hasBridge: true, bridgeHeight: 30},
        },
        {
          x: 3200, y: 3201, plane: 0, height: 0, surface: {rgb: 0x3366cc, hasBridge: true, bridgeHeight: 30},
        },
        {
          x: 3201, y: 3201, plane: 0, height: 0, surface: {rgb: 0x3366cc, hasBridge: true, bridgeHeight: 30},
        },
      ],
      actors: [],
      objects: [],
    };

    const terrain = buildTerrainMeshes(snapshot, new Texture());
    const baseColors = terrain.colorMesh.geometry.getAttribute('color');
    const basePositions = terrain.colorMesh.geometry.getAttribute('position');
    const bridgeGeometry = terrain.bridgeDeckMesh?.geometry;
    const bridgeColors = bridgeGeometry?.getAttribute('color');
    const bridgePositions = bridgeGeometry?.getAttribute('position');
    const bridgeColor = new Color('#6f675c');
    const waterColor = new Color(0x3366cc);

    expect(basePositions.count).toBe(6);
    expect(basePositions.getY(0)).toBeCloseTo(0, 5);
    expect(baseColors.getX(0)).toBeCloseTo(waterColor.r, 5);
    expect(baseColors.getY(0)).toBeCloseTo(waterColor.g, 5);
    expect(baseColors.getZ(0)).toBeCloseTo(waterColor.b, 5);
    expect(bridgePositions?.count).toBe(6);
    expect(bridgePositions?.getY(0)).toBeCloseTo(30 * 0.0025, 5);
    expect(bridgeColors?.getX(0)).toBeCloseTo(bridgeColor.r, 5);
    expect(bridgeColors?.getY(0)).toBeCloseTo(bridgeColor.g, 5);
    expect(bridgeColors?.getZ(0)).toBeCloseTo(bridgeColor.b, 5);
  });

  it('keeps bridge deck cells at deck height when neighboring corners fall back to river height', () => {
    const snapshot: SceneSnapshot = {
      version: 1,
      timestamp: 1,
      baseX: 3200,
      baseY: 3200,
      plane: 0,
      tiles: [
        {
          x: 3200, y: 3200, plane: 0, height: 0, surface: {rgb: 0x3366cc, hasBridge: true, bridgeHeight: 30},
        },
        {
          x: 3201, y: 3200, plane: 0, height: 0, surface: {rgb: 0x3366cc},
        },
        {
          x: 3200, y: 3201, plane: 0, height: 0, surface: {rgb: 0x3366cc},
        },
        {
          x: 3201, y: 3201, plane: 0, height: 0, surface: {rgb: 0x3366cc},
        },
      ],
      actors: [],
      objects: [],
    };

    const terrain = buildTerrainMeshes(snapshot, new Texture());
    const bridgePositions = terrain.bridgeDeckMesh?.geometry.getAttribute('position');

    expect(bridgePositions?.count).toBe(6);

    for (let index = 0; index < (bridgePositions?.count ?? 0); index += 1) {
      expect(bridgePositions?.getY(index)).toBeCloseTo(30 * 0.0025, 5);
    }
  });

  it('builds textured flat terrain UVs from tile texture ids', () => {
    const snapshot: SceneSnapshot = {
      version: 1,
      timestamp: 1,
      baseX: 3200,
      baseY: 3200,
      plane: 0,
      tiles: [
        {
          x: 3200, y: 3200, plane: 0, height: 0, surface: {texture: 12},
        },
        {
          x: 3201, y: 3200, plane: 0, height: 0,
        },
        {
          x: 3200, y: 3201, plane: 0, height: 0,
        },
        {
          x: 3201, y: 3201, plane: 0, height: 0,
        },
      ],
      actors: [],
      objects: [],
    };

    const geometry = buildTexturedTerrainGeometry(snapshot);
    const positions = geometry.getAttribute('position');
    const uvs = geometry.getAttribute('uv');

    expect(positions.count).toBe(6);
    expect(uvs.count).toBe(6);
    expect(uvs.getX(0)).toBeCloseTo(12 / 16, 5);
    expect(uvs.getY(0)).toBeCloseTo(0, 5);
    expect(uvs.getX(1)).toBeCloseTo(13 / 16, 5);
    expect(uvs.getY(2)).toBeCloseTo(1 / 16, 5);
  });

  it('renders shaped tile models with their own face triangles', () => {
    const snapshot: SceneSnapshot = {
      version: 1,
      timestamp: 1,
      baseX: 3200,
      baseY: 3200,
      plane: 0,
      tiles: [
        {
          x: 3200,
          y: 3200,
          plane: 0,
          height: 0,
          surface: {
            rgb: 0x3366cc,
            model: {
              vertices: [
                {x: 0, y: 0, z: 0},
                {x: 128, y: 0, z: 0},
                {x: 0, y: 0, z: 128},
              ],
              faces: [
                {a: 0, b: 1, c: 2, rgb: 0x3366cc},
              ],
            },
          },
        },
        {
          x: 3201, y: 3200, plane: 0, height: 0,
        },
        {
          x: 3200, y: 3201, plane: 0, height: 0,
        },
        {
          x: 3201, y: 3201, plane: 0, height: 0,
        },
      ],
      actors: [],
      objects: [],
    };

    const geometry = buildTerrainGeometry(snapshot);
    const positions = geometry.getAttribute('position');
    const colors = geometry.getAttribute('color');
    const expected = new Color(0x3366cc);

    expect(positions.count).toBe(3);
    expect(positions.getX(0)).toBeCloseTo(0, 5);
    expect(positions.getZ(0)).toBeCloseTo(0.04, 5);
    expect(positions.getX(1)).toBeCloseTo(0.04, 5);
    expect(positions.getZ(2)).toBeCloseTo(0, 5);
    expect(colors.getX(0)).toBeCloseTo(expected.r, 5);
    expect(colors.getY(0)).toBeCloseTo(expected.g, 5);
    expect(colors.getZ(0)).toBeCloseTo(expected.b, 5);
  });

  it('builds textured modeled tile faces with slot-relative UVs', () => {
    const snapshot: SceneSnapshot = {
      version: 1,
      timestamp: 1,
      baseX: 3200,
      baseY: 3200,
      plane: 0,
      tiles: [
        {
          x: 3200,
          y: 3200,
          plane: 0,
          height: 0,
          surface: {
            model: {
              vertices: [
                {x: 0, y: 0, z: 0},
                {x: 128, y: 0, z: 0},
                {x: 0, y: 0, z: 128},
              ],
              faces: [
                {a: 0, b: 1, c: 2, texture: 3},
              ],
            },
          },
        },
        {
          x: 3201, y: 3200, plane: 0, height: 0,
        },
        {
          x: 3200, y: 3201, plane: 0, height: 0,
        },
        {
          x: 3201, y: 3201, plane: 0, height: 0,
        },
      ],
      actors: [],
      objects: [],
    };

    const geometry = buildTexturedTerrainGeometry(snapshot);
    const uvs = geometry.getAttribute('uv');

    expect(uvs.count).toBe(3);
    expect(uvs.getX(0)).toBeCloseTo(3 / 16, 5);
    expect(uvs.getY(0)).toBeCloseTo(0, 5);
    expect(uvs.getX(1)).toBeCloseTo(4 / 16, 5);
    expect(uvs.getY(2)).toBeCloseTo(1 / 16, 5);
  });

  it('maps larger world Y values toward smaller board Z values', () => {
    const snapshot: SceneSnapshot = {
      version: 1,
      timestamp: 1,
      baseX: 3200,
      baseY: 3200,
      plane: 0,
      tiles: [
        {
          x: 3200, y: 3200, plane: 0, height: 0,
        },
        {
          x: 3201, y: 3200, plane: 0, height: 0,
        },
        {
          x: 3200, y: 3201, plane: 0, height: 0,
        },
        {
          x: 3201, y: 3201, plane: 0, height: 0,
        },
      ],
      actors: [],
      objects: [],
    };

    const geometry = buildTerrainGeometry(snapshot);
    const positions = geometry.getAttribute('position');
    const zValues = Array.from({length: positions.count}, (_, index) => positions.getZ(index));

    expect(Math.min(...zValues)).toBeCloseTo(0, 5);
    expect(Math.max(...zValues)).toBeCloseTo(0.04, 5);
  });

  it('keeps modeled tile normals facing upward', () => {
    const snapshot: SceneSnapshot = {
      version: 1,
      timestamp: 1,
      baseX: 3200,
      baseY: 3200,
      plane: 0,
      tiles: [
        {
          x: 3200,
          y: 3200,
          plane: 0,
          height: 0,
          surface: {
            model: {
              vertices: [
                {x: 0, y: 0, z: 0},
                {x: 128, y: 0, z: 0},
                {x: 0, y: 0, z: 128},
              ],
              faces: [
                {a: 0, b: 1, c: 2},
              ],
            },
          },
        },
        {
          x: 3201, y: 3200, plane: 0, height: 0,
        },
        {
          x: 3200, y: 3201, plane: 0, height: 0,
        },
        {
          x: 3201, y: 3201, plane: 0, height: 0,
        },
      ],
      actors: [],
      objects: [],
    };

    const geometry = buildTerrainGeometry(snapshot);
    const normals = geometry.getAttribute('normal');

    expect(normals.count).toBe(3);
    expect(normals.getY(0)).toBeCloseTo(1, 5);
    expect(Math.abs(normals.getX(0))).toBeLessThan(1e-5);
    expect(Math.abs(normals.getZ(0))).toBeLessThan(1e-5);
  });

  it('reorients modeled tile faces that arrive with downward winding', () => {
    const snapshot: SceneSnapshot = {
      version: 1,
      timestamp: 1,
      baseX: 3200,
      baseY: 3200,
      plane: 0,
      tiles: [
        {
          x: 3200,
          y: 3200,
          plane: 0,
          height: 0,
          surface: {
            model: {
              vertices: [
                {x: 0, y: 0, z: 0},
                {x: 128, y: 0, z: 0},
                {x: 0, y: 0, z: 128},
              ],
              faces: [
                {a: 0, b: 2, c: 1},
              ],
            },
          },
        },
        {
          x: 3201, y: 3200, plane: 0, height: 0,
        },
        {
          x: 3200, y: 3201, plane: 0, height: 0,
        },
        {
          x: 3201, y: 3201, plane: 0, height: 0,
        },
      ],
      actors: [],
      objects: [],
    };

    const geometry = buildTerrainGeometry(snapshot);
    const normals = geometry.getAttribute('normal');

    expect(normals.count).toBe(3);
    expect(normals.getY(0)).toBeCloseTo(1, 5);
    expect(Math.abs(normals.getX(0))).toBeLessThan(1e-5);
    expect(Math.abs(normals.getZ(0))).toBeLessThan(1e-5);
  });

  it('stitches modeled tile edges back to the coarse terrain border', () => {
    const snapshot: SceneSnapshot = {
      version: 1,
      timestamp: 1,
      baseX: 3200,
      baseY: 3200,
      plane: 0,
      tiles: [
        {
          x: 3200,
          y: 3200,
          plane: 0,
          height: 0,
          surface: {
            model: {
              vertices: [
                {x: 0, y: -10, z: 0},
                {x: 128, y: -10, z: 0},
                {x: 0, y: -10, z: 128},
              ],
              faces: [
                {a: 0, b: 1, c: 2},
              ],
            },
          },
        },
        {
          x: 3201, y: 3200, plane: 0, height: 0,
        },
        {
          x: 3200, y: 3201, plane: 0, height: 0,
        },
        {
          x: 3201, y: 3201, plane: 0, height: 0,
        },
      ],
      actors: [],
      objects: [],
    };

    const geometry = buildTerrainGeometry(snapshot);
    const positions = geometry.getAttribute('position');
    const seamHeights = Array.from({length: positions.count}, (_, index) => positions.getY(index));

    expect(seamHeights.some(height => Math.abs(height) < 1e-6)).toBe(true);
    expect(seamHeights.some(height => Math.abs(height + 0.025) < 1e-6)).toBe(true);
  });

  it('avoids duplicate seam triangles when adjacent modeled tiles share a border', () => {
    const snapshot: SceneSnapshot = {
      version: 1,
      timestamp: 1,
      baseX: 3200,
      baseY: 3200,
      plane: 0,
      tiles: [
        {
          x: 3200,
          y: 3200,
          plane: 0,
          height: 0,
          surface: {
            model: {
              vertices: [
                {x: 128, y: -10, z: 0},
                {x: 128, y: -10, z: 128},
                {x: 0, y: 0, z: 0},
                {x: 0, y: 0, z: 128},
              ],
              faces: [
                {a: 2, b: 0, c: 1},
                {a: 2, b: 1, c: 3},
              ],
            },
          },
        },
        {
          x: 3201,
          y: 3200,
          plane: 0,
          height: 0,
          surface: {
            model: {
              vertices: [
                {x: 0, y: -10, z: 0},
                {x: 128, y: 0, z: 0},
                {x: 128, y: 0, z: 128},
                {x: 0, y: -10, z: 128},
              ],
              faces: [
                {a: 0, b: 1, c: 2},
                {a: 0, b: 2, c: 3},
              ],
            },
          },
        },
        {
          x: 3202, y: 3200, plane: 0, height: 0,
        },
        {
          x: 3200, y: 3201, plane: 0, height: 0,
        },
        {
          x: 3201, y: 3201, plane: 0, height: 0,
        },
        {
          x: 3202, y: 3201, plane: 0, height: 0,
        },
      ],
      actors: [],
      objects: [],
    };

    const geometry = buildTerrainGeometry(snapshot);
    const positions = geometry.getAttribute('position');
    const triangleCount = positions.count / 3;
    const uniqueTriangles = new Set<string>();

    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      uniqueTriangles.add(canonicalTriangleKey(positions, triangle));
    }

    expect(uniqueTriangles.size).toBe(triangleCount);
  });
});

function canonicalTriangleKey(positions: {getX: (index: number) => number; getY: (index: number) => number; getZ: (index: number) => number}, triangle: number) {
  const start = triangle * 3;
  const vertices = [start, start + 1, start + 2].map(index => [
    roundPosition(positions.getX(index)),
    roundPosition(positions.getY(index)),
    roundPosition(positions.getZ(index)),
  ].join(':'));

  vertices.sort();
  return vertices.join('|');
}

function roundPosition(value: number) {
  return value.toFixed(6);
}
