import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {
	createHelloMessage,
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
						model: {
							vertices: [
								{x: 0, y: 10, z: 0},
								{x: 128, y: 10, z: 0},
								{x: 0, y: 10, z: 128},
							],
							faces: [
								{a: 0, b: 1, c: 2, rgb: 0x3366cc},
							],
						},
					},
				},
				...sampleSceneSnapshot.tiles.slice(1),
			],
		});

		expect(parsed.tiles[0]?.surface?.rgb).toBe(0x3366cc);
		expect(parsed.tiles[0]?.surface?.overlayId).toBe(5);
		expect(parsed.tiles[0]?.surface?.model?.faces[0]?.rgb).toBe(0x3366cc);
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
		expect(parsed.objects[1]?.wallOrientationB).toBe(8);
		expect(parsed.objects[1]?.model?.faces[0]?.texture).toBe(7);
		expect(parsed.objects[1]?.model?.faces[0]?.uB).toBe(1);
	});
});
