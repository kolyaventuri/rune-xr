import {z} from 'zod';
import {
	actorModelDefinitionSchema,
	clientRoleSchema,
	objectModelDefinitionSchema,
	protocolVersion,
	sceneSnapshotSchema,
	textureDefinitionSchema,
} from './schema.js';

export const helloMessageSchema = z.object({
	kind: z.literal('hello'),
	protocolVersion: z.literal(protocolVersion),
	role: clientRoleSchema,
	source: z.string().min(1).optional(),
});

export const sceneSnapshotMessageSchema = z.object({
	kind: z.literal('scene_snapshot'),
	snapshot: sceneSnapshotSchema,
});

export const textureBatchMessageSchema = z.object({
	kind: z.literal('texture_batch'),
	textures: z.array(textureDefinitionSchema),
});

export const objectModelBatchMessageSchema = z.object({
	kind: z.literal('object_model_batch'),
	models: z.array(objectModelDefinitionSchema),
});

export const actorModelBatchMessageSchema = z.object({
	kind: z.literal('actor_model_batch'),
	models: z.array(actorModelDefinitionSchema),
});

export const pingMessageSchema = z.object({
	kind: z.literal('ping'),
	sentAt: z.number().int().nonnegative(),
});

export const ackMessageSchema = z.object({
	kind: z.literal('ack'),
	ackedKind: z.enum(['hello', 'scene_snapshot', 'texture_batch', 'object_model_batch', 'actor_model_batch', 'ping']),
	serverTime: z.number().int().nonnegative(),
	detail: z.string().min(1).optional(),
});

export const errorMessageSchema = z.object({
	kind: z.literal('error'),
	code: z.string().min(1),
	message: z.string().min(1),
});

export const protocolMessageSchema = z.discriminatedUnion('kind', [
	helloMessageSchema,
	sceneSnapshotMessageSchema,
	textureBatchMessageSchema,
	objectModelBatchMessageSchema,
	actorModelBatchMessageSchema,
	pingMessageSchema,
	ackMessageSchema,
	errorMessageSchema,
]);

export type HelloMessage = z.infer<typeof helloMessageSchema>;
export type SceneSnapshotMessage = z.infer<typeof sceneSnapshotMessageSchema>;
export type TextureBatchMessage = z.infer<typeof textureBatchMessageSchema>;
export type ObjectModelBatchMessage = z.infer<typeof objectModelBatchMessageSchema>;
export type ActorModelBatchMessage = z.infer<typeof actorModelBatchMessageSchema>;
export type PingMessage = z.infer<typeof pingMessageSchema>;
export type AckMessage = z.infer<typeof ackMessageSchema>;
export type ErrorMessage = z.infer<typeof errorMessageSchema>;
export type ProtocolMessage = z.infer<typeof protocolMessageSchema>;

export function parseProtocolMessage(input: unknown): ProtocolMessage {
	return protocolMessageSchema.parse(input);
}

export function safeParseProtocolMessage(input: unknown) {
	return protocolMessageSchema.safeParse(input);
}

export function createHelloMessage(role: HelloMessage['role'], source?: string): HelloMessage {
	return {
		kind: 'hello',
		protocolVersion,
		role,
		source,
	};
}

export function createPingMessage(sentAt = Date.now()): PingMessage {
	return {
		kind: 'ping',
		sentAt,
	};
}

export function createTextureBatchMessage(textures: TextureBatchMessage['textures']): TextureBatchMessage {
	return {
		kind: 'texture_batch',
		textures,
	};
}

export function createObjectModelBatchMessage(models: ObjectModelBatchMessage['models']): ObjectModelBatchMessage {
	return {
		kind: 'object_model_batch',
		models,
	};
}

export function createActorModelBatchMessage(models: ActorModelBatchMessage['models']): ActorModelBatchMessage {
	return {
		kind: 'actor_model_batch',
		models,
	};
}

export function createAckMessage(ackedKind: AckMessage['ackedKind'], detail?: string): AckMessage {
	return {
		kind: 'ack',
		ackedKind,
		serverTime: Date.now(),
		detail,
	};
}

export function createErrorMessage(code: string, message: string): ErrorMessage {
	return {
		kind: 'error',
		code,
		message,
	};
}
