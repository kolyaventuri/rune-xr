import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  GridHelper,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  type Matrix4,
  type Object3D,
} from 'three';
import type {SceneObject, SceneSnapshot} from '@rune-xr/protocol';
import {ACTOR_HEIGHT, HEIGHT_SCALE, OBJECT_HEIGHT, TILE_WORLD_SIZE} from '../config.js';
import type {InterpolatedActor} from '../world/WorldStateStore.js';
import {buildTerrainMesh} from './TerrainMeshBuilder.js';

const WALL_WEST = 1;
const WALL_NORTH = 2;
const WALL_EAST = 4;
const WALL_SOUTH = 8;
const WALL_NORTH_WEST = 16;
const WALL_NORTH_EAST = 32;
const WALL_SOUTH_EAST = 64;
const WALL_SOUTH_WEST = 128;

const WALL_HEIGHT = OBJECT_HEIGHT * 1.85;
const WALL_THICKNESS = TILE_WORLD_SIZE * 0.13;
const WALL_POST_SIZE = TILE_WORLD_SIZE * 0.18;
const BUILDING_FOUNDATION_HEIGHT = OBJECT_HEIGHT * 0.32;
const BUILDING_BODY_HEIGHT = OBJECT_HEIGHT * 1.45;
const BUILDING_ROOF_HEIGHT = OBJECT_HEIGHT * 0.92;
const BUILDING_INSET = TILE_WORLD_SIZE * 0.08;
const ROOF_OVERHANG = TILE_WORLD_SIZE * 0.16;
const OBJECT_BASE_OFFSET = 0.006;

type GridCorner = {
  x: number;
  y: number;
};

type Cell = {
  x: number;
  y: number;
};

type Rectangle = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type WallSegment = {
  key: string;
  start: GridCorner;
  end: GridCorner;
  midpointX: number;
  midpointZ: number;
  length: number;
  rotationY: number;
  baseY: number;
};

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

  private readonly sharedGeometries = {
    box: new BoxGeometry(1, 1, 1),
    cylinder: new CylinderGeometry(0.5, 0.5, 1, 10),
    cone: new ConeGeometry(0.5, 1, 6),
    pyramid: new ConeGeometry(0.5, 1, 4),
    sphere: new SphereGeometry(0.5, 10, 10),
    crystal: new OctahedronGeometry(0.5),
  };

  private readonly objectMaterials = {
    wall: new MeshStandardMaterial({color: new Color('#766d62'), roughness: 0.92}),
    wallPost: new MeshStandardMaterial({color: new Color('#5f564c'), roughness: 0.95}),
    buildingFoundation: new MeshStandardMaterial({color: new Color('#7e735c'), roughness: 0.96}),
    buildingBody: new MeshStandardMaterial({color: new Color('#b9aa8f'), roughness: 0.9}),
    roof: new MeshStandardMaterial({color: new Color('#8f4d31'), roughness: 0.82}),
    treeTrunk: new MeshStandardMaterial({color: new Color('#7a5330'), roughness: 0.96}),
    treeCanopy: new MeshStandardMaterial({color: new Color('#7f8b3a'), roughness: 0.88}),
    prop: new MeshStandardMaterial({color: new Color('#8e744a'), roughness: 0.88}),
    propAccent: new MeshStandardMaterial({color: new Color('#d28a31'), roughness: 0.72}),
    decor: new MeshStandardMaterial({color: new Color('#d17a2b'), roughness: 0.78}),
    ground: new MeshStandardMaterial({color: new Color('#86664f'), roughness: 0.95}),
  };

  private readonly actorNodes = new Map<string, Mesh>();
  private heightMap = new Map<string, number>();
  private maxY = 0;
  private snapshot?: SceneSnapshot;

  constructor() {
    this.root.matrixAutoUpdate = true;
    this.root.add(this.terrainGroup, this.actorGroup, this.objectGroup);
  }

  applySnapshot(snapshot: SceneSnapshot, options: {terrainChanged: boolean; objectsChanged?: boolean}) {
    this.snapshot = snapshot;
    this.heightMap = new Map(snapshot.tiles.map(tile => [`${tile.x}:${tile.y}`, tile.height] as const));
    this.maxY = Math.max(snapshot.baseY, ...snapshot.tiles.map(tile => tile.y));

    if (options.terrainChanged || this.terrainGroup.children.length === 0) {
      this.rebuildTerrain(snapshot);
    }

    if (options.terrainChanged || options.objectsChanged !== false || this.objectGroup.children.length === 0) {
      this.rebuildObjects(snapshot.objects);
    }
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
        this.tileCenterX(actor.renderX),
        this.tileHeightWorld(actor.renderX, actor.renderY) + ACTOR_HEIGHT / 2 + 0.008,
        this.tileCenterZ(actor.renderY),
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
      objectCount: this.snapshot?.objects.length ?? 0,
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

  private rebuildObjects(objects: SceneObject[]) {
    disposeChildren(this.objectGroup);

    const {segments, enclosedRegions} = this.collectWallData(objects);
    this.addWallSegments(segments);

    const enclosedCells = new Set<string>();

    for (const region of enclosedRegions) {
      for (const cell of region) {
        enclosedCells.add(tileKey(cell.x, cell.y));
      }

      for (const rectangle of decomposeRegion(region)) {
        this.addBuildingRectangle(rectangle);
      }
    }

    this.addProps(objects, enclosedCells);
  }

  private collectWallData(objects: SceneObject[]) {
    const segmentMap = new Map<string, WallSegment>();
    const barriers = new Set<string>();

    for (const object of objects) {
      if (object.kind !== 'wall') {
        continue;
      }

      for (const orientation of [object.wallOrientationA, object.wallOrientationB]) {
        if (!orientation) {
          continue;
        }

        for (const bit of [
          WALL_WEST,
          WALL_NORTH,
          WALL_EAST,
          WALL_SOUTH,
          WALL_NORTH_WEST,
          WALL_NORTH_EAST,
          WALL_SOUTH_EAST,
          WALL_SOUTH_WEST,
        ]) {
          if ((orientation & bit) === 0) {
            continue;
          }

          const segment = this.createWallSegment(object.x, object.y, bit);

          if (!segmentMap.has(segment.key)) {
            segmentMap.set(segment.key, segment);
          }

          const barrier = createBarrierKey(object.x, object.y, bit);
          if (barrier) {
            barriers.add(barrier);
          }
        }
      }
    }

    return {
      segments: [...segmentMap.values()],
      enclosedRegions: this.findEnclosedRegions(barriers),
    };
  }

  private createWallSegment(worldX: number, worldY: number, bit: number): WallSegment {
    const {start, end} = cornersForWallBit(worldX, worldY, bit);
    const startX = this.edgeX(start.x);
    const startZ = this.edgeZ(start.y);
    const endX = this.edgeX(end.x);
    const endZ = this.edgeZ(end.y);

    return {
      key: normalizedSegmentKey(start, end),
      start,
      end,
      midpointX: (startX + endX) / 2,
      midpointZ: (startZ + endZ) / 2,
      length: Math.hypot(endX - startX, endZ - startZ),
      rotationY: Math.atan2(endZ - startZ, endX - startX),
      baseY: Math.max(this.cornerHeightWorld(start.x, start.y), this.cornerHeightWorld(end.x, end.y)) + OBJECT_BASE_OFFSET,
    };
  }

  private addWallSegments(segments: WallSegment[]) {
    const cornerKeys = new Set<string>();

    for (const segment of segments) {
      const wall = this.createSharedMesh(this.sharedGeometries.box, this.objectMaterials.wall, 'wall-segment');
      wall.scale.set(segment.length, WALL_HEIGHT, WALL_THICKNESS);
      wall.position.set(
        segment.midpointX,
        segment.baseY + WALL_HEIGHT / 2,
        segment.midpointZ,
      );
      wall.rotation.y = segment.rotationY;
      this.objectGroup.add(wall);

      cornerKeys.add(cornerKey(segment.start.x, segment.start.y));
      cornerKeys.add(cornerKey(segment.end.x, segment.end.y));
    }

    for (const key of cornerKeys) {
      const [cornerX, cornerY] = parseCornerKey(key);
      const post = this.createSharedMesh(this.sharedGeometries.box, this.objectMaterials.wallPost, 'wall-post');
      post.scale.set(WALL_POST_SIZE, WALL_HEIGHT * 1.05, WALL_POST_SIZE);
      post.position.set(
        this.edgeX(cornerX),
        this.cornerHeightWorld(cornerX, cornerY) + WALL_HEIGHT * 0.525 + OBJECT_BASE_OFFSET,
        this.edgeZ(cornerY),
      );
      this.objectGroup.add(post);
    }
  }

  private findEnclosedRegions(barriers: Set<string>) {
    if (!this.snapshot) {
      return [] as Cell[][];
    }

    const cells = new Set(this.snapshot.tiles.map(tile => tileKey(tile.x, tile.y)));
    const reachable = new Set<string>();
    const queue: Cell[] = [];

    for (const tile of this.snapshot.tiles) {
      const key = tileKey(tile.x, tile.y);

      if (reachable.has(key) || !this.isOpenToOutside(tile.x, tile.y, cells, barriers)) {
        continue;
      }

      reachable.add(key);
      queue.push({x: tile.x, y: tile.y});
    }

    while (queue.length > 0) {
      const cell = queue.shift()!;

      for (const neighbor of neighborsForCell(cell.x, cell.y)) {
        const key = tileKey(neighbor.x, neighbor.y);

        if (!cells.has(key) || reachable.has(key) || barriers.has(neighbor.barrier)) {
          continue;
        }

        reachable.add(key);
        queue.push({x: neighbor.x, y: neighbor.y});
      }
    }

    const unseen = [...cells].filter(key => !reachable.has(key));
    const regions: Cell[][] = [];
    const remaining = new Set(unseen);

    while (remaining.size > 0) {
      const startKey = remaining.values().next().value as string;
      const start = parseTileKey(startKey);
      const region: Cell[] = [];
      const regionQueue = [start];

      remaining.delete(startKey);

      while (regionQueue.length > 0) {
        const cell = regionQueue.shift()!;

        region.push(cell);

        for (const neighbor of neighborsForCell(cell.x, cell.y)) {
          const key = tileKey(neighbor.x, neighbor.y);

          if (!remaining.has(key) || barriers.has(neighbor.barrier)) {
            continue;
          }

          remaining.delete(key);
          regionQueue.push({x: neighbor.x, y: neighbor.y});
        }
      }

      if (region.length > 0 && region.length <= 64) {
        regions.push(region);
      }
    }

    return regions;
  }

  private isOpenToOutside(worldX: number, worldY: number, cells: Set<string>, barriers: Set<string>) {
    for (const neighbor of neighborsForCell(worldX, worldY)) {
      if (cells.has(tileKey(neighbor.x, neighbor.y)) || barriers.has(neighbor.barrier)) {
        continue;
      }

      return true;
    }

    return false;
  }

  private addBuildingRectangle(rectangle: Rectangle) {
    const west = this.edgeX(rectangle.minX) + BUILDING_INSET;
    const east = this.edgeX(rectangle.maxX + 1) - BUILDING_INSET;
    const north = this.edgeZ(rectangle.maxY + 1) + BUILDING_INSET;
    const south = this.edgeZ(rectangle.minY) - BUILDING_INSET;
    const width = east - west;
    const depth = south - north;

    if (width <= 0 || depth <= 0) {
      return;
    }

    const centerX = (west + east) / 2;
    const centerZ = (north + south) / 2;
    const baseY = this.maxTileHeightWorld(rectangle) + OBJECT_BASE_OFFSET;

    const foundation = this.createSharedMesh(
      this.sharedGeometries.box,
      this.objectMaterials.buildingFoundation,
      'building-foundation',
    );
    foundation.scale.set(width, BUILDING_FOUNDATION_HEIGHT, depth);
    foundation.position.set(centerX, baseY + BUILDING_FOUNDATION_HEIGHT / 2, centerZ);
    this.objectGroup.add(foundation);

    const body = this.createSharedMesh(this.sharedGeometries.box, this.objectMaterials.buildingBody, 'building-body');
    body.scale.set(width, BUILDING_BODY_HEIGHT, depth);
    body.position.set(
      centerX,
      baseY + BUILDING_FOUNDATION_HEIGHT + BUILDING_BODY_HEIGHT / 2,
      centerZ,
    );
    this.objectGroup.add(body);

    const roof = this.createSharedMesh(this.sharedGeometries.pyramid, this.objectMaterials.roof, 'building-roof');
    roof.scale.set(width + ROOF_OVERHANG, BUILDING_ROOF_HEIGHT, depth + ROOF_OVERHANG);
    roof.position.set(
      centerX,
      baseY + BUILDING_FOUNDATION_HEIGHT + BUILDING_BODY_HEIGHT + BUILDING_ROOF_HEIGHT / 2,
      centerZ,
    );
    roof.rotation.y = Math.PI / 4;
    this.objectGroup.add(roof);
  }

  private addProps(objects: SceneObject[], enclosedCells: Set<string>) {
    for (const object of objects) {
      if (object.kind === 'wall') {
        continue;
      }

      const normalizedName = object.name?.toLowerCase() ?? '';

      if (
        object.kind === 'game'
        && enclosedCells.has(tileKey(object.x, object.y))
        && (normalizedName.includes('wall') || normalizedName.includes('roof') || normalizedName.includes('building'))
      ) {
        continue;
      }

      if (object.kind === 'game' && normalizedName.includes('tree')) {
        this.addTree(object);
        continue;
      }

      if (object.kind === 'decor' && normalizedName.includes('banner')) {
        this.addBanner(object);
        continue;
      }

      if (object.kind === 'ground') {
        this.addGroundProp(object);
        continue;
      }

      if (object.kind === 'game' && ((object.sizeX ?? 1) > 1 || (object.sizeY ?? 1) > 1 || normalizedName.includes('stall'))) {
        this.addLargeProp(object);
        continue;
      }

      this.addGenericProp(object);
    }
  }

  private addTree(object: SceneObject) {
    const baseY = this.tileHeightWorld(object.x, object.y) + OBJECT_BASE_OFFSET;
    const centerX = this.tileCenterX(object.x);
    const centerZ = this.tileCenterZ(object.y);
    const trunkHeight = OBJECT_HEIGHT * 1.2;
    const canopyHeight = OBJECT_HEIGHT * 1.8;

    const trunk = this.createSharedMesh(this.sharedGeometries.cylinder, this.objectMaterials.treeTrunk, 'object-tree-trunk');
    trunk.scale.set(TILE_WORLD_SIZE * 0.18, trunkHeight, TILE_WORLD_SIZE * 0.18);
    trunk.position.set(centerX, baseY + trunkHeight / 2, centerZ);
    this.objectGroup.add(trunk);

    const canopy = this.createSharedMesh(this.sharedGeometries.cone, this.objectMaterials.treeCanopy, 'object-tree-canopy');
    canopy.scale.set(TILE_WORLD_SIZE * 0.82, canopyHeight, TILE_WORLD_SIZE * 0.82);
    canopy.position.set(centerX, baseY + trunkHeight + canopyHeight / 2 - OBJECT_HEIGHT * 0.12, centerZ);
    canopy.rotation.y = MathUtils.degToRad(normalizedRotationDegrees(object));
    this.objectGroup.add(canopy);
  }

  private addBanner(object: SceneObject) {
    const baseY = this.tileHeightWorld(object.x, object.y) + OBJECT_BASE_OFFSET;
    const centerX = this.tileCenterX(object.x);
    const centerZ = this.tileCenterZ(object.y);
    const rotationY = MathUtils.degToRad(normalizedRotationDegrees(object));

    const pole = this.createSharedMesh(this.sharedGeometries.box, this.objectMaterials.wallPost, 'object-banner-pole');
    pole.scale.set(TILE_WORLD_SIZE * 0.08, OBJECT_HEIGHT * 1.8, TILE_WORLD_SIZE * 0.08);
    pole.position.set(centerX, baseY + OBJECT_HEIGHT * 0.9, centerZ);
    this.objectGroup.add(pole);

    const cloth = this.createSharedMesh(this.sharedGeometries.box, this.objectMaterials.decor, 'object-banner-cloth');
    cloth.scale.set(TILE_WORLD_SIZE * 0.46, OBJECT_HEIGHT * 0.72, TILE_WORLD_SIZE * 0.06);
    cloth.position.set(centerX + TILE_WORLD_SIZE * 0.18, baseY + OBJECT_HEIGHT * 1.1, centerZ);
    cloth.rotation.y = rotationY;
    this.objectGroup.add(cloth);
  }

  private addGroundProp(object: SceneObject) {
    const baseY = this.tileHeightWorld(object.x, object.y) + OBJECT_BASE_OFFSET;
    const prop = this.createSharedMesh(this.sharedGeometries.sphere, this.objectMaterials.ground, 'object-ground');
    prop.scale.set(TILE_WORLD_SIZE * 0.42, OBJECT_HEIGHT * 0.55, TILE_WORLD_SIZE * 0.42);
    prop.position.set(this.tileCenterX(object.x), baseY + OBJECT_HEIGHT * 0.24, this.tileCenterZ(object.y));
    this.objectGroup.add(prop);
  }

  private addLargeProp(object: SceneObject) {
    const baseY = this.tileHeightWorld(object.x, object.y) + OBJECT_BASE_OFFSET;
    const centerX = this.tileCenterX(object.x);
    const centerZ = this.tileCenterZ(object.y);
    const width = Math.max((object.sizeX ?? 1) * TILE_WORLD_SIZE * 0.72, TILE_WORLD_SIZE * 0.72);
    const depth = Math.max((object.sizeY ?? 1) * TILE_WORLD_SIZE * 0.72, TILE_WORLD_SIZE * 0.52);
    const rotationY = MathUtils.degToRad(normalizedRotationDegrees(object));

    const base = this.createSharedMesh(this.sharedGeometries.box, this.objectMaterials.prop, 'object-large-base');
    base.scale.set(width, OBJECT_HEIGHT * 0.42, depth);
    base.position.set(centerX, baseY + OBJECT_HEIGHT * 0.21, centerZ);
    base.rotation.y = rotationY;
    this.objectGroup.add(base);

    const canopy = this.createSharedMesh(this.sharedGeometries.box, this.objectMaterials.propAccent, 'object-large-canopy');
    canopy.scale.set(width + TILE_WORLD_SIZE * 0.08, OBJECT_HEIGHT * 0.18, depth + TILE_WORLD_SIZE * 0.08);
    canopy.position.set(centerX, baseY + OBJECT_HEIGHT * 0.82, centerZ);
    canopy.rotation.y = rotationY;
    this.objectGroup.add(canopy);
  }

  private addGenericProp(object: SceneObject) {
    const baseY = this.tileHeightWorld(object.x, object.y) + OBJECT_BASE_OFFSET;
    const width = Math.max((object.sizeX ?? 1) * TILE_WORLD_SIZE * 0.42, TILE_WORLD_SIZE * 0.32);
    const depth = Math.max((object.sizeY ?? 1) * TILE_WORLD_SIZE * 0.42, TILE_WORLD_SIZE * 0.32);
    const prop = this.createSharedMesh(this.sharedGeometries.crystal, this.objectMaterials.prop, 'object-generic');
    prop.scale.set(width, OBJECT_HEIGHT * 0.82, depth);
    prop.position.set(this.tileCenterX(object.x), baseY + OBJECT_HEIGHT * 0.4, this.tileCenterZ(object.y));
    prop.rotation.y = MathUtils.degToRad(normalizedRotationDegrees(object));
    this.objectGroup.add(prop);
  }

  private createSharedMesh(
    geometry: BoxGeometry | CylinderGeometry | ConeGeometry | SphereGeometry | OctahedronGeometry,
    material: MeshStandardMaterial,
    name: string,
  ) {
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.disposeGeometry = false;
    mesh.userData.disposeMaterial = false;
    return mesh;
  }

  private tileCenterX(worldX: number) {
    return (worldX - this.snapshot!.baseX + 0.5) * TILE_WORLD_SIZE;
  }

  private tileCenterZ(worldY: number) {
    return (this.maxY - worldY + 0.5) * TILE_WORLD_SIZE;
  }

  private edgeX(worldXLine: number) {
    return (worldXLine - this.snapshot!.baseX) * TILE_WORLD_SIZE;
  }

  private edgeZ(worldYLine: number) {
    return (this.maxY - worldYLine + 1) * TILE_WORLD_SIZE;
  }

  private tileHeightWorld(worldX: number, worldY: number) {
    return this.heightAt(worldX, worldY) * HEIGHT_SCALE;
  }

  private cornerHeightWorld(cornerX: number, cornerY: number) {
    let maxHeight = 0;
    let found = false;

    for (const tileX of [cornerX - 1, cornerX]) {
      for (const tileY of [cornerY - 1, cornerY]) {
        const height = this.heightMap.get(`${tileX}:${tileY}`);

        if (height === undefined) {
          continue;
        }

        found = true;
        maxHeight = Math.max(maxHeight, height);
      }
    }

    return (found ? maxHeight : 0) * HEIGHT_SCALE;
  }

  private maxTileHeightWorld(rectangle: Rectangle) {
    let maxHeight = 0;

    for (let tileX = rectangle.minX; tileX <= rectangle.maxX; tileX += 1) {
      for (let tileY = rectangle.minY; tileY <= rectangle.maxY; tileY += 1) {
        maxHeight = Math.max(maxHeight, this.heightAt(tileX, tileY));
      }
    }

    return maxHeight * HEIGHT_SCALE;
  }

  private heightAt(worldX: number, worldY: number) {
    const roundedX = Math.round(worldX);
    const roundedY = Math.round(worldY);

    return this.heightMap.get(`${roundedX}:${roundedY}`) ?? 0;
  }
}

function cornersForWallBit(worldX: number, worldY: number, bit: number) {
  switch (bit) {
    case WALL_WEST: {
      return {
        start: {x: worldX, y: worldY},
        end: {x: worldX, y: worldY + 1},
      };
    }

    case WALL_NORTH: {
      return {
        start: {x: worldX, y: worldY + 1},
        end: {x: worldX + 1, y: worldY + 1},
      };
    }

    case WALL_EAST: {
      return {
        start: {x: worldX + 1, y: worldY},
        end: {x: worldX + 1, y: worldY + 1},
      };
    }

    case WALL_SOUTH: {
      return {
        start: {x: worldX, y: worldY},
        end: {x: worldX + 1, y: worldY},
      };
    }

    case WALL_NORTH_WEST:
    case WALL_SOUTH_EAST: {
      return {
        start: {x: worldX, y: worldY + 1},
        end: {x: worldX + 1, y: worldY},
      };
    }

    case WALL_NORTH_EAST:
    case WALL_SOUTH_WEST: {
      return {
        start: {x: worldX + 1, y: worldY + 1},
        end: {x: worldX, y: worldY},
      };
    }

    default: {
      return {
        start: {x: worldX, y: worldY},
        end: {x: worldX + 1, y: worldY},
      };
    }
  }
}

function createBarrierKey(worldX: number, worldY: number, bit: number) {
  switch (bit) {
    case WALL_WEST: {
      return `V:${worldX}:${worldY}`;
    }

    case WALL_NORTH: {
      return `H:${worldX}:${worldY + 1}`;
    }

    case WALL_EAST: {
      return `V:${worldX + 1}:${worldY}`;
    }

    case WALL_SOUTH: {
      return `H:${worldX}:${worldY}`;
    }

    default: {
      return null;
    }
  }
}

function normalizedSegmentKey(start: GridCorner, end: GridCorner) {
  const startKey = cornerKey(start.x, start.y);
  const endKey = cornerKey(end.x, end.y);

  return startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;
}

function cornerKey(x: number, y: number) {
  return `${x}:${y}`;
}

function parseCornerKey(key: string): [number, number] {
  const [x, y] = key.split(':').map(Number);
  return [x, y];
}

function neighborsForCell(worldX: number, worldY: number) {
  return [
    {x: worldX - 1, y: worldY, barrier: `V:${worldX}:${worldY}`},
    {x: worldX + 1, y: worldY, barrier: `V:${worldX + 1}:${worldY}`},
    {x: worldX, y: worldY - 1, barrier: `H:${worldX}:${worldY}`},
    {x: worldX, y: worldY + 1, barrier: `H:${worldX}:${worldY + 1}`},
  ];
}

function decomposeRegion(region: Cell[]) {
  const remaining = new Set(region.map(cell => tileKey(cell.x, cell.y)));
  const rectangles: Rectangle[] = [];

  while (remaining.size > 0) {
    const start = [...remaining]
      .map(parseTileKey)
      .sort((left, right) => left.y - right.y || left.x - right.x)[0]!;
    let width = 1;
    let height = 1;

    while (remaining.has(tileKey(start.x + width, start.y))) {
      width += 1;
    }

    let canExtend = true;
    while (canExtend) {
      const nextY = start.y + height;

      for (let offsetX = 0; offsetX < width; offsetX += 1) {
        if (!remaining.has(tileKey(start.x + offsetX, nextY))) {
          canExtend = false;
          break;
        }
      }

      if (canExtend) {
        height += 1;
      }
    }

    rectangles.push({
      minX: start.x,
      maxX: start.x + width - 1,
      minY: start.y,
      maxY: start.y + height - 1,
    });

    for (let offsetX = 0; offsetX < width; offsetX += 1) {
      for (let offsetY = 0; offsetY < height; offsetY += 1) {
        remaining.delete(tileKey(start.x + offsetX, start.y + offsetY));
      }
    }
  }

  return rectangles;
}

function tileKey(x: number, y: number) {
  return `${x}:${y}`;
}

function parseTileKey(key: string): Cell {
  const [x, y] = key.split(':').map(Number);
  return {x, y};
}

function normalizedRotationDegrees(object: SceneObject) {
  return object.rotationDegrees ?? ((hashString(object.id) % 360) + 360) % 360;
}

function disposeChildren(group: Group) {
  for (const child of [...group.children]) {
    disposeObject(child);
  }
}

function disposeObject(object: Object3D) {
  for (const child of [...object.children]) {
    disposeObject(child);
  }

  if (isMeshLike(object) && object.userData.disposeGeometry !== false) {
    object.geometry.dispose();
  }

  if (isMaterialHolder(object) && object.userData.disposeMaterial !== false) {
    const material = object.material;

    if (Array.isArray(material)) {
      for (const entry of material) {
        entry.dispose();
      }
    } else {
      material.dispose();
    }
  }

  object.removeFromParent();
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
