import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {
	createHelloMessage,
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
});
