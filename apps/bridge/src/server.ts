import fs from 'node:fs';
import path from 'node:path';
import {createServer, type Server as HttpServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import express from 'express';
import {
  createAckMessage,
  createErrorMessage,
  parseProtocolMessage,
  type AckMessage,
  type HelloMessage,
  type ProtocolMessage,
  type SceneSnapshot,
  type SceneSnapshotMessage,
} from '@rune-xr/protocol';
import {WebSocketServer, type RawData, type WebSocket} from 'ws';

type Logger = Pick<Console, 'error' | 'info' | 'warn'>;

type ConnectionRole = 'plugin' | 'client' | 'unknown';

type ConnectionState = {
  role: ConnectionRole;
};

export type BridgeServerOptions = {
  host?: string;
  port?: number;
  staticRoot?: string;
  logger?: Logger;
};

export type BridgeServerHandle = {
  address: {
    host: string;
    port: number;
  };
  getState: () => {
    clientCount: number;
    hasPlugin: boolean;
    latestTimestamp?: number;
  };
  stop: () => Promise<void>;
};

const socketState = new WeakMap<WebSocket, ConnectionState>();

function sendMessage(socket: WebSocket, message: ProtocolMessage | AckMessage) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function sendError(socket: WebSocket, code: string, message: string) {
  sendMessage(socket, createErrorMessage(code, message));
}

function defaultStaticRoot() {
  const sourceDir = path.dirname(fileURLToPath(import.meta.url));
  const bridgeRoot = path.resolve(sourceDir, '..');
  const repositoryRoot = path.resolve(bridgeRoot, '..', '..');

  return path.join(repositoryRoot, 'apps', 'webxr-client', 'dist');
}

function resolveStaticRoot(staticRoot?: string) {
  return staticRoot ?? defaultStaticRoot();
}

function parsePayload(data: RawData): ProtocolMessage {
  const payload = JSON.parse(typeof data === 'string' ? data : data.toString());

  return parseProtocolMessage(payload);
}

function isHelloMessage(message: ProtocolMessage): message is HelloMessage {
  return message.kind === 'hello';
}

export async function startBridgeServer(options: BridgeServerOptions = {}): Promise<BridgeServerHandle> {
  const host = options.host ?? '0.0.0.0';
  const port = options.port ?? 8787;
  const logger = options.logger ?? console;
  const staticRoot = resolveStaticRoot(options.staticRoot);
  const app = express();
  const server = createServer(app);
  const webSocketServer = new WebSocketServer({server, path: '/ws'});
  const clients = new Set<WebSocket>();
  let pluginSocket: WebSocket | undefined;
  let latestSnapshot: SceneSnapshot | undefined;

  app.get('/healthz', (_request, response) => {
    response.json({
      status: 'ok',
      clientCount: clients.size,
      hasPlugin: Boolean(pluginSocket && pluginSocket.readyState === pluginSocket.OPEN),
      latestTimestamp: latestSnapshot?.timestamp,
    });
  });

  if (fs.existsSync(staticRoot)) {
    app.use(express.static(staticRoot));
    app.get('*', (_request, response) => {
      response.sendFile(path.join(staticRoot, 'index.html'));
    });
  } else {
    app.get('/', (_request, response) => {
      response.type('html').send(`
        <main style="font-family: sans-serif; padding: 24px">
          <h1>Rune XR Bridge</h1>
          <p>No built web client was found at <code>${staticRoot}</code>.</p>
          <p>Run <code>pnpm --filter @rune-xr/webxr-client build</code> or use the Vite dev server.</p>
        </main>
      `);
    });
  }

  const broadcastSnapshot = (snapshot: SceneSnapshot) => {
    const message: SceneSnapshotMessage = {
      kind: 'scene_snapshot',
      snapshot,
    };

    for (const client of clients) {
      sendMessage(client, message);
    }
  };

  const handleHello = (socket: WebSocket, message: HelloMessage) => {
    const state = socketState.get(socket);

    if (!state) {
      return;
    }

    if (message.role === 'plugin') {
      if (pluginSocket && pluginSocket !== socket && pluginSocket.readyState === pluginSocket.OPEN) {
        sendError(socket, 'plugin_already_connected', 'A plugin connection is already active.');
        socket.close(1013, 'Plugin already connected');
        return;
      }

      state.role = 'plugin';
      pluginSocket = socket;
      sendMessage(socket, createAckMessage('hello', 'plugin_connected'));
      logger.info('Plugin connected to bridge');
      return;
    }

    state.role = 'client';
    clients.add(socket);
    sendMessage(socket, createAckMessage('hello', 'client_connected'));
    if (latestSnapshot) {
      broadcastToSocket(socket, latestSnapshot);
    }
  };

  const broadcastToSocket = (socket: WebSocket, snapshot: SceneSnapshot) => {
    sendMessage(socket, {
      kind: 'scene_snapshot',
      snapshot,
    });
  };

  webSocketServer.on('connection', socket => {
    socketState.set(socket, {role: 'unknown'});

    socket.on('message', raw => {
      let message: ProtocolMessage;

      try {
        message = parsePayload(raw);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Invalid JSON message';
        sendError(socket, 'invalid_message', detail);
        return;
      }

      const state = socketState.get(socket);

      if (!state) {
        sendError(socket, 'unknown_connection', 'Connection state was not initialized.');
        return;
      }

      if (isHelloMessage(message)) {
        handleHello(socket, message);
        return;
      }

      if (message.kind === 'ping') {
        sendMessage(socket, createAckMessage('ping'));
        return;
      }

      if (message.kind === 'ack' || message.kind === 'error') {
        return;
      }

      if (state.role !== 'plugin') {
        sendError(socket, 'forbidden', 'Only the plugin connection may publish scene snapshots.');
        return;
      }

      const sceneMessage: SceneSnapshotMessage = message;

      latestSnapshot = sceneMessage.snapshot;
      broadcastSnapshot(sceneMessage.snapshot);
    });

    socket.on('close', () => {
      const state = socketState.get(socket);

      if (!state) {
        return;
      }

      if (state.role === 'plugin' && pluginSocket === socket) {
        pluginSocket = undefined;
      }

      if (state.role === 'client') {
        clients.delete(socket);
      }
    });
  });

  await listen(server, port, host);

  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;

  return {
    address: {
      host,
      port: boundPort,
    },
    getState() {
      return {
        clientCount: clients.size,
        hasPlugin: Boolean(pluginSocket && pluginSocket.readyState === pluginSocket.OPEN),
        ...(latestSnapshot ? {latestTimestamp: latestSnapshot.timestamp} : {}),
      };
    },
    async stop() {
      for (const socket of clients) {
        socket.close();
      }

      pluginSocket?.close();
      webSocketServer.close();
      await closeServer(server);
    },
  };
}

async function listen(server: HttpServer, port: number, host: string) {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      reject(error);
    };

    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

async function closeServer(server: HttpServer) {
  return new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
