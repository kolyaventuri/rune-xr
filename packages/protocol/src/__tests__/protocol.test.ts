import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {
	createActorModelBatchMessage,
	createHelloMessage,
	createObjectModelBatchMessage,
	createTextureBatchMessage,
	parseProtocolMessage,
	parseSceneSnapshot,
	sampleSceneSnapshot,
	safeParseSceneSnapshot,
} from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, '../../fixtures/sample-scene.snapshot.json');

describe('protocol fixtures', () => {
	it('parses the canonical sample fixture', async () => {
		const raw = JSON.parse(await readFile(fixturePath, 'utf8')) as unknown;

		expect(parseSceneSnapshot(raw)).toEqual(sampleSceneSnapshot);
	});

	it('round-trips hello envelopes', () => {
		const hello = createHelloMessage('client', 'vitest');
		const payload = structuredClone(hello);

		expect(parseProtocolMessage(payload)).toEqual(hello);
	});

	it('parses texture batch envelopes', () => {
		const textureBatch = createTextureBatchMessage([
			{
				id: 12,
				width: 128,
				height: 128,
				pngBase64: 'Zm9v',
				animationDirection: 1,
				animationSpeed: 2,
			},
		]);

		expect(parseProtocolMessage(structuredClone(textureBatch))).toEqual(textureBatch);
	});

	it('parses object model batch envelopes', () => {
		const objectModelBatch = createObjectModelBatchMessage([
			{
				key: 'model:test',
				model: {
					vertices: [
						{x: 0, y: 0, z: 0},
						{x: 128, y: 0, z: 0},
						{x: 0, y: 128, z: 0},
					],
					faces: [
						{a: 0, b: 1, c: 2, rgb: 0x778899},
					],
				},
			},
		]);

		expect(parseProtocolMessage(structuredClone(objectModelBatch))).toEqual(objectModelBatch);
	});

	it('parses actor model batch envelopes', () => {
		const actorModelBatch = createActorModelBatchMessage([
			{
				key: 'actor-model:test',
				model: {
					vertices: [
						{x: -16, y: 0, z: -16},
						{x: 16, y: 0, z: -16},
						{x: 0, y: 48, z: 16},
					],
					faces: [
						{a: 0, b: 1, c: 2, rgb: 0x778899},
					],
				},
			},
		]);

		expect(parseProtocolMessage(structuredClone(actorModelBatch))).toEqual(actorModelBatch);
	});

	it('rejects malformed scene snapshots', () => {
		const result = safeParseSceneSnapshot({
			...sampleSceneSnapshot,
			tiles: [{x: 1, y: 2, plane: 0}],
		});

		expect(result.success).toBe(false);
	});

	it('accepts optional tile surface metadata', () => {
		const parsed = parseSceneSnapshot({
			...sampleSceneSnapshot,
			tiles: [
				{
					...sampleSceneSnapshot.tiles[0],
					surface: {
						rgb: 0x3366cc,
						texture: 12,
						overlayId: 5,
						underlayId: 42,
						shape: 0,
						renderLevel: 0,
						hasBridge: false,
						bridgeHeight: 24,
						model: {
							vertices: [
								{x: 0, y: 10, z: 0},
								{x: 128, y: 10, z: 0},
								{x: 0, y: 10, z: 128},
							],
							faces: [
								{a: 0, b: 1, c: 2, rgb: 0x3366cc, rgbA: 0x3355aa, rgbB: 0x3366cc, rgbC: 0x4477dd},
							],
						},
					},
				},
				...sampleSceneSnapshot.tiles.slice(1),
			],
		});

		expect(parsed.tiles[0]?.surface?.rgb).toBe(0x3366cc);
		expect(parsed.tiles[0]?.surface?.overlayId).toBe(5);
		expect(parsed.tiles[0]?.surface?.bridgeHeight).toBe(24);
		expect(parsed.tiles[0]?.surface?.model?.faces[0]?.rgb).toBe(0x3366cc);
		expect(parsed.tiles[0]?.surface?.model?.faces[0]?.rgbC).toBe(0x4477dd);
	});

	it('accepts optional scene object footprint and wall metadata', () => {
		const parsed = parseSceneSnapshot({
			...sampleSceneSnapshot,
			objects: [
				{
					...sampleSceneSnapshot.objects[0],
					sizeX: 2,
					sizeY: 3,
					rotationDegrees: 270,
					modelKey: 'model:tree',
				},
				{
					...sampleSceneSnapshot.objects[1],
					wallOrientationA: 1,
					wallOrientationB: 8,
					model: {
						vertices: [
							{x: 0, y: 0, z: 0},
							{x: 128, y: 0, z: 0},
							{x: 0, y: 128, z: 128},
						],
						faces: [
							{
								a: 0,
								b: 1,
								c: 2,
								rgbA: 0xaa0000,
								rgbB: 0x00aa00,
								rgbC: 0x0000aa,
								texture: 7,
								uA: 0,
								vA: 0,
								uB: 1,
								vB: 0,
								uC: 0,
								vC: 1,
							},
						],
					},
				},
				...sampleSceneSnapshot.objects.slice(2),
			],
		});

		expect(parsed.objects[0]?.sizeX).toBe(2);
		expect(parsed.objects[0]?.rotationDegrees).toBe(270);
		expect(parsed.objects[0]?.modelKey).toBe('model:tree');
		expect(parsed.objects[1]?.wallOrientationB).toBe(8);
		expect(parsed.objects[1]?.model?.faces[0]?.texture).toBe(7);
		expect(parsed.objects[1]?.model?.faces[0]?.rgbB).toBe(0x00aa00);
		expect(parsed.objects[1]?.model?.faces[0]?.uB).toBe(1);
	});

	it('accepts optional actor model metadata', () => {
		const parsed = parseSceneSnapshot({
			...sampleSceneSnapshot,
			actors: [
				{
					...sampleSceneSnapshot.actors[0],
					preciseX: sampleSceneSnapshot.actors[0]!.x + 0.75,
					preciseY: sampleSceneSnapshot.actors[0]!.y + 0.25,
					rotationDegrees: 270,
					size: 2,
					modelKey: 'actor-model:self',
					model: {
						vertices: [
							{x: -16, y: 0, z: -8},
							{x: 16, y: 0, z: -8},
							{x: 0, y: 64, z: 12},
						],
						faces: [
							{
								a: 0,
								b: 1,
								c: 2,
								rgbA: 0xaa0000,
								rgbB: 0x00aa00,
								rgbC: 0x0000aa,
							},
						],
					},
				},
				...sampleSceneSnapshot.actors.slice(1),
			],
		});

		expect(parsed.actors[0]?.preciseX).toBe(sampleSceneSnapshot.actors[0]!.x + 0.75);
		expect(parsed.actors[0]?.preciseY).toBe(sampleSceneSnapshot.actors[0]!.y + 0.25);
		expect(parsed.actors[0]?.rotationDegrees).toBe(270);
		expect(parsed.actors[0]?.size).toBe(2);
		expect(parsed.actors[0]?.modelKey).toBe('actor-model:self');
		expect(parsed.actors[0]?.model?.faces[0]?.rgbB).toBe(0x00aa00);
	});
});
