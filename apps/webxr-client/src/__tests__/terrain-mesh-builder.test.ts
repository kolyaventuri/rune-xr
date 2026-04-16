import {Color} from 'three';
import {describe, expect, it} from 'vitest';
import type {SceneSnapshot} from '@rune-xr/protocol';
import {buildTerrainGeometry} from '../render/TerrainMeshBuilder.js';

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
    expect(positions.getZ(1)).toBeCloseTo(0.04, 5);
    expect(positions.getX(2)).toBeCloseTo(0.04, 5);
    expect(colors.getX(0)).toBeCloseTo(expected.r, 5);
    expect(colors.getY(0)).toBeCloseTo(expected.g, 5);
    expect(colors.getZ(0)).toBeCloseTo(expected.b, 5);
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
});
