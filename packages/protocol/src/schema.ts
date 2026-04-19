import {z} from 'zod';

export const protocolVersion = 2;

const legacySnapshotVersions = [1, protocolVersion] as const;
const sceneSnapshotVersionSchema = z.union(legacySnapshotVersions.map(version => z.literal(version)) as [
	z.ZodLiteral<(typeof legacySnapshotVersions)[number]>,
	z.ZodLiteral<(typeof legacySnapshotVersions)[number]>,
]);

export const actorTypeSchema = z.enum(['self', 'player', 'npc']);
export const objectKindSchema = z.enum(['game', 'wall', 'decor', 'ground']);
export const clientRoleSchema = z.enum(['plugin', 'client']);

export const tileSurfaceVertexSchema = z.object({
	x: z.number().int(),
	y: z.number().int(),
	z: z.number().int(),
});

export const tileSurfaceFaceSchema = z.object({
	a: z.number().int().nonnegative(),
	b: z.number().int().nonnegative(),
	c: z.number().int().nonnegative(),
	rgb: z.number().int().nonnegative().max(0xffffff).optional(),
	rgbA: z.number().int().nonnegative().max(0xffffff).optional(),
	rgbB: z.number().int().nonnegative().max(0xffffff).optional(),
	rgbC: z.number().int().nonnegative().max(0xffffff).optional(),
	texture: z.number().int().nonnegative().optional(),
	uA: z.number().optional(),
	vA: z.number().optional(),
	uB: z.number().optional(),
	vB: z.number().optional(),
	uC: z.number().optional(),
	vC: z.number().optional(),
});

export const tileSurfaceModelSchema = z.object({
	vertices: z.array(tileSurfaceVertexSchema),
	faces: z.array(tileSurfaceFaceSchema),
});

export const tileSurfaceSchema = z.object({
	rgb: z.number().int().nonnegative().max(0xffffff).optional(),
	texture: z.number().int().nonnegative().optional(),
	overlayId: z.number().int().nonnegative().optional(),
	underlayId: z.number().int().nonnegative().optional(),
	shape: z.number().int().nonnegative().optional(),
	renderLevel: z.number().int().nonnegative().optional(),
	hasBridge: z.boolean().optional(),
	bridgeHeight: z.number().int().optional(),
	model: tileSurfaceModelSchema.optional(),
});

export const tileSchema = z.object({
	x: z.number().int(),
	y: z.number().int(),
	plane: z.number().int().nonnegative(),
	height: z.number().int(),
	surface: tileSurfaceSchema.optional(),
});

export const actorSchema = z.object({
	id: z.string().min(1),
	type: actorTypeSchema,
	name: z.string().min(1).optional(),
	x: z.number().int(),
	y: z.number().int(),
	preciseX: z.number().optional(),
	preciseY: z.number().optional(),
	plane: z.number().int().nonnegative(),
	rotationDegrees: z.number().int().min(0).max(359).optional(),
	size: z.number().int().positive().optional(),
	modelKey: z.string().min(1).optional(),
	model: tileSurfaceModelSchema.optional(),
});

export const sceneObjectSchema = z.object({
	id: z.string().min(1),
	kind: objectKindSchema,
	name: z.string().min(1).optional(),
	x: z.number().int(),
	y: z.number().int(),
	plane: z.number().int().nonnegative(),
	sizeX: z.number().int().positive().optional(),
	sizeY: z.number().int().positive().optional(),
	rotationDegrees: z.number().int().min(0).max(359).optional(),
	wallOrientationA: z.number().int().nonnegative().optional(),
	wallOrientationB: z.number().int().nonnegative().optional(),
	modelKey: z.string().min(1).optional(),
	model: tileSurfaceModelSchema.optional(),
});

export const objectModelDefinitionSchema = z.object({
	key: z.string().min(1),
	model: tileSurfaceModelSchema,
});

export const actorModelDefinitionSchema = z.object({
	key: z.string().min(1),
	model: tileSurfaceModelSchema,
});

export const sceneSnapshotSchema = z.object({
	version: sceneSnapshotVersionSchema,
	timestamp: z.number().int().nonnegative(),
	baseX: z.number().int(),
	baseY: z.number().int(),
	plane: z.number().int().nonnegative(),
	tiles: z.array(tileSchema),
	actors: z.array(actorSchema),
	objects: z.array(sceneObjectSchema),
});

export const windowKeySchema = z.string().min(1);

export const terrainSnapshotSchema = z.object({
	version: z.literal(protocolVersion),
	timestamp: z.number().int().nonnegative(),
	windowKey: windowKeySchema,
	baseX: z.number().int(),
	baseY: z.number().int(),
	plane: z.number().int().nonnegative(),
	tiles: z.array(tileSchema),
});

export const objectsSnapshotSchema = z.object({
	version: z.literal(protocolVersion),
	timestamp: z.number().int().nonnegative(),
	windowKey: windowKeySchema,
	objects: z.array(sceneObjectSchema),
});

export const actorsFrameSchema = z.object({
	version: z.literal(protocolVersion),
	timestamp: z.number().int().nonnegative(),
	windowKey: windowKeySchema,
	actors: z.array(actorSchema),
});

export const textureDefinitionSchema = z.object({
	id: z.number().int().nonnegative(),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	pngBase64: z.string().min(1),
	animationDirection: z.number().int().nonnegative().optional(),
	animationSpeed: z.number().int().nonnegative().optional(),
});

export type Tile = z.infer<typeof tileSchema>;
export type TileSurfaceModel = z.infer<typeof tileSurfaceModelSchema>;
export type TileSurface = z.infer<typeof tileSurfaceSchema>;
export type Actor = z.infer<typeof actorSchema>;
export type SceneObject = z.infer<typeof sceneObjectSchema>;
export type ObjectModelDefinition = z.infer<typeof objectModelDefinitionSchema>;
export type ActorModelDefinition = z.infer<typeof actorModelDefinitionSchema>;
export type SceneSnapshot = z.infer<typeof sceneSnapshotSchema>;
export type TerrainSnapshot = z.infer<typeof terrainSnapshotSchema>;
export type ObjectsSnapshot = z.infer<typeof objectsSnapshotSchema>;
export type ActorsFrame = z.infer<typeof actorsFrameSchema>;
export type TextureDefinition = z.infer<typeof textureDefinitionSchema>;
export type ActorType = z.infer<typeof actorTypeSchema>;
export type ObjectKind = z.infer<typeof objectKindSchema>;
export type ClientRole = z.infer<typeof clientRoleSchema>;

export function parseSceneSnapshot(input: unknown): SceneSnapshot {
	return sceneSnapshotSchema.parse(input);
}

export function safeParseSceneSnapshot(input: unknown) {
	return sceneSnapshotSchema.safeParse(input);
}

export function createWindowKey(plane: number, baseX: number, baseY: number) {
	return `${plane}:${baseX}:${baseY}`;
}
