import type {Actor, SceneSnapshot} from '@rune-xr/protocol';
import {ACTOR_INTERPOLATION_MS} from '../config.js';

export type InterpolatedActor = Actor & {
  renderX: number;
  renderY: number;
};

export type SnapshotUpdate = {
  changed: boolean;
  terrainChanged: boolean;
  objectsChanged: boolean;
};

export class WorldStateStore {
  private currentSnapshot: SceneSnapshot | undefined;
  private previousSnapshot: SceneSnapshot | undefined;
  private terrainSignature = '';
  private objectSignature = '';
  private receivedAt = 0;

  applySnapshot(snapshot: SceneSnapshot, receivedAt = performance.now()): SnapshotUpdate {
    const nextTerrainSignature = makeTerrainSignature(snapshot);
    const nextObjectSignature = makeObjectSignature(snapshot);
    const previousSignature = makeSceneSignature(this.currentSnapshot);
    const nextSignature = makeSceneSignature(snapshot);
    const terrainChanged = nextTerrainSignature !== this.terrainSignature;
    const objectsChanged = nextObjectSignature !== this.objectSignature;

    if (previousSignature === nextSignature) {
      return {
        changed: false,
        terrainChanged,
        objectsChanged,
      };
    }

    this.previousSnapshot = this.currentSnapshot;
    this.currentSnapshot = snapshot;
    this.receivedAt = receivedAt;
    this.terrainSignature = nextTerrainSignature;
    this.objectSignature = nextObjectSignature;

    return {
      changed: true,
      terrainChanged,
      objectsChanged,
    };
  }

  getCurrentSnapshot() {
    return this.currentSnapshot;
  }

  getInterpolatedActors(now = performance.now()): InterpolatedActor[] {
    if (!this.currentSnapshot) {
      return [];
    }

    const alpha = Math.max(0, Math.min(1, (now - this.receivedAt) / ACTOR_INTERPOLATION_MS));
    const previousActors = new Map(
      (this.previousSnapshot?.actors ?? []).map(actor => [actor.id, actor] as const),
    );

    return this.currentSnapshot.actors.map(actor => {
      const previous = previousActors.get(actor.id);

      if (!previous) {
        return {
          ...actor,
          renderX: actor.x,
          renderY: actor.y,
        };
      }

      return {
        ...actor,
        renderX: lerp(previous.x, actor.x, alpha),
        renderY: lerp(previous.y, actor.y, alpha),
      };
    });
  }
}

function makeSceneSignature(snapshot?: SceneSnapshot) {
  if (!snapshot) {
    return '';
  }

  return JSON.stringify({
    timestamp: snapshot.timestamp,
    actors: snapshot.actors,
    objects: snapshot.objects,
    tiles: snapshot.tiles,
  });
}

function makeTerrainSignature(snapshot: SceneSnapshot) {
  return JSON.stringify({
    baseX: snapshot.baseX,
    baseY: snapshot.baseY,
    plane: snapshot.plane,
    tiles: snapshot.tiles.map(tile => [tile.x, tile.y, tile.height, tile.surface]),
  });
}

function makeObjectSignature(snapshot: SceneSnapshot) {
  return JSON.stringify(snapshot.objects.map(object => [object.id, object.kind, object.x, object.y]));
}

function lerp(start: number, end: number, alpha: number) {
  return start + (end - start) * alpha;
}
