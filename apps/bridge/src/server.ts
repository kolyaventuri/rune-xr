import fs from 'node:fs';
import path from 'node:path';
import {createServer, type Server as HttpServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import express from 'express';
import {
  createActorsFrameMessage,
  createAckMessage,
  createActorModelBatchMessage,
  createErrorMessage,
  createObjectModelBatchMessage,
  createObjectsSnapshotMessage,
  createTerrainSnapshotMessage,
  createTextureBatchMessage,
  createWindowKey,
  parseProtocolMessage,
  protocolVersion,
  type AckMessage,
  type ActorsFrame,
  type ActorsFrameMessage,
  type ActorModelBatchMessage,
  type ActorModelDefinition,
  type HelloMessage,
  type ObjectModelBatchMessage,
  type ObjectModelDefinition,
  type ObjectsSnapshot,
  type ObjectsSnapshotMessage,
  type ProtocolMessage,
  type SceneSnapshotMessage,
  type TerrainSnapshot,
  type TerrainSnapshotMessage,
  type TextureBatchMessage,
  type TextureDefinition,
} from '@rune-xr/protocol';
import {WebSocketServer, type RawData, type WebSocket} from 'ws';

type Logger = Pick<Console, 'error' | 'info' | 'warn'>;

type ConnectionRole = 'plugin' | 'client' | 'unknown';

type ConnectionState = {
  role: ConnectionRole;
  source?: string;
  protocolVersion?: number;
  messageCount: number;
  lastMessageKind?: ProtocolMessage['kind'];
  lastMessageBytes?: number;
  loggedFirstPayload: boolean;
};

const MAX_OBJECT_MODEL_BATCH_CHARS = 500_000;

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

function describeSocket(socket: WebSocket) {
  const state = socketState.get(socket);
  const role = state?.role ?? 'unknown';
  const transport = socket as WebSocket & {
    _socket?: {
      remoteAddress?: string;
      remotePort?: number;
    };
  };
  const remoteAddress = transport._socket?.remoteAddress ?? 'unknown';
  const remotePort = transport._socket?.remotePort ?? 'unknown';

  return `${role} ${remoteAddress}:${remotePort}`;
}

function describeSocketState(socket: WebSocket) {
  const state = socketState.get(socket);

  if (!state) {
    return 'messages=0, lastKind=none, lastBytes=0';
  }

  return [
    `messages=${state.messageCount}`,
    `lastKind=${state.lastMessageKind ?? 'none'}`,
    `lastBytes=${state.lastMessageBytes ?? 0}`,
    `source=${state.source ?? 'unknown'}`,
    `protocolVersion=${state.protocolVersion ?? 'unknown'}`,
  ].join(', ');
}

function rawDataSize(data: RawData) {
  if (typeof data === 'string') {
    return Buffer.byteLength(data);
  }

  if (Array.isArray(data)) {
    return data.reduce((total, chunk) => total + chunk.length, 0);
  }

  return data instanceof ArrayBuffer ? data.byteLength : data.length;
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
  const actorModels = new Map<string, ActorModelDefinition>();
  const objectModels = new Map<string, ObjectModelDefinition>();
  const textureDefinitions = new Map<number, TextureDefinition>();
  let pluginSocket: WebSocket | undefined;
  let latestTerrainSnapshot: TerrainSnapshot | undefined;
  let latestObjectsSnapshot: ObjectsSnapshot | undefined;
  let latestActorsFrame: ActorsFrame | undefined;

  app.get('/healthz', (_request, response) => {
    response.json({
      status: 'ok',
      clientCount: clients.size,
      hasPlugin: Boolean(pluginSocket && pluginSocket.readyState === pluginSocket.OPEN),
      latestTimestamp: currentLatestTimestamp(latestTerrainSnapshot, latestObjectsSnapshot, latestActorsFrame),
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

  const broadcastTerrainSnapshot = (snapshot: TerrainSnapshot) => {
    const message = createTerrainSnapshotMessage(snapshot);

    if (!latestTerrainSnapshot || latestTerrainSnapshot.windowKey !== snapshot.windowKey) {
      latestObjectsSnapshot = undefined;
      latestActorsFrame = undefined;
    }

    latestTerrainSnapshot = snapshot;

    for (const client of clients) {
      sendMessage(client, message);
    }
  };

  const broadcastObjectsSnapshot = (snapshot: ObjectsSnapshot) => {
    const message = createObjectsSnapshotMessage(snapshot);

    if (!latestTerrainSnapshot || latestTerrainSnapshot.windowKey !== snapshot.windowKey) {
      logger.warn(`Ignoring cached objects snapshot for unmatched windowKey=${snapshot.windowKey}`);
    } else {
      latestObjectsSnapshot = snapshot;
    }

    for (const client of clients) {
      sendMessage(client, message);
    }
  };

  const broadcastActorsFrame = (frame: ActorsFrame) => {
    const message = createActorsFrameMessage(frame);

    if (!latestTerrainSnapshot || latestTerrainSnapshot.windowKey !== frame.windowKey) {
      logger.warn(`Ignoring cached actors frame for unmatched windowKey=${frame.windowKey}`);
    } else {
      latestActorsFrame = frame;
    }

    for (const client of clients) {
      sendMessage(client, message);
    }
  };

  const sendTextureReplay = (socket: WebSocket) => {
    if (textureDefinitions.size === 0) {
      return;
    }

    sendMessage(socket, createTextureBatchMessage([...textureDefinitions.values()]));
  };

  const sendActorModelReplay = (socket: WebSocket) => {
    if (actorModels.size === 0) {
      return;
    }

    for (const batch of partitionActorModels([...actorModels.values()])) {
      sendMessage(socket, createActorModelBatchMessage(batch));
    }
  };

  const sendObjectModelReplay = (socket: WebSocket) => {
    if (objectModels.size === 0) {
      return;
    }

    for (const batch of partitionObjectModels([...objectModels.values()])) {
      sendMessage(socket, createObjectModelBatchMessage(batch));
    }
  };

  const sendTerrainReplay = (socket: WebSocket) => {
    if (!latestTerrainSnapshot) {
      return;
    }

    sendMessage(socket, createTerrainSnapshotMessage(latestTerrainSnapshot));
  };

  const sendObjectsReplay = (socket: WebSocket) => {
    if (!latestTerrainSnapshot || !latestObjectsSnapshot || latestObjectsSnapshot.windowKey !== latestTerrainSnapshot.windowKey) {
      return;
    }

    sendMessage(socket, createObjectsSnapshotMessage(latestObjectsSnapshot));
  };

  const sendActorsReplay = (socket: WebSocket) => {
    if (!latestTerrainSnapshot || !latestActorsFrame || latestActorsFrame.windowKey !== latestTerrainSnapshot.windowKey) {
      return;
    }

    sendMessage(socket, createActorsFrameMessage(latestActorsFrame));
  };

  const broadcastTextureBatch = (textures: TextureDefinition[]) => {
    if (textures.length === 0) {
      return;
    }

    const message = createTextureBatchMessage(textures);

    for (const texture of textures) {
      textureDefinitions.set(texture.id, texture);
    }

    for (const client of clients) {
      sendMessage(client, message);
    }
  };

  const broadcastObjectModelBatch = (models: ObjectModelDefinition[]) => {
    if (models.length === 0) {
      return;
    }

    const message = createObjectModelBatchMessage(models);

    for (const model of models) {
      objectModels.set(model.key, model);
    }

    for (const client of clients) {
      sendMessage(client, message);
    }
  };

  const broadcastActorModelBatch = (models: ActorModelDefinition[]) => {
    if (models.length === 0) {
      return;
    }

    const message = createActorModelBatchMessage(models);

    for (const model of models) {
      actorModels.set(model.key, model);
    }

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
      if (message.source === undefined) {
        delete state.source;
      } else {
        state.source = message.source;
      }
      state.protocolVersion = message.protocolVersion;
      pluginSocket = socket;
      sendMessage(socket, createAckMessage('hello', 'plugin_connected'));
      logger.info(`Plugin connected to bridge (${describeSocket(socket)}, source=${message.source ?? 'unknown'}, protocolVersion=${message.protocolVersion})`);
      return;
    }

    state.role = 'client';
    if (message.source === undefined) {
      delete state.source;
    } else {
      state.source = message.source;
    }
    state.protocolVersion = message.protocolVersion;
    clients.add(socket);
    sendMessage(socket, createAckMessage('hello', 'client_connected'));
    logger.info(`Client connected to bridge (${describeSocket(socket)}, source=${message.source ?? 'unknown'}, protocolVersion=${message.protocolVersion})`);
    sendActorModelReplay(socket);
    sendObjectModelReplay(socket);
    sendTextureReplay(socket);
    sendTerrainReplay(socket);
    sendObjectsReplay(socket);
    sendActorsReplay(socket);
  };

  const cleanupSocket = (socket: WebSocket) => {
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
  };

  webSocketServer.on('connection', socket => {
    socketState.set(socket, {
      role: 'unknown',
      messageCount: 0,
      loggedFirstPayload: false,
    });
    logger.info(`WebSocket connected (${describeSocket(socket)})`);

    socket.on('error', error => {
      logger.warn(`WebSocket connection error (${describeSocket(socket)}): ${error.message}; ${describeSocketState(socket)}`);
      cleanupSocket(socket);

      if (socket.readyState === socket.OPEN) {
        socket.close(1002, 'Protocol error');
        return;
      }

      if (socket.readyState !== socket.CLOSED) {
        socket.terminate();
      }
    });

    socket.on('message', raw => {
      let message: ProtocolMessage;
      const payloadBytes = rawDataSize(raw);

      try {
        message = parsePayload(raw);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Invalid JSON message';
        logger.warn(`Invalid message received (${describeSocket(socket)}, bytes=${payloadBytes}): ${detail}`);
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

      state.messageCount += 1;
      state.lastMessageKind = message.kind;
      state.lastMessageBytes = payloadBytes;

      if (!state.loggedFirstPayload) {
        logger.info(`First payload received (${describeSocket(socket)}): kind=${message.kind}, bytes=${payloadBytes}`);
        state.loggedFirstPayload = true;
      }

      if (message.kind === 'ping') {
        sendMessage(socket, createAckMessage('ping'));
        return;
      }

      if (message.kind === 'ack' || message.kind === 'error') {
        return;
      }

      if (state.role !== 'plugin') {
        sendError(socket, 'forbidden', 'Only the plugin connection may publish scene data.');
        return;
      }

      if (message.kind === 'texture_batch') {
        const textureMessage: TextureBatchMessage = message;

        broadcastTextureBatch(textureMessage.textures);
        return;
      }

      if (message.kind === 'object_model_batch') {
        const objectModelMessage: ObjectModelBatchMessage = message;

        broadcastObjectModelBatch(objectModelMessage.models);
        return;
      }

      if (message.kind === 'actor_model_batch') {
        const actorModelMessage: ActorModelBatchMessage = message;

        broadcastActorModelBatch(actorModelMessage.models);
        return;
      }

      if (message.kind === 'terrain_snapshot') {
        const terrainMessage: TerrainSnapshotMessage = message;

        broadcastTerrainSnapshot(terrainMessage);
        return;
      }

      if (message.kind === 'objects_snapshot') {
        const objectsMessage: ObjectsSnapshotMessage = message;

        broadcastObjectsSnapshot(objectsMessage);
        return;
      }

      if (message.kind === 'actors_frame') {
        const actorsMessage: ActorsFrameMessage = message;

        broadcastActorsFrame(actorsMessage);
        return;
      }

      const sceneMessage: SceneSnapshotMessage = message;
      const windowKey = createWindowKey(
        sceneMessage.snapshot.plane,
        sceneMessage.snapshot.baseX,
        sceneMessage.snapshot.baseY,
      );

      broadcastTerrainSnapshot({
        version: protocolVersion,
        timestamp: sceneMessage.snapshot.timestamp,
        windowKey,
        baseX: sceneMessage.snapshot.baseX,
        baseY: sceneMessage.snapshot.baseY,
        plane: sceneMessage.snapshot.plane,
        tiles: sceneMessage.snapshot.tiles,
      });
      broadcastObjectsSnapshot({
        version: protocolVersion,
        timestamp: sceneMessage.snapshot.timestamp,
        windowKey,
        objects: sceneMessage.snapshot.objects,
      });
      broadcastActorsFrame({
        version: protocolVersion,
        timestamp: sceneMessage.snapshot.timestamp,
        windowKey,
        actors: sceneMessage.snapshot.actors,
      });
    });

    socket.on('close', (code, reason) => {
      logger.info(`WebSocket closed (${describeSocket(socket)}): code=${code}, reason=${reason.toString() || '<empty>'}; ${describeSocketState(socket)}`);
      cleanupSocket(socket);
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
      const latestTimestamp = currentLatestTimestamp(latestTerrainSnapshot, latestObjectsSnapshot, latestActorsFrame);

      return {
        clientCount: clients.size,
        hasPlugin: Boolean(pluginSocket && pluginSocket.readyState === pluginSocket.OPEN),
        ...(latestTimestamp === undefined ? {} : {latestTimestamp}),
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

function partitionObjectModels(models: ObjectModelDefinition[]) {
  const batches: ObjectModelDefinition[][] = [];
  let currentBatch: ObjectModelDefinition[] = [];
  let currentChars = 0;

  for (const model of models) {
    const estimatedChars = estimateObjectModelDefinitionChars(model);

    if (currentBatch.length > 0 && currentChars + estimatedChars > MAX_OBJECT_MODEL_BATCH_CHARS) {
      batches.push(currentBatch);
      currentBatch = [];
      currentChars = 0;
    }

    currentBatch.push(model);
    currentChars += estimatedChars;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

function partitionActorModels(models: ActorModelDefinition[]) {
  const batches: ActorModelDefinition[][] = [];
  let currentBatch: ActorModelDefinition[] = [];
  let currentChars = 0;

  for (const model of models) {
    const estimatedChars = estimateActorModelDefinitionChars(model);

    if (currentBatch.length > 0 && currentChars + estimatedChars > MAX_OBJECT_MODEL_BATCH_CHARS) {
      batches.push(currentBatch);
      currentBatch = [];
      currentChars = 0;
    }

    currentBatch.push(model);
    currentChars += estimatedChars;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

function estimateObjectModelDefinitionChars(model: ObjectModelDefinition) {
  return JSON.stringify(model).length + 64;
}

function estimateActorModelDefinitionChars(model: ActorModelDefinition) {
  return JSON.stringify(model).length + 64;
}

function currentLatestTimestamp(
  terrainSnapshot?: TerrainSnapshot,
  objectsSnapshot?: ObjectsSnapshot,
  actorsFrame?: ActorsFrame,
) {
  const latestTimestamp = Math.max(
    terrainSnapshot?.timestamp ?? 0,
    objectsSnapshot?.timestamp ?? 0,
    actorsFrame?.timestamp ?? 0,
  );

  return latestTimestamp > 0 ? latestTimestamp : undefined;
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
