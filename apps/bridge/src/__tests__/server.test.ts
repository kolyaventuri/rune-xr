import net from 'node:net';
import {afterEach, describe, expect, it} from 'vitest';
import {
  createActorModelBatchMessage,
  createHelloMessage,
  createObjectModelBatchMessage,
  createTextureBatchMessage,
  sampleSceneSnapshot,
  type ActorModelBatchMessage,
  type ObjectModelBatchMessage,
  type ProtocolMessage,
  type SceneSnapshotMessage,
} from '@rune-xr/protocol';
import {WebSocket} from 'ws';
import {startBridgeServer, type BridgeServerHandle} from '../server.js';

const handles: BridgeServerHandle[] = [];

type WaitableSocket = {
  socket: WebSocket;
  receivedKinds: () => ProtocolMessage['kind'][];
  waitForKind: <K extends ProtocolMessage['kind']>(kind: K) => Promise<Extract<ProtocolMessage, {kind: K}>>;
};

afterEach(async () => {
  while (handles.length > 0) {
    const handle = handles.pop();

    if (handle) {
      await handle.stop();
    }
  }
});

describe('bridge server', () => {
  it('broadcasts snapshots and replays the latest snapshot to new clients', async () => {
    const bridge = await startBridgeServer({host: '127.0.0.1', port: 0});
    handles.push(bridge);

    const plugin = trackSocket(await openSocket(bridge.address.port));
    const client = trackSocket(await openSocket(bridge.address.port));
    const laterClient = trackSocket(await openSocket(bridge.address.port));

    plugin.socket.send(JSON.stringify(createHelloMessage('plugin', 'vitest-plugin')));
    client.socket.send(JSON.stringify(createHelloMessage('client', 'vitest-client')));

    await plugin.waitForKind('ack');
    await client.waitForKind('ack');

    const textureMessage = createTextureBatchMessage([
      {
        id: 12,
        width: 128,
        height: 128,
        pngBase64: 'Zm9v',
        animationDirection: 1,
        animationSpeed: 2,
      },
    ]);
    const actorModelMessage: ActorModelBatchMessage = createActorModelBatchMessage([
      {
        key: 'actor-model:player',
        model: {
          vertices: [
            {x: -16, y: 0, z: -16},
            {x: 16, y: 0, z: -16},
            {x: 0, y: 64, z: 12},
          ],
          faces: [
            {
              a: 0,
              b: 1,
              c: 2,
              rgb: 0x88aaee,
            },
          ],
        },
      },
    ]);
    const objectModelMessage: ObjectModelBatchMessage = createObjectModelBatchMessage([
      {
        key: 'object-model:wall',
        model: {
          vertices: [
            {x: 0, y: 0, z: 0},
            {x: 128, y: 0, z: 0},
            {x: 0, y: 128, z: 0},
          ],
          faces: [
            {
              a: 0,
              b: 1,
              c: 2,
              rgb: 0x888888,
              texture: 12,
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
    ]);

    const sceneMessage: SceneSnapshotMessage = {
      kind: 'scene_snapshot',
      snapshot: {
        ...sampleSceneSnapshot,
        timestamp: Date.now(),
        objects: sampleSceneSnapshot.objects.map(object => object.id === 'wall_house_sw'
          ? {
            ...object,
            modelKey: 'object-model:wall',
          }
          : object),
        actors: sampleSceneSnapshot.actors.map(actor => actor.id === 'self_kolya'
          ? {
            ...actor,
            modelKey: 'actor-model:player',
            model: undefined,
          }
          : actor),
      },
    };

    plugin.socket.send(JSON.stringify(actorModelMessage));
    plugin.socket.send(JSON.stringify(objectModelMessage));
    plugin.socket.send(JSON.stringify(textureMessage));
    plugin.socket.send(JSON.stringify(sceneMessage));

    expect(await client.waitForKind('actor_model_batch')).toEqual(actorModelMessage);
    expect(await client.waitForKind('object_model_batch')).toEqual(objectModelMessage);
    expect(await client.waitForKind('texture_batch')).toEqual(textureMessage);
    const received = await client.waitForKind('scene_snapshot');
    expect(received).toEqual(sceneMessage);

    laterClient.socket.send(JSON.stringify(createHelloMessage('client', 'late-client')));
    await laterClient.waitForKind('ack');
    expect(await laterClient.waitForKind('actor_model_batch')).toEqual(actorModelMessage);
    expect(await laterClient.waitForKind('object_model_batch')).toEqual(objectModelMessage);
    expect(await laterClient.waitForKind('texture_batch')).toEqual(textureMessage);
    expect(await laterClient.waitForKind('scene_snapshot')).toEqual(sceneMessage);
    expect(laterClient.receivedKinds().indexOf('actor_model_batch')).toBeLessThan(
      laterClient.receivedKinds().indexOf('scene_snapshot'),
    );
    expect(laterClient.receivedKinds().indexOf('object_model_batch')).toBeLessThan(
      laterClient.receivedKinds().indexOf('scene_snapshot'),
    );
    expect(laterClient.receivedKinds().indexOf('texture_batch')).toBeLessThan(
      laterClient.receivedKinds().indexOf('scene_snapshot'),
    );

    plugin.socket.close();
    client.socket.close();
    laterClient.socket.close();
  });

  it('rejects snapshots from non-plugin clients', async () => {
    const bridge = await startBridgeServer({host: '127.0.0.1', port: 0});
    handles.push(bridge);
    const client = trackSocket(await openSocket(bridge.address.port));

    client.socket.send(JSON.stringify(createHelloMessage('client', 'vitest-client')));
    await client.waitForKind('ack');

    client.socket.send(JSON.stringify({
      kind: 'scene_snapshot',
      snapshot: sampleSceneSnapshot,
    } satisfies SceneSnapshotMessage));

    const error = await client.waitForKind('error');

    expect(error.kind).toBe('error');
    expect(error.code).toBe('forbidden');
    client.socket.close();
  });

  it('reports bridge health over http', async () => {
    const bridge = await startBridgeServer({host: '127.0.0.1', port: 0});
    handles.push(bridge);

    const response = await fetch(`http://127.0.0.1:${bridge.address.port}/healthz`);
    const body = await response.json() as {status: string};

    expect(response.ok).toBe(true);
    expect(body.status).toBe('ok');
  });

  it('contains malformed websocket frames without crashing the bridge', async () => {
    const bridge = await startBridgeServer({host: '127.0.0.1', port: 0});
    handles.push(bridge);

    await sendMalformedFrame(bridge.address.port);

    const client = trackSocket(await openSocket(bridge.address.port));
    client.socket.send(JSON.stringify(createHelloMessage('client', 'after-malformed-frame')));

    await expect(client.waitForKind('ack')).resolves.toMatchObject({
      kind: 'ack',
      ackedKind: 'hello',
    });

    client.socket.close();
  });
});

async function openSocket(port: number) {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    socket.once('open', () => {
 resolve(socket);
});
    socket.once('error', reject);
  });
}

async function sendMalformedFrame(port: number) {
  return new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({host: '127.0.0.1', port});
    let handshake = '';
    let frameSent = false;
    let settled = false;
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Timed out sending malformed websocket frame'));
    }, 3_000);

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    socket.on('connect', () => {
      socket.write([
        'GET /ws HTTP/1.1',
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'));
    });

    socket.on('data', chunk => {
      handshake += chunk.toString('latin1');

      if (frameSent || !handshake.includes('\r\n\r\n')) {
        return;
      }

      frameSent = true;
      socket.write(Buffer.from([0xb1, 0x80, 0x00, 0x00, 0x00, 0x00]));
    });

    socket.on('close', () => {
      if (!frameSent) {
        finish(new Error('Connection closed before malformed frame was sent'));
        return;
      }

      finish();
    });

    socket.on('error', error => {
      if (frameSent) {
        finish();
        return;
      }

      finish(error);
    });
  });
}

function trackSocket(socket: WebSocket) {
  const messages: ProtocolMessage[] = [];

  socket.on('message', (raw: Buffer) => {
    messages.push(JSON.parse(raw.toString()) as ProtocolMessage);
  });

  return {
    socket,
    receivedKinds() {
      return messages.map(message => message.kind);
    },
    async waitForKind<K extends ProtocolMessage['kind']>(kind: K) {
      const existing = messages.find(message => message.kind === kind);

      if (existing) {
        return existing as Extract<ProtocolMessage, {kind: K}>;
      }

      return new Promise<Extract<ProtocolMessage, {kind: K}>>((resolve, reject) => {
        const listener = (raw: Buffer) => {
          const message = JSON.parse(raw.toString()) as ProtocolMessage;

          if (message.kind !== kind) {
            return;
          }

          clearTimeout(timeout);
          socket.off('message', listener);
          resolve(message as Extract<ProtocolMessage, {kind: K}>);
        };

        const timeout = setTimeout(() => {
          socket.off('message', listener);
          reject(new Error(`Timed out waiting for ${kind}`));
        }, 3_000);

        socket.on('message', listener);
      });
    },
  } satisfies WaitableSocket;
}
