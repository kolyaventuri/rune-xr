import {describe, expect, it} from 'vitest';
import {sampleSceneSnapshot} from '@rune-xr/protocol';
import {WorldStateStore} from '../world/WorldStateStore.js';

describe('WorldStateStore', () => {
  it('rebuilds terrain only when tile data changes', () => {
    const store = new WorldStateStore();
    const first = store.applySnapshot(sampleSceneSnapshot, 100);
    const second = store.applySnapshot({
      ...sampleSceneSnapshot,
      timestamp: sampleSceneSnapshot.timestamp + 1,
      actors: sampleSceneSnapshot.actors.map(actor => actor.id === 'self_kolya' ? {...actor, x: actor.x + 1} : actor),
    }, 200);

    expect(first.terrainChanged).toBe(true);
    expect(second.terrainChanged).toBe(false);
  });

  it('interpolates actors between snapshots', () => {
    const store = new WorldStateStore();

    store.applySnapshot(sampleSceneSnapshot, 0);
    store.applySnapshot({
      ...sampleSceneSnapshot,
      timestamp: sampleSceneSnapshot.timestamp + 500,
      actors: sampleSceneSnapshot.actors.map(actor => actor.id === 'self_kolya' ? {...actor, x: actor.x + 2} : actor),
    }, 100);

    const actor = store.getInterpolatedActors(225).find(entry => entry.id === 'self_kolya');

    expect(actor?.renderX).toBeGreaterThan(sampleSceneSnapshot.actors[0]!.x);
    expect(actor?.renderX).toBeLessThan(sampleSceneSnapshot.actors[0]!.x + 2);
  });

  it('rebuilds terrain when shaped tile metadata changes', () => {
    const store = new WorldStateStore();
    const first = store.applySnapshot({
      ...sampleSceneSnapshot,
      tiles: [
        {
          ...sampleSceneSnapshot.tiles[0]!,
          surface: {
            model: {
              vertices: [
                {x: 0, y: 10, z: 0},
                {x: 128, y: 10, z: 0},
                {x: 0, y: 10, z: 128},
              ],
              faces: [
                {a: 0, b: 1, c: 2},
              ],
            },
          },
        },
        ...sampleSceneSnapshot.tiles.slice(1),
      ],
    }, 0);
    const second = store.applySnapshot({
      ...sampleSceneSnapshot,
      timestamp: sampleSceneSnapshot.timestamp + 1,
      tiles: [
        {
          ...sampleSceneSnapshot.tiles[0]!,
          surface: {
            model: {
              vertices: [
                {x: 0, y: 10, z: 0},
                {x: 128, y: 10, z: 0},
                {x: 0, y: 12, z: 128},
              ],
              faces: [
                {a: 0, b: 1, c: 2},
              ],
            },
          },
        },
        ...sampleSceneSnapshot.tiles.slice(1),
      ],
    }, 100);

    expect(first.terrainChanged).toBe(true);
    expect(second.terrainChanged).toBe(true);
  });

  it('rebuilds objects when wall metadata changes without moving the object', () => {
    const store = new WorldStateStore();

    store.applySnapshot(sampleSceneSnapshot, 0);
    const update = store.applySnapshot({
      ...sampleSceneSnapshot,
      timestamp: sampleSceneSnapshot.timestamp + 1,
      objects: sampleSceneSnapshot.objects.map(object => object.id === 'wall_house_sw'
        ? {...object, wallOrientationB: 2}
        : object),
    }, 100);

    expect(update.terrainChanged).toBe(false);
    expect(update.objectsChanged).toBe(true);
  });

  it('rebuilds objects when model geometry changes without moving the object', () => {
    const store = new WorldStateStore();
    const initialSnapshot = {
      ...sampleSceneSnapshot,
      objects: sampleSceneSnapshot.objects.map(object => object.id === 'game_tree_3201_3194_0_0'
        ? {
          ...object,
          model: {
            vertices: [
              {x: 0, y: 0, z: 0},
              {x: 128, y: 0, z: 0},
              {x: 0, y: 64, z: 0},
            ],
            faces: [
              {a: 0, b: 1, c: 2, rgb: 0x7f8b3a},
            ],
          },
        }
        : object),
    };

    store.applySnapshot(initialSnapshot, 0);
    const update = store.applySnapshot({
      ...initialSnapshot,
      timestamp: sampleSceneSnapshot.timestamp + 1,
      objects: initialSnapshot.objects.map(object => object.id === 'game_tree_3201_3194_0_0'
        ? {
          ...object,
          model: {
            vertices: [
              {x: 0, y: 0, z: 0},
              {x: 128, y: 0, z: 0},
              {x: 0, y: 96, z: 0},
            ],
            faces: [
              {a: 0, b: 1, c: 2, rgb: 0x7f8b3a},
            ],
          },
        }
        : object),
    }, 100);

    expect(update.terrainChanged).toBe(false);
    expect(update.objectsChanged).toBe(true);
  });
});
