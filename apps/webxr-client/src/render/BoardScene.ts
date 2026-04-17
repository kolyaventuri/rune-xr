import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  GridHelper,
  Group,
  InstancedMesh,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  SphereGeometry,
  type Matrix4,
} from 'three';
import type {ObjectModelDefinition, SceneObject, SceneSnapshot, TextureDefinition} from '@rune-xr/protocol';
import {ACTOR_HEIGHT, HEIGHT_SCALE, OBJECT_HEIGHT, TILE_WORLD_SIZE} from '../config.js';
import type {InterpolatedActor} from '../world/WorldStateStore.js';
import {createObjectMeshesFromData} from './ObjectMeshBuilder.js';
import type {ObjectMeshBuildData, SceneMeshSnapshot, TerrainMeshBuildData} from './MeshBuildData.js';
import {createSceneMeshBuildRunner} from './SceneMeshBuildRunner.js';
import {createTerrainMeshesFromData} from './TerrainMeshBuilder.js';
import {TerrainTextureAtlas} from './TerrainTextureAtlas.js';

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

type BuildMode = 'idle' | 'inline' | 'worker';

type BuildPhaseStats = {
  mode: BuildMode;
  buildMs: number;
  commitMs: number;
  totalMs: number;
  p95Ms: number;
  completedBuilds: number;
  staleDrops: number;
  instancedBatches: number;
  instancedInstances: number;
};

type BuildRequestState = {
  startedAt: number;
  mode: Exclude<BuildMode, 'idle'>;
};

type InstanceTransform = {
  positionX: number;
  positionY: number;
  positionZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  rotationY: number;
};

type ProxyInstanceBatch = {
  name: string;
  geometry: BoxGeometry | CylinderGeometry | ConeGeometry | SphereGeometry | OctahedronGeometry;
  material: MeshStandardMaterial;
  transforms: InstanceTransform[];
};

type ProxyInstanceBatches = {
  wallSegments: ProxyInstanceBatch;
  wallPosts: ProxyInstanceBatch;
  buildingFoundations: ProxyInstanceBatch;
  buildingBodies: ProxyInstanceBatch;
  buildingRoofs: ProxyInstanceBatch;
  treeTrunks: ProxyInstanceBatch;
  treeCanopies: ProxyInstanceBatch;
  bannerPoles: ProxyInstanceBatch;
  bannerCloths: ProxyInstanceBatch;
  groundProps: ProxyInstanceBatch;
  largePropBases: ProxyInstanceBatch;
  largePropCanopies: ProxyInstanceBatch;
  genericProps: ProxyInstanceBatch;
};

type BuildStats = {
  terrain: BuildPhaseStats;
  objects: BuildPhaseStats;
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
  private readonly buildStats: BuildStats = {
    terrain: createBuildPhaseStats(),
    objects: createBuildPhaseStats(),
  };
  private readonly buildSamples = {
    terrain: [] as number[],
    objects: [] as number[],
  };
  private readonly instanceTransformDummy = new Object3D();
  private readonly meshBuildRunner = createSceneMeshBuildRunner();
  private readonly objectModelStore = new Map<string, NonNullable<SceneObject['model']>>();
  private readonly pendingObjectBuilds = new Map<number, BuildRequestState>();
  private readonly pendingTerrainBuilds = new Map<number, BuildRequestState>();
  private readonly terrainTextureAtlas = new TerrainTextureAtlas();
  private heightMap = new Map<string, number>();
  private objectBuildRequestId = 0;
  private maxY = 0;
  private snapshot?: SceneSnapshot;
  private terrainBuildRequestId = 0;

  constructor() {
    this.root.matrixAutoUpdate = true;
    this.root.add(this.terrainGroup, this.actorGroup, this.objectGroup);
  }

  applySnapshot(snapshot: SceneSnapshot, options: {terrainChanged: boolean; objectsChanged?: boolean}) {
    this.snapshot = snapshot;
    this.heightMap = new Map(snapshot.tiles.map(tile => [
      `${tile.x}:${tile.y}`,
      tile.surface?.bridgeHeight ?? tile.height,
    ] as const));
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

  async applyTextureBatch(textures: TextureDefinition[]) {
    const updatedObjectTextureIds = await this.terrainTextureAtlas.upsertBatch(textures);

    if (this.snapshot && updatedObjectTextureIds.length > 0) {
      this.rebuildObjects(this.snapshot.objects);
    }
  }

  applyObjectModelBatch(models: ObjectModelDefinition[]) {
    let shouldRebuildObjects = false;

    for (const definition of models) {
      this.objectModelStore.set(definition.key, definition.model);

      if (this.snapshot?.objects.some(object => object.modelKey === definition.key)) {
        shouldRebuildObjects = true;
      }
    }

    if (shouldRebuildObjects && this.snapshot) {
      this.rebuildObjects(this.snapshot.objects);
    }
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

  getBuildStats() {
    return {
      terrain: {...this.buildStats.terrain},
      objects: {...this.buildStats.objects},
    };
  }

  private rebuildTerrain(snapshot: SceneSnapshot) {
    const requestId = this.terrainBuildRequestId + 1;
    const startedAt = performance.now();

    this.terrainBuildRequestId = requestId;

    const maybeBuild = this.meshBuildRunner.buildTerrain(toSceneMeshSnapshot(snapshot));

    if (isPromiseLike(maybeBuild)) {
      this.pendingTerrainBuilds.set(requestId, {startedAt, mode: 'worker'});
      void maybeBuild.then(data => {
        this.commitTerrainRebuild(requestId, snapshot, data);
      }).catch(error => {
        this.handleBuildFailure(this.pendingTerrainBuilds, requestId, 'Terrain rebuild', error);
      });
      return;
    }

    this.pendingTerrainBuilds.set(requestId, {startedAt, mode: 'inline'});
    this.commitTerrainRebuild(requestId, snapshot, maybeBuild);
  }

  private rebuildObjects(objects: SceneObject[]) {
    const resolvedObjects = objects.map(object => ({
      ...object,
      model: this.resolveObjectModel(object),
    }));
    const modelObjects = resolvedObjects.filter(object => object.model);
    const requestId = this.objectBuildRequestId + 1;
    const startedAt = performance.now();

    this.objectBuildRequestId = requestId;

    if (!this.snapshot) {
      this.pendingObjectBuilds.set(requestId, {startedAt, mode: 'inline'});
      this.commitObjectRebuild(requestId, resolvedObjects, {textured: []});
      return;
    }

    const maybeBuild = this.meshBuildRunner.buildObjects(
      toSceneMeshSnapshot(this.snapshot),
      modelObjects,
      collectLoadedObjectTextureIds(modelObjects, this.terrainTextureAtlas),
    );

    if (isPromiseLike(maybeBuild)) {
      this.pendingObjectBuilds.set(requestId, {startedAt, mode: 'worker'});
      void maybeBuild.then(data => {
        this.commitObjectRebuild(requestId, resolvedObjects, data);
      }).catch(error => {
        this.handleBuildFailure(this.pendingObjectBuilds, requestId, 'Object rebuild', error);
      });
      return;
    }

    this.pendingObjectBuilds.set(requestId, {startedAt, mode: 'inline'});
    this.commitObjectRebuild(requestId, resolvedObjects, maybeBuild);
  }

  private commitTerrainRebuild(requestId: number, snapshot: SceneSnapshot, data: TerrainMeshBuildData) {
    const request = this.pendingTerrainBuilds.get(requestId);

    if (!request) {
      return;
    }

    this.pendingTerrainBuilds.delete(requestId);

    if (requestId !== this.terrainBuildRequestId) {
      this.buildStats.terrain.staleDrops += 1;
      return;
    }

    const commitStartedAt = performance.now();
    const buildMs = commitStartedAt - request.startedAt;

    this.terrainBuildCount += 1;
    disposeChildren(this.terrainGroup);

    const terrain = createTerrainMeshesFromData(data, this.terrainTextureAtlas.texture);
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

    this.terrainGroup.add(terrain.colorMesh);

    if (terrain.texturedMesh) {
      this.terrainGroup.add(terrain.texturedMesh);
    }

    if (terrain.bridgeDeckMesh) {
      this.terrainGroup.add(terrain.bridgeDeckMesh);
    }

    this.terrainGroup.add(grid);
    recordBuildPhaseStats(
      this.buildStats.terrain,
      this.buildSamples.terrain,
      request.mode,
      buildMs,
      performance.now() - commitStartedAt,
    );
  }

  private commitObjectRebuild(requestId: number, resolvedObjects: SceneObject[], data: ObjectMeshBuildData) {
    const request = this.pendingObjectBuilds.get(requestId);

    if (!request) {
      return;
    }

    this.pendingObjectBuilds.delete(requestId);

    if (requestId !== this.objectBuildRequestId) {
      this.buildStats.objects.staleDrops += 1;
      return;
    }

    const commitStartedAt = performance.now();
    const buildMs = commitStartedAt - request.startedAt;

    disposeChildren(this.objectGroup);

    if (data.color || data.textured.length > 0) {
      const meshes = createObjectMeshesFromData(
        data,
        textureId => this.terrainTextureAtlas.getObjectTexture(textureId),
      );

      this.objectGroup.add(meshes.colorMesh);

      for (const texturedMesh of meshes.texturedMeshes) {
        this.objectGroup.add(texturedMesh);
      }
    }

    const proxyObjects = resolvedObjects.filter(object => !object.model);
    const {segments, enclosedRegions} = this.collectWallData(proxyObjects);
    const enclosedCells = new Set<string>();
    const proxyBatches = this.createProxyInstanceBatches();

    this.addWallSegments(segments, proxyBatches);

    for (const region of enclosedRegions) {
      for (const cell of region) {
        enclosedCells.add(tileKey(cell.x, cell.y));
      }

      for (const rectangle of decomposeRegion(region)) {
        this.addBuildingRectangle(rectangle, proxyBatches);
      }
    }

    this.addProps(proxyObjects, enclosedCells, proxyBatches);
    const proxyBatchStats = this.flushProxyInstanceBatches(proxyBatches);

    recordBuildPhaseStats(
      this.buildStats.objects,
      this.buildSamples.objects,
      request.mode,
      buildMs,
      performance.now() - commitStartedAt,
      proxyBatchStats,
    );
  }

  private resolveObjectModel(object: SceneObject) {
    if (object.model) {
      return object.model;
    }

    if (!object.modelKey) {
      return undefined;
    }

    return this.objectModelStore.get(object.modelKey);
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

  private addWallSegments(segments: WallSegment[], batches: ProxyInstanceBatches) {
    const cornerKeys = new Set<string>();

    for (const segment of segments) {
      pushInstanceTransform(batches.wallSegments, {
        positionX: segment.midpointX,
        positionY: segment.baseY + WALL_HEIGHT / 2,
        positionZ: segment.midpointZ,
        scaleX: segment.length,
        scaleY: WALL_HEIGHT,
        scaleZ: WALL_THICKNESS,
        rotationY: segment.rotationY,
      });

      cornerKeys.add(cornerKey(segment.start.x, segment.start.y));
      cornerKeys.add(cornerKey(segment.end.x, segment.end.y));
    }

    for (const key of cornerKeys) {
      const [cornerX, cornerY] = parseCornerKey(key);
      pushInstanceTransform(batches.wallPosts, {
        positionX: this.edgeX(cornerX),
        positionY: this.cornerHeightWorld(cornerX, cornerY) + WALL_HEIGHT * 0.525 + OBJECT_BASE_OFFSET,
        positionZ: this.edgeZ(cornerY),
        scaleX: WALL_POST_SIZE,
        scaleY: WALL_HEIGHT * 1.05,
        scaleZ: WALL_POST_SIZE,
        rotationY: 0,
      });
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

  private addBuildingRectangle(rectangle: Rectangle, batches: ProxyInstanceBatches) {
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

    pushInstanceTransform(batches.buildingFoundations, {
      positionX: centerX,
      positionY: baseY + BUILDING_FOUNDATION_HEIGHT / 2,
      positionZ: centerZ,
      scaleX: width,
      scaleY: BUILDING_FOUNDATION_HEIGHT,
      scaleZ: depth,
      rotationY: 0,
    });

    pushInstanceTransform(batches.buildingBodies, {
      positionX: centerX,
      positionY: baseY + BUILDING_FOUNDATION_HEIGHT + BUILDING_BODY_HEIGHT / 2,
      positionZ: centerZ,
      scaleX: width,
      scaleY: BUILDING_BODY_HEIGHT,
      scaleZ: depth,
      rotationY: 0,
    });

    pushInstanceTransform(batches.buildingRoofs, {
      positionX: centerX,
      positionY: baseY + BUILDING_FOUNDATION_HEIGHT + BUILDING_BODY_HEIGHT + BUILDING_ROOF_HEIGHT / 2,
      positionZ: centerZ,
      scaleX: width + ROOF_OVERHANG,
      scaleY: BUILDING_ROOF_HEIGHT,
      scaleZ: depth + ROOF_OVERHANG,
      rotationY: Math.PI / 4,
    });
  }

  private addProps(objects: SceneObject[], enclosedCells: Set<string>, batches: ProxyInstanceBatches) {
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
        this.addTree(object, batches);
        continue;
      }

      if (object.kind === 'decor' && normalizedName.includes('banner')) {
        this.addBanner(object, batches);
        continue;
      }

      if (object.kind === 'ground') {
        this.addGroundProp(object, batches);
        continue;
      }

      if (object.kind === 'game' && ((object.sizeX ?? 1) > 1 || (object.sizeY ?? 1) > 1 || normalizedName.includes('stall'))) {
        this.addLargeProp(object, batches);
        continue;
      }

      this.addGenericProp(object, batches);
    }
  }

  private addTree(object: SceneObject, batches: ProxyInstanceBatches) {
    const baseY = this.tileHeightWorld(object.x, object.y) + OBJECT_BASE_OFFSET;
    const centerX = this.tileCenterX(object.x);
    const centerZ = this.tileCenterZ(object.y);
    const trunkHeight = OBJECT_HEIGHT * 1.2;
    const canopyHeight = OBJECT_HEIGHT * 1.8;

    pushInstanceTransform(batches.treeTrunks, {
      positionX: centerX,
      positionY: baseY + trunkHeight / 2,
      positionZ: centerZ,
      scaleX: TILE_WORLD_SIZE * 0.18,
      scaleY: trunkHeight,
      scaleZ: TILE_WORLD_SIZE * 0.18,
      rotationY: 0,
    });

    pushInstanceTransform(batches.treeCanopies, {
      positionX: centerX,
      positionY: baseY + trunkHeight + canopyHeight / 2 - OBJECT_HEIGHT * 0.12,
      positionZ: centerZ,
      scaleX: TILE_WORLD_SIZE * 0.82,
      scaleY: canopyHeight,
      scaleZ: TILE_WORLD_SIZE * 0.82,
      rotationY: MathUtils.degToRad(normalizedRotationDegrees(object)),
    });
  }

  private addBanner(object: SceneObject, batches: ProxyInstanceBatches) {
    const baseY = this.tileHeightWorld(object.x, object.y) + OBJECT_BASE_OFFSET;
    const centerX = this.tileCenterX(object.x);
    const centerZ = this.tileCenterZ(object.y);
    const rotationY = MathUtils.degToRad(normalizedRotationDegrees(object));

    pushInstanceTransform(batches.bannerPoles, {
      positionX: centerX,
      positionY: baseY + OBJECT_HEIGHT * 0.9,
      positionZ: centerZ,
      scaleX: TILE_WORLD_SIZE * 0.08,
      scaleY: OBJECT_HEIGHT * 1.8,
      scaleZ: TILE_WORLD_SIZE * 0.08,
      rotationY: 0,
    });

    pushInstanceTransform(batches.bannerCloths, {
      positionX: centerX + TILE_WORLD_SIZE * 0.18,
      positionY: baseY + OBJECT_HEIGHT * 1.1,
      positionZ: centerZ,
      scaleX: TILE_WORLD_SIZE * 0.46,
      scaleY: OBJECT_HEIGHT * 0.72,
      scaleZ: TILE_WORLD_SIZE * 0.06,
      rotationY,
    });
  }

  private addGroundProp(object: SceneObject, batches: ProxyInstanceBatches) {
    const baseY = this.tileHeightWorld(object.x, object.y) + OBJECT_BASE_OFFSET;

    pushInstanceTransform(batches.groundProps, {
      positionX: this.tileCenterX(object.x),
      positionY: baseY + OBJECT_HEIGHT * 0.24,
      positionZ: this.tileCenterZ(object.y),
      scaleX: TILE_WORLD_SIZE * 0.42,
      scaleY: OBJECT_HEIGHT * 0.55,
      scaleZ: TILE_WORLD_SIZE * 0.42,
      rotationY: 0,
    });
  }

  private addLargeProp(object: SceneObject, batches: ProxyInstanceBatches) {
    const baseY = this.tileHeightWorld(object.x, object.y) + OBJECT_BASE_OFFSET;
    const centerX = this.tileCenterX(object.x);
    const centerZ = this.tileCenterZ(object.y);
    const width = Math.max((object.sizeX ?? 1) * TILE_WORLD_SIZE * 0.72, TILE_WORLD_SIZE * 0.72);
    const depth = Math.max((object.sizeY ?? 1) * TILE_WORLD_SIZE * 0.72, TILE_WORLD_SIZE * 0.52);
    const rotationY = MathUtils.degToRad(normalizedRotationDegrees(object));

    pushInstanceTransform(batches.largePropBases, {
      positionX: centerX,
      positionY: baseY + OBJECT_HEIGHT * 0.21,
      positionZ: centerZ,
      scaleX: width,
      scaleY: OBJECT_HEIGHT * 0.42,
      scaleZ: depth,
      rotationY,
    });

    pushInstanceTransform(batches.largePropCanopies, {
      positionX: centerX,
      positionY: baseY + OBJECT_HEIGHT * 0.82,
      positionZ: centerZ,
      scaleX: width + TILE_WORLD_SIZE * 0.08,
      scaleY: OBJECT_HEIGHT * 0.18,
      scaleZ: depth + TILE_WORLD_SIZE * 0.08,
      rotationY,
    });
  }

  private addGenericProp(object: SceneObject, batches: ProxyInstanceBatches) {
    const baseY = this.tileHeightWorld(object.x, object.y) + OBJECT_BASE_OFFSET;
    const width = Math.max((object.sizeX ?? 1) * TILE_WORLD_SIZE * 0.42, TILE_WORLD_SIZE * 0.32);
    const depth = Math.max((object.sizeY ?? 1) * TILE_WORLD_SIZE * 0.42, TILE_WORLD_SIZE * 0.32);
    pushInstanceTransform(batches.genericProps, {
      positionX: this.tileCenterX(object.x),
      positionY: baseY + OBJECT_HEIGHT * 0.4,
      positionZ: this.tileCenterZ(object.y),
      scaleX: width,
      scaleY: OBJECT_HEIGHT * 0.82,
      scaleZ: depth,
      rotationY: MathUtils.degToRad(normalizedRotationDegrees(object)),
    });
  }

  private createProxyInstanceBatches(): ProxyInstanceBatches {
    return {
      wallSegments: createProxyInstanceBatch('wall-segment', this.sharedGeometries.box, this.objectMaterials.wall),
      wallPosts: createProxyInstanceBatch('wall-post', this.sharedGeometries.box, this.objectMaterials.wallPost),
      buildingFoundations: createProxyInstanceBatch('building-foundation', this.sharedGeometries.box, this.objectMaterials.buildingFoundation),
      buildingBodies: createProxyInstanceBatch('building-body', this.sharedGeometries.box, this.objectMaterials.buildingBody),
      buildingRoofs: createProxyInstanceBatch('building-roof', this.sharedGeometries.pyramid, this.objectMaterials.roof),
      treeTrunks: createProxyInstanceBatch('object-tree-trunk', this.sharedGeometries.cylinder, this.objectMaterials.treeTrunk),
      treeCanopies: createProxyInstanceBatch('object-tree-canopy', this.sharedGeometries.cone, this.objectMaterials.treeCanopy),
      bannerPoles: createProxyInstanceBatch('object-banner-pole', this.sharedGeometries.box, this.objectMaterials.wallPost),
      bannerCloths: createProxyInstanceBatch('object-banner-cloth', this.sharedGeometries.box, this.objectMaterials.decor),
      groundProps: createProxyInstanceBatch('object-ground', this.sharedGeometries.sphere, this.objectMaterials.ground),
      largePropBases: createProxyInstanceBatch('object-large-base', this.sharedGeometries.box, this.objectMaterials.prop),
      largePropCanopies: createProxyInstanceBatch('object-large-canopy', this.sharedGeometries.box, this.objectMaterials.propAccent),
      genericProps: createProxyInstanceBatch('object-generic', this.sharedGeometries.crystal, this.objectMaterials.prop),
    };
  }

  private flushProxyInstanceBatches(batches: ProxyInstanceBatches) {
    let batchCount = 0;
    let instanceCount = 0;

    for (const batch of Object.values(batches)) {
      if (batch.transforms.length === 0) {
        continue;
      }

      const mesh = new InstancedMesh(batch.geometry, batch.material, batch.transforms.length);

      mesh.name = batch.name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.disposeGeometry = false;
      mesh.userData.disposeMaterial = false;
      mesh.userData.instanceCount = batch.transforms.length;

      for (const [index, transform] of batch.transforms.entries()) {
        this.applyInstanceTransform(mesh, index, transform);
      }

      mesh.instanceMatrix.needsUpdate = true;
      this.objectGroup.add(mesh);
      batchCount += 1;
      instanceCount += batch.transforms.length;
    }

    return {instancedBatches: batchCount, instancedInstances: instanceCount};
  }

  private applyInstanceTransform(mesh: InstancedMesh, index: number, transform: InstanceTransform) {
    this.instanceTransformDummy.position.set(transform.positionX, transform.positionY, transform.positionZ);
    this.instanceTransformDummy.rotation.set(0, transform.rotationY, 0);
    this.instanceTransformDummy.scale.set(transform.scaleX, transform.scaleY, transform.scaleZ);
    this.instanceTransformDummy.updateMatrix();
    mesh.setMatrixAt(index, this.instanceTransformDummy.matrix);
  }

  private handleBuildFailure(
    pendingRequests: Map<number, BuildRequestState>,
    requestId: number,
    label: string,
    error: unknown,
  ) {
    pendingRequests.delete(requestId);
    console.error(`${label} failed.`, error);
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
  const [x = 0, y = 0] = key.split(':').map(Number);
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
  const [x = 0, y = 0] = key.split(':').map(Number);
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

function toSceneMeshSnapshot(snapshot: SceneSnapshot): SceneMeshSnapshot {
  return {
    baseX: snapshot.baseX,
    baseY: snapshot.baseY,
    tiles: snapshot.tiles,
  };
}

function collectLoadedObjectTextureIds(objects: SceneObject[], terrainTextureAtlas: TerrainTextureAtlas) {
  const loadedTextureIds = new Set<number>();

  for (const object of objects) {
    if (!object.model) {
      continue;
    }

    for (const face of object.model.faces) {
      if (typeof face.texture !== 'number' || !terrainTextureAtlas.hasObjectTexture(face.texture)) {
        continue;
      }

      loadedTextureIds.add(face.texture);
    }
  }

  return [...loadedTextureIds];
}

function isPromiseLike<T>(value: Promise<T> | T): value is Promise<T> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof value.then === 'function';
}

function createBuildPhaseStats(): BuildPhaseStats {
  return {
    mode: 'idle',
    buildMs: 0,
    commitMs: 0,
    totalMs: 0,
    p95Ms: 0,
    completedBuilds: 0,
    staleDrops: 0,
    instancedBatches: 0,
    instancedInstances: 0,
  };
}

function recordBuildPhaseStats(
  stats: BuildPhaseStats,
  samples: number[],
  mode: Exclude<BuildMode, 'idle'>,
  buildMs: number,
  commitMs: number,
  extras?: Partial<Pick<BuildPhaseStats, 'instancedBatches' | 'instancedInstances'>>,
) {
  stats.mode = mode;
  stats.buildMs = buildMs;
  stats.commitMs = commitMs;
  stats.totalMs = buildMs + commitMs;
  stats.completedBuilds += 1;
  samples.push(stats.totalMs);

  if (samples.length > 48) {
    samples.shift();
  }

  stats.p95Ms = calculateP95(samples);
  stats.instancedBatches = extras?.instancedBatches ?? 0;
  stats.instancedInstances = extras?.instancedInstances ?? 0;
}

function createProxyInstanceBatch(
  name: string,
  geometry: BoxGeometry | CylinderGeometry | ConeGeometry | SphereGeometry | OctahedronGeometry,
  material: MeshStandardMaterial,
): ProxyInstanceBatch {
  return {
    name,
    geometry,
    material,
    transforms: [],
  };
}

function pushInstanceTransform(batch: ProxyInstanceBatch, transform: InstanceTransform) {
  batch.transforms.push(transform);
}

function calculateP95(samples: number[]) {
  if (samples.length === 0) {
    return 0;
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);

  return sorted[index] ?? 0;
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
