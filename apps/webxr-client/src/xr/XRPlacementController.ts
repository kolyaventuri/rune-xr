import {Matrix4, Mesh, MeshBasicMaterial, RingGeometry} from 'three';
import type {BoardScene} from '../render/BoardScene.js';

type XRRenderContext = {
  session: any;
  frame: any;
  referenceSpace: any;
};

export class XRPlacementController {
  readonly reticle: Mesh;

  private readonly board: BoardScene;
  private currentHit?: any;
  private hitTestSource?: any;
  private viewerSpace?: any;
  private anchor?: any;
  private session?: any;

  constructor(board: BoardScene) {
    this.board = board;
    this.reticle = new Mesh(
      new RingGeometry(0.035, 0.045, 32).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({
        color: '#ff9c3c',
      }),
    );
    this.reticle.visible = false;
  }

  async start(session: any) {
    this.session = session;
    this.reticle.visible = false;
    this.board.setVisible(false);

    if (typeof session.requestReferenceSpace !== 'function' || typeof session.requestHitTestSource !== 'function') {
      return false;
    }

    this.viewerSpace = await session.requestReferenceSpace('viewer');
    this.hitTestSource = await session.requestHitTestSource({
      space: this.viewerSpace,
    });
    session.addEventListener('select', this.onSelect);
    session.addEventListener('end', this.onSessionEnd);

    return true;
  }

  stop() {
    this.reticle.visible = false;
    this.currentHit = undefined;
    this.hitTestSource?.cancel?.();
    this.hitTestSource = undefined;
    this.anchor?.delete?.();
    this.anchor = undefined;
    this.session?.removeEventListener?.('select', this.onSelect);
    this.session?.removeEventListener?.('end', this.onSessionEnd);
    this.session = undefined;
  }

  update(context: XRRenderContext) {
    if (!context.frame || !this.hitTestSource) {
      this.reticle.visible = false;
      return;
    }

    if (this.anchor) {
      const anchorPose = context.frame.getPose(this.anchor.anchorSpace, context.referenceSpace);

      if (anchorPose) {
        this.applyPose(anchorPose.transform.matrix);
      }
    }

    const hits = context.frame.getHitTestResults(this.hitTestSource);

    if (hits.length === 0) {
      this.reticle.visible = false;
      this.currentHit = undefined;
      return;
    }

    this.currentHit = hits[0];
    const pose = this.currentHit.getPose(context.referenceSpace);

    if (!pose) {
      this.reticle.visible = false;
      return;
    }

    this.reticle.visible = true;
    this.reticle.matrix.fromArray(pose.transform.matrix);
    this.reticle.matrix.decompose(
      this.reticle.position,
      this.reticle.quaternion,
      this.reticle.scale,
    );
  }

  private readonly onSelect = async () => {
    if (!this.currentHit || !this.session) {
      return;
    }

    const referenceSpace = this.session.requestReferenceSpace
      ? await this.session.requestReferenceSpace('local')
      : undefined;
    const pose = referenceSpace ? this.currentHit.getPose(referenceSpace) : undefined;

    if (pose) {
      this.applyPose(pose.transform.matrix);
    }

    if (typeof this.currentHit.createAnchor === 'function') {
      try {
        this.anchor = await this.currentHit.createAnchor();
      } catch {
        this.anchor = undefined;
      }
    }
  };

  private readonly onSessionEnd = () => {
    this.stop();
  };

  private applyPose(matrixArray: Float32Array | number[]) {
    const matrix = new Matrix4().fromArray(matrixArray);

    this.board.applyPlacementMatrix(matrix);
    this.board.setVisible(true);
  }
}

