import {z} from 'zod';
import {clientRoleSchema, protocolVersion, sceneSnapshotSchema} from './schema.js';

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

export const pingMessageSchema = z.object({
	kind: z.literal('ping'),
	sentAt: z.number().int().nonnegative(),
});

export const ackMessageSchema = z.object({
	kind: z.literal('ack'),
	ackedKind: z.enum(['hello', 'scene_snapshot', 'ping']),
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
	pingMessageSchema,
	ackMessageSchema,
	errorMessageSchema,
]);

export type HelloMessage = z.infer<typeof helloMessageSchema>;
export type SceneSnapshotMessage = z.infer<typeof sceneSnapshotMessageSchema>;
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
