import {describe, expect, it} from 'vitest';
import {createWindowKey, protocolVersion, sampleSceneSnapshot} from '@rune-xr/protocol';
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
    const movingActor = sampleSceneSnapshot.actors.find(actor => actor.type === 'player');

    store.applySnapshot(sampleSceneSnapshot, 0);
    store.applySnapshot({
      ...sampleSceneSnapshot,
      timestamp: sampleSceneSnapshot.timestamp + 500,
      actors: sampleSceneSnapshot.actors.map(actor => actor.id === movingActor?.id
        ? {
          ...actor,
          x: actor.x + 2,
          preciseX: actor.x + 2.25,
        }
        : actor),
    }, 100);

    const actor = store.getInterpolatedActors(225).find(entry => entry.id === movingActor?.id);

    expect(actor?.renderX).toBeGreaterThan((movingActor?.x ?? 0) + 0.5);
    expect(actor?.renderX).toBeLessThan((movingActor?.x ?? 0) + 2.25);
  });

  it('uses precise actor coordinates when available', () => {
    const store = new WorldStateStore();

    store.applySnapshot({
      ...sampleSceneSnapshot,
      actors: sampleSceneSnapshot.actors.map(actor => actor.id === 'self_kolya'
        ? {
          ...actor,
          preciseX: actor.x + 0.75,
          preciseY: actor.y + 0.25,
        }
        : actor),
    }, 0);

    const actor = store.getInterpolatedActors(0).find(entry => entry.id === 'self_kolya');

    expect(actor?.renderX).toBe(sampleSceneSnapshot.actors[0]!.x + 0.75);
    expect(actor?.renderY).toBe(sampleSceneSnapshot.actors[0]!.y + 0.25);
  });

  it('renders the local player at the latest snapshot position without interpolation lag', () => {
    const store = new WorldStateStore();

    store.applySnapshot(sampleSceneSnapshot, 0);
    store.applySnapshot({
      ...sampleSceneSnapshot,
      timestamp: sampleSceneSnapshot.timestamp + 500,
      actors: sampleSceneSnapshot.actors.map(actor => actor.id === 'self_kolya'
        ? {
          ...actor,
          x: actor.x + 2,
          preciseX: actor.x + 2.25,
          preciseY: actor.y + 0.75,
        }
        : actor),
    }, 100);

    const actor = store.getInterpolatedActors(125).find(entry => entry.id === 'self_kolya');

    expect(actor?.renderX).toBe(sampleSceneSnapshot.actors[0]!.x + 2.25);
    expect(actor?.renderY).toBe(sampleSceneSnapshot.actors[0]!.y + 0.75);
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

  it('rebuilds objects when an object model key changes without moving the object', () => {
    const store = new WorldStateStore();
    const initialSnapshot = {
      ...sampleSceneSnapshot,
      objects: sampleSceneSnapshot.objects.map(object => object.id === 'game_tree_3201_3194_0_0'
        ? {
          ...object,
          modelKey: 'object-model:a',
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
          modelKey: 'object-model:b',
        }
        : object),
    }, 100);

    expect(update.terrainChanged).toBe(false);
    expect(update.objectsChanged).toBe(true);
  });

  it('treats actor model metadata as a meaningful actor change', () => {
    const store = new WorldStateStore();
    const initialSnapshot = {
      ...sampleSceneSnapshot,
      actors: sampleSceneSnapshot.actors.map(actor => actor.id === 'self_kolya'
        ? {
          ...actor,
          modelKey: 'actor-model:a',
        }
        : actor),
    };

    store.applySnapshot(initialSnapshot, 0);
    const update = store.applySnapshot({
      ...initialSnapshot,
      timestamp: sampleSceneSnapshot.timestamp + 1,
      actors: initialSnapshot.actors.map(actor => actor.id === 'self_kolya'
        ? {
          ...actor,
          modelKey: 'actor-model:b',
        }
        : actor),
    }, 100);

    expect(update.changed).toBe(true);
    expect(update.terrainChanged).toBe(false);
    expect(update.objectsChanged).toBe(false);
  });

  it('treats precise actor coordinates as a meaningful actor change', () => {
    const store = new WorldStateStore();
    const initialSnapshot = {
      ...sampleSceneSnapshot,
      actors: sampleSceneSnapshot.actors.map(actor => actor.id === 'self_kolya'
        ? {
          ...actor,
          preciseX: actor.x + 0.5,
        }
        : actor),
    };

    store.applySnapshot(initialSnapshot, 0);
    const update = store.applySnapshot({
      ...initialSnapshot,
      timestamp: sampleSceneSnapshot.timestamp + 1,
      actors: initialSnapshot.actors.map(actor => actor.id === 'self_kolya'
        ? {
          ...actor,
          preciseX: actor.x + 0.75,
        }
        : actor),
    }, 100);

    expect(update.changed).toBe(true);
    expect(update.terrainChanged).toBe(false);
    expect(update.objectsChanged).toBe(false);
  });

  it('treats actor frames as actor-only updates when terrain and objects are unchanged', () => {
    const store = new WorldStateStore();
    const windowKey = createWindowKey(sampleSceneSnapshot.plane, sampleSceneSnapshot.baseX, sampleSceneSnapshot.baseY);

    store.applyTerrainSnapshot({
      version: protocolVersion,
      timestamp: sampleSceneSnapshot.timestamp,
      windowKey,
      baseX: sampleSceneSnapshot.baseX,
      baseY: sampleSceneSnapshot.baseY,
      plane: sampleSceneSnapshot.plane,
      tiles: sampleSceneSnapshot.tiles,
    }, 0);
    store.applyObjectsSnapshot({
      version: protocolVersion,
      timestamp: sampleSceneSnapshot.timestamp,
      windowKey,
      objects: sampleSceneSnapshot.objects,
    }, 0);
    store.applyActorsFrame({
      version: protocolVersion,
      timestamp: sampleSceneSnapshot.timestamp,
      windowKey,
      actors: sampleSceneSnapshot.actors,
    }, 0);

    const update = store.applyActorsFrame({
      version: protocolVersion,
      timestamp: sampleSceneSnapshot.timestamp + 1,
      windowKey,
      actors: sampleSceneSnapshot.actors.map(actor => actor.id === 'self_kolya'
        ? {
          ...actor,
          preciseX: actor.x + 0.75,
        }
        : actor),
    }, 100);

    expect(update.changed).toBe(true);
    expect(update.terrainChanged).toBe(false);
    expect(update.objectsChanged).toBe(false);
  });

  it('treats object snapshots as object-only updates when terrain is unchanged', () => {
    const store = new WorldStateStore();
    const windowKey = createWindowKey(sampleSceneSnapshot.plane, sampleSceneSnapshot.baseX, sampleSceneSnapshot.baseY);

    store.applyTerrainSnapshot({
      version: protocolVersion,
      timestamp: sampleSceneSnapshot.timestamp,
      windowKey,
      baseX: sampleSceneSnapshot.baseX,
      baseY: sampleSceneSnapshot.baseY,
      plane: sampleSceneSnapshot.plane,
      tiles: sampleSceneSnapshot.tiles,
    }, 0);
    store.applyObjectsSnapshot({
      version: protocolVersion,
      timestamp: sampleSceneSnapshot.timestamp,
      windowKey,
      objects: sampleSceneSnapshot.objects,
    }, 0);
    store.applyActorsFrame({
      version: protocolVersion,
      timestamp: sampleSceneSnapshot.timestamp,
      windowKey,
      actors: sampleSceneSnapshot.actors,
    }, 0);

    const update = store.applyObjectsSnapshot({
      version: protocolVersion,
      timestamp: sampleSceneSnapshot.timestamp + 1,
      windowKey,
      objects: sampleSceneSnapshot.objects.map(object => object.id === 'wall_house_sw'
        ? {
          ...object,
          wallOrientationB: 2,
        }
        : object),
    }, 100);

    expect(update.changed).toBe(true);
    expect(update.terrainChanged).toBe(false);
    expect(update.objectsChanged).toBe(true);
  });

  it('preserves composed objects while terrain snapshots change within the same window', () => {
    const store = new WorldStateStore();
    const windowKey = createWindowKey(sampleSceneSnapshot.plane, sampleSceneSnapshot.baseX, sampleSceneSnapshot.baseY);

    store.applyTerrainSnapshot({
      version: protocolVersion,
      timestamp: sampleSceneSnapshot.timestamp,
      windowKey,
      baseX: sampleSceneSnapshot.baseX,
      baseY: sampleSceneSnapshot.baseY,
      plane: sampleSceneSnapshot.plane,
      tiles: sampleSceneSnapshot.tiles,
    }, 0);
    store.applyObjectsSnapshot({
      version: protocolVersion,
      timestamp: sampleSceneSnapshot.timestamp,
      windowKey,
      objects: sampleSceneSnapshot.objects,
    }, 0);
    store.applyActorsFrame({
      version: protocolVersion,
      timestamp: sampleSceneSnapshot.timestamp,
      windowKey,
      actors: sampleSceneSnapshot.actors,
    }, 0);

    const update = store.applyTerrainSnapshot({
      version: protocolVersion,
      timestamp: sampleSceneSnapshot.timestamp + 1,
      windowKey,
      baseX: sampleSceneSnapshot.baseX,
      baseY: sampleSceneSnapshot.baseY,
      plane: sampleSceneSnapshot.plane,
      tiles: sampleSceneSnapshot.tiles.map(tile => tile.x === sampleSceneSnapshot.baseX && tile.y === sampleSceneSnapshot.baseY
        ? {
          ...tile,
          height: tile.height + 2,
        }
        : tile),
    }, 100);

    expect(update.changed).toBe(true);
    expect(update.terrainChanged).toBe(true);
    expect(update.objectsChanged).toBe(false);
    expect(store.getCurrentSnapshot()?.objects).toEqual(sampleSceneSnapshot.objects);
  });
});
