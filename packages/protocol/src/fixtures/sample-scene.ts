import type {SceneSnapshot, TileSurfaceModel} from '../schema.js';

const selfActorModel = createHumanoidActorModel({
	skin: 0xd7b691,
	tunic: 0x2c9f62,
	legs: 0x3c4f6b,
});

const playerActorModel = createHumanoidActorModel({
	skin: 0xd3b18b,
	tunic: 0x4478c8,
	legs: 0x6b4b3c,
});

const goblinActorModel = mergeModels(
	createCuboidModel({minX: -12, maxX: 12, minY: 42, maxY: 64, minZ: -10, maxZ: 10}, 0x7ea85a),
	createCuboidModel({minX: -16, maxX: 16, minY: 18, maxY: 42, minZ: -7, maxZ: 11}, 0x8d4d38),
	createCuboidModel({minX: -24, maxX: -14, minY: 14, maxY: 34, minZ: -4, maxZ: 4}, 0x7ea85a),
	createCuboidModel({minX: 14, maxX: 24, minY: 14, maxY: 34, minZ: -4, maxZ: 4}, 0x7ea85a),
	createCuboidModel({minX: -10, maxX: -2, minY: 0, maxY: 18, minZ: -4, maxZ: 4}, 0x65463b),
	createCuboidModel({minX: 2, maxX: 10, minY: 0, maxY: 18, minZ: -4, maxZ: 4}, 0x65463b),
	createCuboidModel({minX: -4, maxX: 4, minY: 48, maxY: 56, minZ: 10, maxZ: 16}, 0x6f934b),
);

function createHumanoidActorModel(colors: {skin: number; tunic: number; legs: number}): TileSurfaceModel {
	return mergeModels(
		createCuboidModel({minX: -10, maxX: 10, minY: 56, maxY: 82, minZ: -10, maxZ: 10}, colors.skin),
		createCuboidModel({minX: -16, maxX: 16, minY: 24, maxY: 56, minZ: -8, maxZ: 8}, colors.tunic),
		createCuboidModel({minX: -24, maxX: -16, minY: 26, maxY: 52, minZ: -5, maxZ: 5}, colors.skin),
		createCuboidModel({minX: 16, maxX: 24, minY: 26, maxY: 52, minZ: -5, maxZ: 5}, colors.skin),
		createCuboidModel({minX: -12, maxX: -4, minY: 0, maxY: 24, minZ: -5, maxZ: 5}, colors.legs),
		createCuboidModel({minX: 4, maxX: 12, minY: 0, maxY: 24, minZ: -5, maxZ: 5}, colors.legs),
	);
}

function createCuboidModel(
	bounds: {minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number},
	color: number,
): TileSurfaceModel {
	const {minX, maxX, minY, maxY, minZ, maxZ} = bounds;

	return {
		vertices: [
			{x: minX, y: minY, z: minZ},
			{x: maxX, y: minY, z: minZ},
			{x: maxX, y: maxY, z: minZ},
			{x: minX, y: maxY, z: minZ},
			{x: minX, y: minY, z: maxZ},
			{x: maxX, y: minY, z: maxZ},
			{x: maxX, y: maxY, z: maxZ},
			{x: minX, y: maxY, z: maxZ},
		],
		faces: [
			{a: 4, b: 5, c: 6, rgb: color},
			{a: 4, b: 6, c: 7, rgb: color},
			{a: 1, b: 0, c: 3, rgb: color},
			{a: 1, b: 3, c: 2, rgb: color},
			{a: 0, b: 4, c: 7, rgb: color},
			{a: 0, b: 7, c: 3, rgb: color},
			{a: 5, b: 1, c: 2, rgb: color},
			{a: 5, b: 2, c: 6, rgb: color},
			{a: 3, b: 7, c: 6, rgb: color},
			{a: 3, b: 6, c: 2, rgb: color},
			{a: 0, b: 1, c: 5, rgb: color},
			{a: 0, b: 5, c: 4, rgb: color},
		],
	};
}

function mergeModels(...models: TileSurfaceModel[]): TileSurfaceModel {
	const vertices: TileSurfaceModel['vertices'] = [];
	const faces: TileSurfaceModel['faces'] = [];

	for (const model of models) {
		const vertexBase = vertices.length;

		vertices.push(...model.vertices);
		faces.push(...model.faces.map(face => ({
			...face,
			a: face.a + vertexBase,
			b: face.b + vertexBase,
			c: face.c + vertexBase,
		})));
	}

	return {vertices, faces};
}

export const sampleSceneSnapshot: SceneSnapshot = {
	version: 1,
	timestamp: 1_710_000_000_000,
	baseX: 3200,
	baseY: 3190,
	plane: 0,
	tiles: [
		{
			x: 3200, y: 3190, plane: 0, height: 10,
		},
		{
			x: 3200, y: 3191, plane: 0, height: 11,
		},
		{
			x: 3200, y: 3192, plane: 0, height: 11,
		},
		{
			x: 3200, y: 3193, plane: 0, height: 10,
		},
		{
			x: 3200, y: 3194, plane: 0, height: 9,
		},
		{
			x: 3200, y: 3195, plane: 0, height: 8,
		},
		{
			x: 3200, y: 3196, plane: 0, height: 8,
		},
		{
			x: 3201, y: 3190, plane: 0, height: 11,
		},
		{
			x: 3201, y: 3191, plane: 0, height: 12,
		},
		{
			x: 3201, y: 3192, plane: 0, height: 13,
		},
		{
			x: 3201, y: 3193, plane: 0, height: 12,
		},
		{
			x: 3201, y: 3194, plane: 0, height: 10,
		},
		{
			x: 3201, y: 3195, plane: 0, height: 9,
		},
		{
			x: 3201, y: 3196, plane: 0, height: 8,
		},
		{
			x: 3202, y: 3190, plane: 0, height: 12,
		},
		{
			x: 3202, y: 3191, plane: 0, height: 14,
		},
		{
			x: 3202, y: 3192, plane: 0, height: 15,
		},
		{
			x: 3202, y: 3193, plane: 0, height: 14,
		},
		{
			x: 3202, y: 3194, plane: 0, height: 12,
		},
		{
			x: 3202, y: 3195, plane: 0, height: 10,
		},
		{
			x: 3202, y: 3196, plane: 0, height: 9,
		},
		{
			x: 3203, y: 3190, plane: 0, height: 12,
		},
		{
			x: 3203, y: 3191, plane: 0, height: 15,
		},
		{
			x: 3203, y: 3192, plane: 0, height: 17,
		},
		{
			x: 3203, y: 3193, plane: 0, height: 15,
		},
		{
			x: 3203, y: 3194, plane: 0, height: 13,
		},
		{
			x: 3203, y: 3195, plane: 0, height: 11,
		},
		{
			x: 3203, y: 3196, plane: 0, height: 10,
		},
		{
			x: 3204, y: 3190, plane: 0, height: 11,
		},
		{
			x: 3204, y: 3191, plane: 0, height: 14,
		},
		{
			x: 3204, y: 3192, plane: 0, height: 15,
		},
		{
			x: 3204, y: 3193, plane: 0, height: 14,
		},
		{
			x: 3204, y: 3194, plane: 0, height: 12,
		},
		{
			x: 3204, y: 3195, plane: 0, height: 10,
		},
		{
			x: 3204, y: 3196, plane: 0, height: 9,
		},
		{
			x: 3205, y: 3190, plane: 0, height: 10,
		},
		{
			x: 3205, y: 3191, plane: 0, height: 12,
		},
		{
			x: 3205, y: 3192, plane: 0, height: 13,
		},
		{
			x: 3205, y: 3193, plane: 0, height: 12,
		},
		{
			x: 3205, y: 3194, plane: 0, height: 11,
		},
		{
			x: 3205, y: 3195, plane: 0, height: 9,
		},
		{
			x: 3205, y: 3196, plane: 0, height: 8,
		},
		{
			x: 3206, y: 3190, plane: 0, height: 9,
		},
		{
			x: 3206, y: 3191, plane: 0, height: 10,
		},
		{
			x: 3206, y: 3192, plane: 0, height: 11,
		},
		{
			x: 3206, y: 3193, plane: 0, height: 11,
		},
		{
			x: 3206, y: 3194, plane: 0, height: 10,
		},
		{
			x: 3206, y: 3195, plane: 0, height: 8,
		},
		{
			x: 3206, y: 3196, plane: 0, height: 7,
		},
	],
	actors: [
		{
			id: 'self_kolya',
			type: 'self',
			name: 'Kolya',
			x: 3203,
			y: 3193,
			plane: 0,
			rotationDegrees: 180,
			size: 1,
			modelKey: 'actor-model:self-kolya',
			model: selfActorModel,
		},
		{
			id: 'npc_goblin_1',
			type: 'npc',
			name: 'Goblin',
			x: 3205,
			y: 3194,
			plane: 0,
			rotationDegrees: 270,
			size: 1,
			modelKey: 'actor-model:npc-goblin',
			model: goblinActorModel,
		},
		{
			id: 'player_friend',
			type: 'player',
			name: 'Friend',
			x: 3202,
			y: 3191,
			plane: 0,
			rotationDegrees: 90,
			size: 1,
			modelKey: 'actor-model:player-friend',
			model: playerActorModel,
		},
	],
	objects: [
		{
			id: 'game_tree_3201_3194_0_0', kind: 'game', name: 'Tree', x: 3201, y: 3194, plane: 0, sizeX: 1, sizeY: 1,
		},
		{
			id: 'wall_house_sw', kind: 'wall', name: 'Stone wall', x: 3203, y: 3192, plane: 0, wallOrientationA: 1, wallOrientationB: 8,
		},
		{
			id: 'wall_house_nw', kind: 'wall', name: 'Stone wall', x: 3203, y: 3193, plane: 0, wallOrientationA: 1, wallOrientationB: 2,
		},
		{
			id: 'wall_house_se', kind: 'wall', name: 'Stone wall', x: 3204, y: 3192, plane: 0, wallOrientationA: 4, wallOrientationB: 8,
		},
		{
			id: 'wall_house_ne', kind: 'wall', name: 'Stone wall', x: 3204, y: 3193, plane: 0, wallOrientationA: 4, wallOrientationB: 2,
		},
		{
			id: 'game_stall_3205_3191_0_0', kind: 'game', name: 'Market stall', x: 3205, y: 3191, plane: 0, sizeX: 2, sizeY: 1, rotationDegrees: 90,
		},
		{
			id: 'banner_1', kind: 'decor', name: 'Banner', x: 3206, y: 3193, plane: 0, rotationDegrees: 180,
		},
	],
};
