import {afterEach, describe, expect, it} from 'vitest';
import {
  createHelloMessage,
  sampleSceneSnapshot,
  type ProtocolMessage,
  type SceneSnapshotMessage,
} from '@rune-xr/protocol';
import {WebSocket} from 'ws';
import {startBridgeServer, type BridgeServerHandle} from '../server.js';

const handles: BridgeServerHandle[] = [];

type WaitableSocket = {
  socket: WebSocket;
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
    const bridge = await startBridgeServer({port: 0});
    handles.push(bridge);

    const plugin = trackSocket(await openSocket(bridge.address.port));
    const client = trackSocket(await openSocket(bridge.address.port));
    const laterClient = trackSocket(await openSocket(bridge.address.port));

    plugin.socket.send(JSON.stringify(createHelloMessage('plugin', 'vitest-plugin')));
    client.socket.send(JSON.stringify(createHelloMessage('client', 'vitest-client')));

    await plugin.waitForKind('ack');
    await client.waitForKind('ack');

    const sceneMessage: SceneSnapshotMessage = {
      kind: 'scene_snapshot',
      snapshot: {
        ...sampleSceneSnapshot,
        timestamp: Date.now(),
      },
    };

    plugin.socket.send(JSON.stringify(sceneMessage));

    const received = await client.waitForKind('scene_snapshot');
    expect(received).toEqual(sceneMessage);

    laterClient.socket.send(JSON.stringify(createHelloMessage('client', 'late-client')));
    await laterClient.waitForKind('ack');
    expect(await laterClient.waitForKind('scene_snapshot')).toEqual(sceneMessage);

    plugin.socket.close();
    client.socket.close();
    laterClient.socket.close();
  });

  it('rejects snapshots from non-plugin clients', async () => {
    const bridge = await startBridgeServer({port: 0});
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
    const bridge = await startBridgeServer({port: 0});
    handles.push(bridge);

    const response = await fetch(`http://127.0.0.1:${bridge.address.port}/healthz`);
    const body = await response.json() as {status: string};

    expect(response.ok).toBe(true);
    expect(body.status).toBe('ok');
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

function trackSocket(socket: WebSocket) {
  const messages: ProtocolMessage[] = [];

  socket.on('message', (raw: Buffer) => {
    messages.push(JSON.parse(raw.toString()) as ProtocolMessage);
  });

  return {
    socket,
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
