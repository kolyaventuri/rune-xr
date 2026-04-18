import {describe, expect, it} from 'vitest';
import {TILE_WORLD_SIZE} from '../config.js';
import {createActorMesh} from '../render/ActorMeshBuilder.js';

describe('ActorMeshBuilder', () => {
  it('preserves the extracted actor X origin instead of re-centering the mesh', () => {
    const mesh = createActorMesh({type: 'player'}, {
      vertices: [
        {x: 32, y: 0, z: 0},
        {x: 64, y: 0, z: 0},
        {x: 48, y: 24, z: 0},
        {x: 80, y: 60, z: 0},
        {x: 100, y: 60, z: 0},
        {x: 90, y: 84, z: 0},
      ],
      faces: [
        {a: 0, b: 1, c: 2, rgb: 0x4478c8},
        {a: 3, b: 4, c: 5, rgb: 0x4478c8},
      ],
    });

    const positions = Array.from(mesh.geometry.getAttribute('position').array as Iterable<number>);
    const groundXs: number[] = [];

    for (let index = 0; index < positions.length; index += 3) {
      if (positions[index + 1] !== 0) {
        continue;
      }

      groundXs.push(positions[index] ?? 0);
    }

    expect(Math.min(...groundXs)).toBeCloseTo((32 / 128) * TILE_WORLD_SIZE, 5);
    expect(Math.max(...groundXs)).toBeCloseTo((64 / 128) * TILE_WORLD_SIZE, 5);
  });
});
