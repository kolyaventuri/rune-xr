import {describe, expect, it} from 'vitest';
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
});
