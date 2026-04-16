import process from 'node:process';
import {startBridgeServer} from './server.js';

const host = process.env.RUNE_XR_BRIDGE_HOST ?? '0.0.0.0';
const port = Number(process.env.RUNE_XR_BRIDGE_PORT ?? '8787');
const staticRoot = process.env.RUNE_XR_STATIC_ROOT;
const bridgeOptions = {
  host,
  port,
  ...(staticRoot ? {staticRoot} : {}),
};

const bridge = await startBridgeServer(bridgeOptions);

console.info(`Rune XR bridge listening on http://${bridge.address.host}:${bridge.address.port}`);

let shuttingDown = false;

const shutdown = async () => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  await bridge.stop();
  process.exitCode = 0;
};

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});
