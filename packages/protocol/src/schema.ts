import {z} from 'zod';

export const protocolVersion = 1;

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
	plane: z.number().int().nonnegative(),
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
	model: tileSurfaceModelSchema.optional(),
});

export const sceneSnapshotSchema = z.object({
	version: z.literal(protocolVersion),
	timestamp: z.number().int().nonnegative(),
	baseX: z.number().int(),
	baseY: z.number().int(),
	plane: z.number().int().nonnegative(),
	tiles: z.array(tileSchema),
	actors: z.array(actorSchema),
	objects: z.array(sceneObjectSchema),
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
export type SceneSnapshot = z.infer<typeof sceneSnapshotSchema>;
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
