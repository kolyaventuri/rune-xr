import {Mesh, Vector3} from 'three';
import {describe, expect, it} from 'vitest';
import type {Object3D} from 'three';
import type {SceneSnapshot} from '@rune-xr/protocol';
import {sampleSceneSnapshot} from '@rune-xr/protocol';
import {TILE_WORLD_SIZE} from '../config.js';
import {BoardScene} from '../render/BoardScene.js';

describe('BoardScene', () => {
  it('builds terrain and marker groups from a snapshot', () => {
    const board = new BoardScene();

    board.applySnapshot(sampleSceneSnapshot, {terrainChanged: true});
    board.updateActors(sampleSceneSnapshot.actors.map(toRenderedActor));

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
        renderX: 3200.5,
        renderY: 3200.5,
      },
      {
        id: 'north',
        type: 'player',
        x: 3200,
        y: 3201,
        plane: 0,
        renderX: 3200.5,
        renderY: 3201.5,
      },
    ]);

    const south = board.actorGroup.children[0];
    const north = board.actorGroup.children[1];

    expect(south).toBeDefined();
    expect(north).toBeDefined();
    expect(south!.position.z).toBeCloseTo(TILE_WORLD_SIZE * 0.5, 5);
    expect(north!.position.z).toBeCloseTo(-TILE_WORLD_SIZE * 0.5, 5);
    expect(north!.position.z).toBeLessThan(south!.position.z);
  });

  it('renders enclosed walls as explicit wall runs with a roofed building volume', () => {
    const board = new BoardScene();

    board.applySnapshot(sampleSceneSnapshot, {terrainChanged: true, objectsChanged: true});

    expect(countNamedInstances(board.objectGroup.children, 'wall-segment')).toBeGreaterThanOrEqual(8);
    expect(countNamedInstances(board.objectGroup.children, 'building-roof')).toBe(1);
    expect(board.getBuildStats().objects.instancedBatches).toBeGreaterThan(0);
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
    expect(countNamedInstances(board.objectGroup.children, 'wall-segment')).toBe(0);
  });

  it('upgrades keyed actors from placeholders to model-backed meshes', () => {
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
      actors: [
        {
          id: 'self_demo',
          type: 'self',
          name: 'Kolya',
          x: 3200,
          y: 3200,
          plane: 0,
          rotationDegrees: 180,
          size: 1,
          modelKey: 'actor-model:self-demo',
        },
      ],
      objects: [],
    };

    board.applySnapshot(snapshot, {terrainChanged: true});
    board.updateActors(snapshot.actors.map(toRenderedActor));

    const placeholderRoot = board.actorGroup.children[0];
    const placeholderMesh = placeholderRoot?.children[0];

    expect(placeholderMesh).toBeInstanceOf(Mesh);
    expect(placeholderMesh?.name).not.toBe('actor-model');

    board.applyActorModelBatch([
      {
        key: 'actor-model:self-demo',
        model: {
          vertices: [
            {x: 16, y: 240, z: 20},
            {x: 48, y: 240, z: 20},
            {x: 32, y: 304, z: 36},
          ],
          faces: [
            {
              a: 0,
              b: 1,
              c: 2,
              rgb: 0x2c9f62,
            },
          ],
        },
      },
    ]);
    board.updateActors(snapshot.actors.map(toRenderedActor));

    const actorRoot = board.actorGroup.children[0];
    const actorMesh = actorRoot?.children[0] as Mesh | undefined;

    actorMesh?.geometry.computeBoundingBox();

    expect(actorMesh?.name).toBe('actor-model');
    expect(actorMesh?.geometry.getAttribute('position').count).toBe(3);
    expect(actorMesh?.geometry.boundingBox?.min.y).toBe(0);
    expect(actorMesh?.geometry.boundingBox?.max.z ?? 0).toBeLessThan(0);
  });

  it('rotates actor models with RuneLite orientation parity', () => {
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
      actors: [
        {
          id: 'self_demo',
          type: 'self',
          name: 'Kolya',
          x: 3200,
          y: 3200,
          plane: 0,
          rotationDegrees: 90,
          modelKey: 'actor-model:self-demo',
        },
      ],
      objects: [],
    };

    board.applySnapshot(snapshot, {terrainChanged: true});
    board.applyActorModelBatch([
      {
        key: 'actor-model:self-demo',
        model: {
          vertices: [
            {x: 0, y: 0, z: 0},
            {x: 32, y: 0, z: 0},
            {x: 0, y: 64, z: 64},
          ],
          faces: [
            {
              a: 0,
              b: 1,
              c: 2,
              rgb: 0x2c9f62,
            },
          ],
        },
      },
    ]);
    board.updateActors(snapshot.actors.map(toRenderedActor));

    const actorRoot = board.actorGroup.children[0];

    expect(actorRoot?.rotation.y).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('does not offset actor placement based on actor size metadata', () => {
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
      ],
      actors: [],
      objects: [],
    };

    board.applySnapshot(snapshot, {terrainChanged: true});
    board.updateActors([
      {
        id: 'sized',
        type: 'player',
        name: 'Sized',
        x: 3200,
        y: 3200,
        plane: 0,
        rotationDegrees: 0,
        size: 5,
        renderX: 3200.5,
        renderY: 3200.5,
      },
    ]);

    expect(board.actorGroup.children[0]?.position.x).toBeCloseTo(TILE_WORLD_SIZE / 2, 5);
  });

  it('places actors using precise in-tile coordinates', () => {
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
        id: 'precise',
        type: 'player',
        x: 3200,
        y: 3200,
        plane: 0,
        renderX: 3200.75,
        renderY: 3200.25,
      },
    ]);

    expect(board.actorGroup.children[0]?.position.x).toBeCloseTo(TILE_WORLD_SIZE * 0.75, 5);
    expect(board.actorGroup.children[0]?.position.z).toBeCloseTo(TILE_WORLD_SIZE * 0.75, 5);
  });

  it('rebuilds proxy objects when referenced model batches arrive', () => {
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
          id: 'wall_proxy',
          kind: 'wall',
          name: 'Castle wall',
          x: 3200,
          y: 3200,
          plane: 0,
          wallOrientationA: 1,
          modelKey: 'object-model:wall',
        },
      ],
    };

    board.applySnapshot(snapshot, {terrainChanged: true, objectsChanged: true});

    expect(countNamedInstances(board.objectGroup.children, 'wall-segment')).toBeGreaterThan(0);

    board.applyObjectModelBatch([
      {
        key: 'object-model:wall',
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
    ]);

    const colorMesh = board.objectGroup.children.find(child => child.name === 'object-color');

    expect(colorMesh).toBeInstanceOf(Mesh);
    expect(countNamedInstances(board.objectGroup.children, 'wall-segment')).toBe(0);
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

function countNamedInstances(children: Object3D[], name: string) {
  return children
    .filter(child => child.name === name)
    .reduce((total, child) => total + resolveInstanceCount(child), 0);
}

function resolveInstanceCount(child: Object3D) {
  return typeof child.userData.instanceCount === 'number' ? child.userData.instanceCount : 1;
}

function toRenderedActor(actor: SceneSnapshot['actors'][number]) {
  return {
    ...actor,
    renderX: actor.preciseX ?? actor.x + 0.5,
    renderY: actor.preciseY ?? actor.y + 0.5,
  };
}
