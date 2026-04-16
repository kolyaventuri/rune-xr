import {describe, expect, it} from 'vitest';
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
});
