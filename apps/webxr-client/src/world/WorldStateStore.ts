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
  private actorSignature = '';
  private terrainSignature = '';
  private objectSignature = '';
  private receivedAt = 0;

  applySnapshot(snapshot: SceneSnapshot, receivedAt = performance.now()): SnapshotUpdate {
    const nextActorSignature = makeActorSignature(snapshot);
    const nextTerrainSignature = makeTerrainSignature(snapshot);
    const nextObjectSignature = makeObjectSignature(snapshot);
    const actorsChanged = nextActorSignature !== this.actorSignature;
    const terrainChanged = nextTerrainSignature !== this.terrainSignature;
    const objectsChanged = nextObjectSignature !== this.objectSignature;

    if (!actorsChanged && !terrainChanged && !objectsChanged) {
      return {
        changed: false,
        terrainChanged,
        objectsChanged,
      };
    }

    this.previousSnapshot = this.currentSnapshot;
    this.currentSnapshot = snapshot;
    this.receivedAt = receivedAt;
    this.actorSignature = nextActorSignature;
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
      if (actor.type === 'self') {
        return {
          ...actor,
          renderX: actorExactX(actor),
          renderY: actorExactY(actor),
        };
      }

      const previous = previousActors.get(actor.id);

      if (!previous) {
        return {
          ...actor,
          renderX: actorExactX(actor),
          renderY: actorExactY(actor),
        };
      }

      return {
        ...actor,
        renderX: lerp(actorExactX(previous), actorExactX(actor), alpha),
        renderY: lerp(actorExactY(previous), actorExactY(actor), alpha),
      };
    });
  }
}

function actorExactX(actor: Pick<Actor, 'x' | 'preciseX'>) {
  return actor.preciseX ?? actor.x + 0.5;
}

function actorExactY(actor: Pick<Actor, 'y' | 'preciseY'>) {
  return actor.preciseY ?? actor.y + 0.5;
}

const HASH_SEED = 0x811c9dc5;
const HASH_PRIME = 0x01000193;
const FLOAT_SCALE = 1_000;
const MODEL_SAMPLE_COUNT = 4;
const NO_VALUE = -1;

function makeTerrainSignature(snapshot: SceneSnapshot) {
  let hash = HASH_SEED;

  hash = hashNumber(hash, snapshot.baseX);
  hash = hashNumber(hash, snapshot.baseY);
  hash = hashNumber(hash, snapshot.plane);

  for (const tile of snapshot.tiles) {
    hash = hashNumber(hash, tile.x);
    hash = hashNumber(hash, tile.y);
    hash = hashNumber(hash, tile.height);
    hash = hashSurface(hash, tile.surface);
  }

  return finalizeHash(hash);
}

function makeObjectSignature(snapshot: SceneSnapshot) {
  let hash = HASH_SEED;

  for (const object of snapshot.objects) {
    hash = hashString(hash, object.id);
    hash = hashString(hash, object.kind);
    hash = hashString(hash, object.name ?? '');
    hash = hashNumber(hash, object.x);
    hash = hashNumber(hash, object.y);
    hash = hashNumber(hash, object.plane);
    hash = hashOptionalNumber(hash, object.sizeX);
    hash = hashOptionalNumber(hash, object.sizeY);
    hash = hashOptionalNumber(hash, object.rotationDegrees);
    hash = hashOptionalNumber(hash, object.wallOrientationA);
    hash = hashOptionalNumber(hash, object.wallOrientationB);
    hash = hashString(hash, object.modelKey ?? '');
    hash = hashModel(hash, object.model);
  }

  return finalizeHash(hash);
}

function makeActorSignature(snapshot: SceneSnapshot) {
  let hash = HASH_SEED;

  for (const actor of snapshot.actors) {
    hash = hashString(hash, actor.id);
    hash = hashString(hash, actor.type);
    hash = hashString(hash, actor.name ?? '');
    hash = hashNumber(hash, actor.x);
    hash = hashNumber(hash, actor.y);
    hash = hashOptionalFloat(hash, actor.preciseX);
    hash = hashOptionalFloat(hash, actor.preciseY);
    hash = hashNumber(hash, actor.plane);
    hash = hashOptionalNumber(hash, actor.rotationDegrees);
    hash = hashOptionalNumber(hash, actor.size);
    hash = hashString(hash, actor.modelKey ?? '');
    hash = hashModel(hash, actor.model);
  }

  return finalizeHash(hash);
}

function hashSurface(hash: number, surface: SceneSnapshot['tiles'][number]['surface']) {
  if (!surface) {
    return hashNumber(hash, NO_VALUE);
  }

  hash = hashOptionalNumber(hash, surface.rgb);
  hash = hashOptionalNumber(hash, surface.texture);
  hash = hashOptionalNumber(hash, surface.overlayId);
  hash = hashOptionalNumber(hash, surface.underlayId);
  hash = hashOptionalNumber(hash, surface.shape);
  hash = hashOptionalNumber(hash, surface.renderLevel);
  hash = hashNumber(hash, surface.hasBridge ? 1 : 0);
  hash = hashOptionalNumber(hash, surface.bridgeHeight);

  return hashModel(hash, surface.model);
}

function hashModel(hash: number, model: SceneSnapshot['objects'][number]['model']) {
  if (!model) {
    return hashNumber(hash, NO_VALUE);
  }

  hash = hashNumber(hash, model.vertices.length);
  hash = hashNumber(hash, model.faces.length);

  for (const index of sampleIndices(model.vertices.length)) {
    const vertex = model.vertices[index];

    if (!vertex) {
      continue;
    }

    hash = hashNumber(hash, vertex.x);
    hash = hashNumber(hash, vertex.y);
    hash = hashNumber(hash, vertex.z);
  }

  for (const index of sampleIndices(model.faces.length)) {
    const face = model.faces[index];

    if (!face) {
      continue;
    }

    hash = hashNumber(hash, face.a);
    hash = hashNumber(hash, face.b);
    hash = hashNumber(hash, face.c);
    hash = hashOptionalNumber(hash, face.rgb);
    hash = hashOptionalNumber(hash, face.rgbA);
    hash = hashOptionalNumber(hash, face.rgbB);
    hash = hashOptionalNumber(hash, face.rgbC);
    hash = hashOptionalNumber(hash, face.texture);
    hash = hashOptionalFloat(hash, face.uA);
    hash = hashOptionalFloat(hash, face.vA);
    hash = hashOptionalFloat(hash, face.uB);
    hash = hashOptionalFloat(hash, face.vB);
    hash = hashOptionalFloat(hash, face.uC);
    hash = hashOptionalFloat(hash, face.vC);
  }

  return hash;
}

function sampleIndices(length: number) {
  if (length <= 0) {
    return [];
  }

  const indices = new Set<number>();
  const sampleCount = Math.min(length, MODEL_SAMPLE_COUNT);

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const normalized = sampleCount === 1 ? 0 : sampleIndex / (sampleCount - 1);
    const index = Math.min(length - 1, Math.floor((length - 1) * normalized));

    indices.add(index);
  }

  return [...indices];
}

function hashOptionalFloat(hash: number, value: number | undefined) {
  return hashNumber(hash, value === undefined ? NO_VALUE : Math.round(value * FLOAT_SCALE));
}

function hashOptionalNumber(hash: number, value: number | undefined) {
  return hashNumber(hash, value ?? NO_VALUE);
}

function hashString(hash: number, value: string) {
  let nextHash = hashNumber(hash, value.length);

  for (let index = 0; index < value.length; index += 1) {
    nextHash = hashNumber(nextHash, value.charCodeAt(index));
  }

  return nextHash;
}

function hashNumber(hash: number, value: number) {
  const normalized = Number.isFinite(value) ? value | 0 : NO_VALUE;

  return Math.imul(hash ^ normalized, HASH_PRIME) >>> 0;
}

function finalizeHash(hash: number) {
  return hash.toString(16);
}

function lerp(start: number, end: number, alpha: number) {
  return start + (end - start) * alpha;
}
