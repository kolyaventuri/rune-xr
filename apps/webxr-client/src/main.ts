import './styles.css';
import {
  AmbientLight,
  Color,
  DirectionalLight,
  MOUSE,
  PerspectiveCamera,
  Scene,
  Spherical,
  Vector3,
  WebGLRenderer,
} from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {type SceneSnapshot, sampleSceneSnapshot} from '@rune-xr/protocol';
import {BoardScene} from './render/BoardScene.js';
import {BridgeSocketClient} from './net/BridgeSocketClient.js';
import {WorldStateStore} from './world/WorldStateStore.js';
import {XRPlacementController} from './xr/XRPlacementController.js';

type XRNavigator = Navigator & {
  xr?: {
    isSessionSupported: (mode: string) => Promise<boolean>;
    requestSession: (mode: string, init?: Record<string, unknown>) => Promise<any>;
  };
};

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('Could not find #app root node.');
}

root.innerHTML = `
  <div class="shell">
    <button class="hud-toggle" type="button" data-toggle-hud aria-pressed="true">Show HUD</button>
    <section class="hud" data-hud>
      <p class="eyebrow">Rune XR Prototype</p>
      <h1 class="title">Quest-ready tabletop RuneScape</h1>
      <p class="lede">
        Live terrain, actor markers, and coarse object proxies rendered as a miniature board.
        Use the desktop preview first, then switch to passthrough AR on Quest.
      </p>
      <div class="panel-grid">
        <article class="metric">
          <span class="metric-label">Bridge</span>
          <span class="metric-value" data-bridge-status>Connecting…</span>
        </article>
        <article class="metric">
          <span class="metric-label">Snapshot</span>
          <span class="metric-value" data-snapshot-status>Sample fixture</span>
        </article>
      </div>
      <div class="actions">
        <button class="button button-primary" type="button" data-enter-ar>Enter AR</button>
        <button class="button button-secondary" type="button" data-load-sample>Load Sample</button>
      </div>
      <ul class="legend">
        <li><span class="swatch" style="background:#29bf6f"></span> You</li>
        <li><span class="swatch" style="background:#2a76d2"></span> Other players</li>
        <li><span class="swatch" style="background:#d14b44"></span> NPCs</li>
      </ul>
      <p class="status" data-ar-hint>Desktop preview is active. Use a Quest browser on the same LAN for AR placement.</p>
    </section>
    <div class="viewport" data-viewport></div>
  </div>
`;

const viewport = root.querySelector<HTMLDivElement>('[data-viewport]');
const hud = root.querySelector<HTMLElement>('[data-hud]');
const toggleHudButton = root.querySelector<HTMLButtonElement>('[data-toggle-hud]');
const bridgeStatus = root.querySelector<HTMLElement>('[data-bridge-status]');
const snapshotStatus = root.querySelector<HTMLElement>('[data-snapshot-status]');
const arHint = root.querySelector<HTMLElement>('[data-ar-hint]');
const enterArButton = root.querySelector<HTMLButtonElement>('[data-enter-ar]');
const loadSampleButton = root.querySelector<HTMLButtonElement>('[data-load-sample]');

if (!viewport || !hud || !toggleHudButton || !bridgeStatus || !snapshotStatus || !arHint || !enterArButton || !loadSampleButton) {
  throw new Error('Viewer UI failed to initialize.');
}

const hudElement = hud;
const hudToggleButton = toggleHudButton;

let hudVisible = false;
hudElement.hidden = !hudVisible;

const renderer = new WebGLRenderer({
  alpha: true,
  antialias: true,
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.xr.enabled = true;
renderer.setClearColor(new Color('#000000'), 0);
viewport.append(renderer.domElement);

const scene = new Scene();
const camera = new PerspectiveCamera(55, 1, 0.01, 20);

camera.position.set(0.62, 0.48, 0.72);

const controls = new OrbitControls(camera, renderer.domElement);
const previewRotationInput = {
  horizontal: 0,
  tilt: 0,
};
let previousFrameTime = performance.now();

controls.enableDamping = true;
controls.target.set(0.12, 0.06, 0.12);
controls.mouseButtons.LEFT = MOUSE.PAN;
controls.mouseButtons.MIDDLE = MOUSE.DOLLY;
controls.mouseButtons.RIGHT = MOUSE.ROTATE;

scene.add(new AmbientLight('#fff7e6', 1.8));
const sun = new DirectionalLight('#fff3d1', 2.1);

sun.position.set(1.4, 2.4, 1.2);
scene.add(sun);

const boardScene = new BoardScene();
const xrPlacementController = new XRPlacementController(boardScene);
const worldState = new WorldStateStore();

scene.add(boardScene.root, xrPlacementController.reticle);

applySnapshot(sampleSceneSnapshot, 'Loaded sample fixture');

const bridgeClient = new BridgeSocketClient({
  onSnapshot(snapshot) {
    applySnapshot(snapshot, `Live @ ${new Date(snapshot.timestamp).toLocaleTimeString()}`);
  },
  onStatus(status) {
    bridgeStatus.textContent = status;
  },
});

bridgeClient.connect();

renderer.setAnimationLoop((time, frame) => {
  const deltaSeconds = Math.min((time - previousFrameTime) / 1000, 0.05);

  previousFrameTime = time;
  const snapshot = worldState.getCurrentSnapshot();

  if (snapshot) {
    boardScene.updateActors(worldState.getInterpolatedActors(performance.now()));
  }

  if (frame) {
    xrPlacementController.update({
      session: renderer.xr.getSession(),
      frame,
      referenceSpace: renderer.xr.getReferenceSpace(),
    });
  }

  updatePreviewCameraRotation(deltaSeconds);
  controls.update();
  renderer.render(scene, camera);
});

window.addEventListener('resize', resizeViewport);
resizeViewport();

loadSampleButton.addEventListener('click', () => {
  applySnapshot(sampleSceneSnapshot, 'Loaded sample fixture');
});

toggleHudButton.addEventListener('click', () => {
  setHudVisible(!hudVisible);
});

globalThis.addEventListener('keydown', event => {
  if (event.repeat || event.defaultPrevented || event.key.toLowerCase() !== 'h') {
    return;
  }

  const target = event.target;

  if (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLButtonElement
    || (target instanceof HTMLElement && target.isContentEditable)
  ) {
    return;
  }

  setHudVisible(!hudVisible);
});

globalThis.addEventListener('keydown', event => {
  if (event.defaultPrevented || !controls.enabled) {
    return;
  }

  const target = event.target;

  if (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLButtonElement
    || (target instanceof HTMLElement && target.isContentEditable)
  ) {
    return;
  }

  switch (event.key) {
    case 'ArrowLeft': {
      event.preventDefault();
      previewRotationInput.horizontal = -1;
      break;
    }

    case 'ArrowRight': {
      event.preventDefault();
      previewRotationInput.horizontal = 1;
      break;
    }

    case 'ArrowUp': {
      event.preventDefault();
      previewRotationInput.tilt = -1;
      break;
    }

    case 'ArrowDown': {
      event.preventDefault();
      previewRotationInput.tilt = 1;
      break;
    }

    default:
  }
});

globalThis.addEventListener('keyup', event => {
  switch (event.key) {
    case 'ArrowLeft': {
      if (previewRotationInput.horizontal < 0) {
        previewRotationInput.horizontal = 0;
      }

      break;
    }

    case 'ArrowRight': {
      if (previewRotationInput.horizontal > 0) {
        previewRotationInput.horizontal = 0;
      }

      break;
    }

    case 'ArrowUp': {
      if (previewRotationInput.tilt < 0) {
        previewRotationInput.tilt = 0;
      }

      break;
    }

    case 'ArrowDown': {
      if (previewRotationInput.tilt > 0) {
        previewRotationInput.tilt = 0;
      }

      break;
    }

    default:
  }
});

void configureArButton();

enterArButton.addEventListener('click', async () => {
  const currentSession = renderer.xr.getSession();

  if (currentSession) {
    await currentSession.end();
    return;
  }

  const xrNavigator = navigator as XRNavigator;

  if (!xrNavigator.xr) {
    arHint.textContent = 'WebXR immersive-ar is unavailable in this browser.';
    return;
  }

  const session = await xrNavigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['anchors', 'dom-overlay'],
    domOverlay: {root},
  });

  await renderer.xr.setSession(session);
  controls.enabled = false;
  enterArButton.textContent = 'Exit AR';
  arHint.textContent = 'Move your headset until the placement ring appears, then tap to anchor the board.';
  await xrPlacementController.start(session);
  session.addEventListener('end', () => {
    controls.enabled = true;
    enterArButton.textContent = 'Enter AR';
    arHint.textContent = 'Desktop preview is active. Use a Quest browser on the same LAN for AR placement.';
    boardScene.setVisible(true);
  }, {once: true});
});

function applySnapshot(snapshot: SceneSnapshot, label: string) {
  const update = worldState.applySnapshot(snapshot);

  boardScene.applySnapshot(snapshot, {
    terrainChanged: update.terrainChanged,
    objectsChanged: update.objectsChanged,
  });
  boardScene.updateActors(worldState.getInterpolatedActors());
  snapshotStatus!.textContent = label;
}

async function configureArButton() {
  const xrNavigator = navigator as XRNavigator;

  if (!xrNavigator.xr) {
    enterArButton!.disabled = true;
    arHint!.textContent = 'This browser does not expose WebXR immersive-ar.';
    return;
  }

  const supported = await xrNavigator.xr.isSessionSupported('immersive-ar');

  if (!supported) {
    enterArButton!.disabled = true;
    arHint!.textContent = 'immersive-ar is not supported here. Use Quest Browser for passthrough AR.';
  }
}

function resizeViewport() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function updatePreviewCameraRotation(deltaSeconds: number) {
  if (!controls.enabled) {
    previewRotationInput.horizontal = 0;
    previewRotationInput.tilt = 0;
    return;
  }

  if (previewRotationInput.horizontal === 0 && previewRotationInput.tilt === 0) {
    return;
  }

  const rotationSpeed = Math.PI * 0.8;
  const tiltSpeed = Math.PI * 0.6;

  rotatePreviewCamera(
    previewRotationInput.horizontal * rotationSpeed * deltaSeconds,
    previewRotationInput.tilt * tiltSpeed * deltaSeconds,
  );
}

function rotatePreviewCamera(deltaTheta: number, deltaPhi = 0) {
  const offset = new Vector3().subVectors(camera.position, controls.target);
  const spherical = new Spherical().setFromVector3(offset);

  spherical.theta += deltaTheta;
  spherical.phi = Math.min(Math.max(spherical.phi + deltaPhi, 0.05), Math.PI - 0.05);

  offset.setFromSpherical(spherical);
  camera.position.copy(controls.target).add(offset);
  camera.lookAt(controls.target);
  controls.update();
}

function setHudVisible(visible: boolean) {
  hudVisible = visible;
  hudElement.hidden = !visible;
  hudToggleButton.textContent = visible ? 'Hide HUD' : 'Show HUD';
  hudToggleButton.setAttribute('aria-pressed', String(visible));
}
