import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  GridHelper,
  Group,
  MathUtils,
  type Matrix4,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  type Object3D,
} from 'three';
import type {SceneObject, SceneSnapshot} from '@rune-xr/protocol';
import {ACTOR_HEIGHT, HEIGHT_SCALE, OBJECT_HEIGHT, TILE_WORLD_SIZE} from '../config.js';
import type {InterpolatedActor} from '../world/WorldStateStore.js';
import {buildTerrainMesh} from './TerrainMeshBuilder.js';

export class BoardScene {
  readonly root = new Group();
  readonly terrainGroup = new Group();
  readonly actorGroup = new Group();
  readonly objectGroup = new Group();
  terrainBuildCount = 0;

  private readonly actorGeometry = new CylinderGeometry(0.012, 0.012, ACTOR_HEIGHT, 18);
  private readonly actorMaterials = {
    self: new MeshStandardMaterial({color: new Color('#29bf6f')}),
    player: new MeshStandardMaterial({color: new Color('#2a76d2')}),
    npc: new MeshStandardMaterial({color: new Color('#d14b44')}),
  };

  private readonly objectGeometries = {
    game: new ConeGeometry(0.018, OBJECT_HEIGHT * 1.4, 6),
    wall: new BoxGeometry(0.05, OBJECT_HEIGHT * 1.5, 0.015),
    decor: new OctahedronGeometry(0.02),
    ground: new SphereGeometry(0.016, 12, 12),
  };

  private readonly objectMaterials = {
    game: new MeshStandardMaterial({color: new Color('#937b3d')}),
    wall: new MeshStandardMaterial({color: new Color('#726b63')}),
    decor: new MeshStandardMaterial({color: new Color('#d17a2b')}),
    ground: new MeshStandardMaterial({color: new Color('#86664f')}),
  };

  private readonly actorNodes = new Map<string, Mesh>();
  private readonly objectNodes = new Map<string, Mesh>();
  private heightMap = new Map<string, number>();
  private maxY = 0;
  private snapshot?: SceneSnapshot;

  constructor() {
    this.root.matrixAutoUpdate = true;
    this.root.add(this.terrainGroup, this.actorGroup, this.objectGroup);
  }

  applySnapshot(snapshot: SceneSnapshot, options: {terrainChanged: boolean}) {
    this.snapshot = snapshot;
    this.heightMap = new Map(snapshot.tiles.map(tile => [`${tile.x}:${tile.y}`, tile.height] as const));
    this.maxY = Math.max(snapshot.baseY, ...snapshot.tiles.map(tile => tile.y));

    if (options.terrainChanged || this.terrainGroup.children.length === 0) {
      this.rebuildTerrain(snapshot);
    }

    this.syncObjects(snapshot.objects);
  }

  updateActors(actors: InterpolatedActor[]) {
    for (const actor of actors) {
      let mesh = this.actorNodes.get(actor.id);

      if (!mesh) {
        mesh = new Mesh(this.actorGeometry, this.actorMaterials[actor.type]);
        mesh.castShadow = true;
        this.actorNodes.set(actor.id, mesh);
        this.actorGroup.add(mesh);
      }

      mesh.material = this.actorMaterials[actor.type];
      mesh.position.set(
        (actor.renderX - this.snapshot!.baseX + 0.5) * TILE_WORLD_SIZE,
        this.heightAt(actor.renderX, actor.renderY) * HEIGHT_SCALE + ACTOR_HEIGHT / 2 + 0.008,
        (this.maxY - actor.renderY + 0.5) * TILE_WORLD_SIZE,
      );
    }

    for (const [id, mesh] of this.actorNodes) {
      if (actors.some(actor => actor.id === id)) {
        continue;
      }

      this.actorNodes.delete(id);
      this.actorGroup.remove(mesh);
    }
  }

  setVisible(visible: boolean) {
    this.root.visible = visible;
  }

  applyPlacementMatrix(matrix: Matrix4) {
    this.root.matrix.copy(matrix);
    this.root.matrix.decompose(this.root.position, this.root.quaternion, this.root.scale);
  }

  getDebugState() {
    return {
      actorCount: this.actorGroup.children.length,
      objectCount: this.objectGroup.children.length,
      terrainChildren: this.terrainGroup.children.length,
    };
  }

  private rebuildTerrain(snapshot: SceneSnapshot) {
    this.terrainBuildCount += 1;
    disposeChildren(this.terrainGroup);

    const terrain = buildTerrainMesh(snapshot);
    const xCount = new Set(snapshot.tiles.map(tile => tile.x)).size;
    const zCount = new Set(snapshot.tiles.map(tile => tile.y)).size;
    const grid = new GridHelper(
      Math.max(xCount, zCount) * TILE_WORLD_SIZE,
      Math.max(xCount - 1, zCount - 1),
      '#d7d0b6',
      '#d7d0b6',
    );

    grid.position.set(
      ((xCount - 1) * TILE_WORLD_SIZE) / 2,
      0.002,
      ((zCount - 1) * TILE_WORLD_SIZE) / 2,
    );
    applyTransparency(grid.material);

    this.terrainGroup.add(terrain, grid);
  }

  private syncObjects(objects: SceneObject[]) {
    for (const object of objects) {
      let mesh = this.objectNodes.get(object.id);

      if (!mesh) {
        mesh = new Mesh(this.objectGeometries[object.kind], this.objectMaterials[object.kind]);
        mesh.castShadow = true;
        this.objectNodes.set(object.id, mesh);
        this.objectGroup.add(mesh);
      }

      mesh.position.set(
        (object.x - this.snapshot!.baseX + 0.5) * TILE_WORLD_SIZE,
        this.heightAt(object.x, object.y) * HEIGHT_SCALE + OBJECT_HEIGHT / 2 + 0.01,
        (this.maxY - object.y + 0.5) * TILE_WORLD_SIZE,
      );
      mesh.rotation.y = MathUtils.degToRad((hashString(object.id) % 360 + 360) % 360);
    }

    for (const [id, mesh] of this.objectNodes) {
      if (objects.some(object => object.id === id)) {
        continue;
      }

      this.objectNodes.delete(id);
      this.objectGroup.remove(mesh);
    }
  }

  private heightAt(worldX: number, worldY: number) {
    const roundedX = Math.round(worldX);
    const roundedY = Math.round(worldY);

    return this.heightMap.get(`${roundedX}:${roundedY}`) ?? 0;
  }
}

function disposeChildren(group: Group) {
  for (const child of group.children) {
    child.removeFromParent();
    disposeObject(child);
  }
}

function disposeObject(object: Object3D) {
  if (isMeshLike(object)) {
    object.geometry.dispose();
  }

  if (!isMaterialHolder(object)) {
    return;
  }

  const material = object.material;

  if (Array.isArray(material)) {
    for (const entry of material) {
      entry.dispose();
    }
  } else {
    material.dispose();
  }
}

function hashString(value: string) {
  let hash = 0;

  for (const character of value) {
    hash = Math.imul(31, hash) + character.charCodeAt(0);
  }

  return hash;
}

function applyTransparency(material: GridHelper['material']) {
  if (Array.isArray(material)) {
    for (const entry of material) {
      entry.opacity = 0.18;
      entry.transparent = true;
    }

    return;
  }

  material.opacity = 0.18;
  material.transparent = true;
}

function isMeshLike(object: Object3D): object is Object3D & {geometry: {dispose: () => void}} {
  return 'geometry' in object;
}

function isMaterialHolder(
  object: Object3D,
): object is Object3D & {material: {dispose: () => void} | Array<{dispose: () => void}>} {
  return 'material' in object;
}
