import {
  createHelloMessage,
  parseProtocolMessage,
  type ObjectModelDefinition,
  type ProtocolMessage,
  type SceneSnapshot,
  type TextureDefinition,
} from '@rune-xr/protocol';

type BridgeSocketClientOptions = {
  onObjectModelBatch: (models: ObjectModelDefinition[]) => void;
  onSnapshot: (snapshot: SceneSnapshot) => void;
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
    if (message.kind === 'scene_snapshot') {
      this.options.onSnapshot(message.snapshot);
      return;
    }

    if (message.kind === 'object_model_batch') {
      this.options.onObjectModelBatch(message.models);
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
