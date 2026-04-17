import {Mesh} from 'three';
import {describe, expect, it} from 'vitest';
import type {Object3D} from 'three';
import type {SceneSnapshot} from '@rune-xr/protocol';
import {sampleSceneSnapshot} from '@rune-xr/protocol';
import {BoardScene} from '../render/BoardScene.js';

describe('BoardScene', () => {
  it('builds terrain and marker groups from a snapshot', () => {
    const board = new BoardScene();

    board.applySnapshot(sampleSceneSnapshot, {terrainChanged: true});
    board.updateActors(sampleSceneSnapshot.actors.map(actor => ({
      ...actor,
      renderX: actor.x,
      renderY: actor.y,
    })));

    expect(board.terrainBuildCount).toBe(1);
    expect(board.getDebugState()).toEqual({
      actorCount: sampleSceneSnapshot.actors.length,
      objectCount: sampleSceneSnapshot.objects.length,
      terrainChildren: 2,
    });
  });

  it('does not rebuild terrain if only actors move', () => {
    const board = new BoardScene();

    board.applySnapshot(sampleSceneSnapshot, {terrainChanged: true});
    board.applySnapshot({
      ...sampleSceneSnapshot,
      timestamp: sampleSceneSnapshot.timestamp + 1,
      actors: sampleSceneSnapshot.actors.map(actor => actor.id === 'self_kolya' ? {...actor, x: actor.x + 1} : actor),
    }, {terrainChanged: false});

    expect(board.terrainBuildCount).toBe(1);
  });

  it('does not rebuild terrain when texture batches arrive', async () => {
    const board = new BoardScene();

    board.applySnapshot({
      ...sampleSceneSnapshot,
      tiles: [
        {
          ...sampleSceneSnapshot.tiles[0]!,
          surface: {texture: 12},
        },
        ...sampleSceneSnapshot.tiles.slice(1),
      ],
    }, {terrainChanged: true});

    await board.applyTextureBatch([
      {
        id: 12,
        width: 1,
        height: 1,
        pngBase64: 'Zm9v',
      },
    ]);

    expect(board.terrainBuildCount).toBe(1);
  });

  it('moves northern actors toward smaller board Z positions', () => {
    const board = new BoardScene();
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

    board.applySnapshot(snapshot, {terrainChanged: true});
    board.updateActors([
      {
        id: 'south',
        type: 'player',
        x: 3200,
        y: 3200,
        plane: 0,
        renderX: 3200,
        renderY: 3200,
      },
      {
        id: 'north',
        type: 'player',
        x: 3200,
        y: 3201,
        plane: 0,
        renderX: 3200,
        renderY: 3201,
      },
    ]);

    const south = board.actorGroup.children[0];
    const north = board.actorGroup.children[1];

    expect(south).toBeDefined();
    expect(north).toBeDefined();
    expect(north!.position.z).toBeLessThan(south!.position.z);
  });

  it('renders enclosed walls as explicit wall runs with a roofed building volume', () => {
    const board = new BoardScene();

    board.applySnapshot(sampleSceneSnapshot, {terrainChanged: true, objectsChanged: true});

    expect(countNamedChildren(board.objectGroup.children, 'wall-segment')).toBeGreaterThanOrEqual(8);
    expect(countNamedChildren(board.objectGroup.children, 'building-roof')).toBe(1);
  });

  it('renders model-backed objects instead of proxy wall geometry', () => {
    const board = new BoardScene();
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
      objects: [
        {
          id: 'wall_model',
          kind: 'wall',
          name: 'Castle wall',
          x: 3200,
          y: 3200,
          plane: 0,
          wallOrientationA: 1,
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
                rgb: 0x888888,
                texture: 12,
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
      ],
    };

    board.applySnapshot(snapshot, {terrainChanged: true, objectsChanged: true});

    const colorMesh = board.objectGroup.children.find(child => child.name === 'object-color');
    const texturedMesh = board.objectGroup.children.find(child => child.name === 'object-texture');

    expect(colorMesh).toBeInstanceOf(Mesh);
    expect((colorMesh as Mesh).geometry.getAttribute('position').count).toBe(3);
    expect(texturedMesh).toBeUndefined();
    expect(countNamedChildren(board.objectGroup.children, 'wall-segment')).toBe(0);
  });

  it('preserves per-vertex object face colors', () => {
    const board = new BoardScene();
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
      objects: [
        {
          id: 'wall_colors',
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
                rgbA: 0xff0000,
                rgbB: 0x00ff00,
                rgbC: 0x0000ff,
              },
            ],
          },
        },
      ],
    };

    board.applySnapshot(snapshot, {terrainChanged: true, objectsChanged: true});

    const colorMesh = board.objectGroup.children.find(child => child.name === 'object-color') as Mesh | undefined;
    const colorAttribute = colorMesh?.geometry.getAttribute('color');

    expect(colorAttribute).toBeDefined();
    expect(Array.from(colorAttribute!.array)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
});

function countNamedChildren(children: Object3D[], name: string) {
  return children.filter(child => child.name === name).length;
}
