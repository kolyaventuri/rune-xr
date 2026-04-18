import {Texture} from 'three';
import {describe, expect, it} from 'vitest';
import type {SceneSnapshot} from '@rune-xr/protocol';
import {buildObjectMeshData, createObjectMeshesFromData} from '../render/ObjectMeshBuilder.js';

describe('ObjectMeshBuilder', () => {
  it('renders textured object faces without vertex-color tinting data', () => {
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
      ],
      actors: [],
      objects: [],
    };
    const objects: SceneSnapshot['objects'] = [
      {
        id: 'wall_textured',
        kind: 'wall',
        name: 'Castle wall',
        x: 3200,
        y: 3200,
        plane: 0,
        model: {
          vertices: [
            {x: 0, y: 0, z: 0},
            {x: 128, y: 0, z: 0},
            {x: 0, y: 128, z: 0},
          ],
          faces: [
            {
              a: 0,
              b: 1,
              c: 2,
              texture: 12,
              rgbA: 0x222222,
              rgbB: 0xbbbbbb,
              rgbC: 0x777777,
              uA: 0,
              vA: 0,
              uB: 1,
              vB: 0,
              uC: 0,
              vC: 1,
            },
          ],
        },
      },
    ];

    const data = buildObjectMeshData(snapshot, objects, textureId => textureId === 12);
    const meshes = createObjectMeshesFromData(data, () => new Texture());
    const texturedMesh = meshes.texturedMeshes[0];

    expect(texturedMesh).toBeDefined();
    expect(texturedMesh?.geometry.getAttribute('color')).toBeUndefined();
  });
});
