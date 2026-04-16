import process from 'node:process';
import {
  createHelloMessage,
  sampleSceneSnapshot,
  type SceneSnapshot,
  type SceneSnapshotMessage,
} from '@rune-xr/protocol';
import {WebSocket} from 'ws';

const socketUrl = process.env.RUNE_XR_BRIDGE_WS_URL ?? 'ws://127.0.0.1:8787/ws';
const intervalMs = Number(process.env.RUNE_XR_SAMPLE_INTERVAL_MS ?? '1000');
let step = 0;

console.info(`Connecting synthetic sample sender to ${socketUrl}`);

const socket = new WebSocket(socketUrl);

socket.on('open', () => {
  socket.send(JSON.stringify(createHelloMessage('plugin', 'synthetic-sample')));

  pushSnapshot();
  setInterval(pushSnapshot, intervalMs);
});

socket.on('message', raw => {
  console.info(`bridge -> sample sender ${raw.toString()}`);
});

socket.on('close', () => {
  console.info('Sample sender disconnected.');
});

socket.on('error', error => {
  if (isConnectionRefused(error)) {
    console.error([
      `Could not connect to the Rune XR bridge at ${socketUrl}.`,
      'Start `pnpm dev:bridge` in a separate terminal first.',
      'A bridge bound to `0.0.0.0:8787` is still reachable locally via `ws://127.0.0.1:8787/ws`.',
      'If the bridge is running on another host or port, set `RUNE_XR_BRIDGE_WS_URL`.',
    ].join('\n'));
  }

  console.error(error);
  process.exitCode = 1;
});

function pushSnapshot() {
  const snapshot = createSyntheticSnapshot(step);
  const message: SceneSnapshotMessage = {
    kind: 'scene_snapshot',
    snapshot,
  };

  socket.send(JSON.stringify(message));
  step += 1;
}

function createSyntheticSnapshot(tick: number): SceneSnapshot {
  const xOffset = tick % 4;
  const yOffset = tick % 3;
  const base = structuredClone(sampleSceneSnapshot);

  base.timestamp = Date.now();
  base.actors = base.actors.map(actor => {
    if (actor.type === 'self') {
      return {
        ...actor,
        x: actor.x + (xOffset > 1 ? -1 : xOffset),
        y: actor.y + (yOffset > 1 ? -1 : yOffset),
      };
    }

    if (actor.type === 'npc') {
      return {
        ...actor,
        x: actor.x - (xOffset > 1 ? 1 : 0),
        y: actor.y + (tick % 2),
      };
    }

    return {
      ...actor,
      y: actor.y - (tick % 2),
    };
  });

  return base;
}

function isConnectionRefused(error: Error) {
  return 'code' in error && error.code === 'ECONNREFUSED';
}
