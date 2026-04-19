import {
  type ActorsFrame,
  createHelloMessage,
  type ActorModelDefinition,
  type ObjectsSnapshot,
  parseProtocolMessage,
  type ObjectModelDefinition,
  type ProtocolMessage,
  type SceneSnapshot,
  type TerrainSnapshot,
  type TextureDefinition,
} from '@rune-xr/protocol';

type BridgeSocketClientOptions = {
  onActorsFrame: (frame: ActorsFrame) => void;
  onActorModelBatch: (models: ActorModelDefinition[]) => void;
  onObjectModelBatch: (models: ObjectModelDefinition[]) => void;
  onObjectsSnapshot: (snapshot: ObjectsSnapshot) => void;
  onSnapshot?: (snapshot: SceneSnapshot) => void;
  onTerrainSnapshot: (snapshot: TerrainSnapshot) => void;
  onTextureBatch: (textures: TextureDefinition[]) => void;
  onStatus: (status: string) => void;
};

export class BridgeSocketClient {
  private readonly socketUrl: string;
  private readonly options: BridgeSocketClientOptions;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private socket?: WebSocket;
  private closed = false;

  constructor(options: BridgeSocketClientOptions, socketUrl = resolveSocketUrl()) {
    this.options = options;
    this.socketUrl = socketUrl;
  }

  connect() {
    if (this.closed) {
      return;
    }

    this.options.onStatus(`Connecting to ${this.socketUrl}`);
    this.socket = new WebSocket(this.socketUrl);

    this.socket.addEventListener('open', () => {
      this.options.onStatus('Bridge connected');
      this.socket?.send(JSON.stringify(createHelloMessage('client', 'webxr-client')));
    });

    this.socket.addEventListener('message', event => {
      const message = parseProtocolMessage(JSON.parse(String(event.data)));

      this.handleMessage(message);
    });

    this.socket.addEventListener('close', () => {
      if (this.closed) {
        return;
      }

      this.options.onStatus('Bridge disconnected, retrying...');
      this.reconnectTimer = globalThis.setTimeout(() => {
        this.connect();
      }, 1_500);
    });

    this.socket.addEventListener('error', () => {
      this.options.onStatus('Bridge connection error');
    });
  }

  destroy() {
    this.closed = true;
    this.socket?.close();
    globalThis.clearTimeout(this.reconnectTimer);
  }

  private handleMessage(message: ProtocolMessage) {
    if (message.kind === 'terrain_snapshot') {
      this.options.onTerrainSnapshot(message);
      return;
    }

    if (message.kind === 'objects_snapshot') {
      this.options.onObjectsSnapshot(message);
      return;
    }

    if (message.kind === 'actors_frame') {
      this.options.onActorsFrame(message);
      return;
    }

    if (message.kind === 'scene_snapshot') {
      this.options.onSnapshot?.(message.snapshot);
      return;
    }

    if (message.kind === 'object_model_batch') {
      this.options.onObjectModelBatch(message.models);
      return;
    }

    if (message.kind === 'actor_model_batch') {
      this.options.onActorModelBatch(message.models);
      return;
    }

    if (message.kind === 'texture_batch') {
      this.options.onTextureBatch(message.textures);
      return;
    }

    if (message.kind === 'error') {
      this.options.onStatus(`Bridge error: ${message.message}`);
      return;
    }

    if (message.kind === 'ack' && message.detail) {
      this.options.onStatus(`Bridge ${message.detail.replaceAll('_', ' ')}`);
    }
  }
}

function resolveSocketUrl() {
  if (import.meta.env.VITE_BRIDGE_WS_URL) {
    return import.meta.env.VITE_BRIDGE_WS_URL;
  }

  const scheme = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const isBridgeHost = globalThis.location.port === '8787';
  const authority = isBridgeHost ? globalThis.location.host : `${globalThis.location.hostname}:8787`;

  return `${scheme}//${authority}/ws`;
}
