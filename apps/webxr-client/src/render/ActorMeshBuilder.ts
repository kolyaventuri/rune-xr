import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import type {Actor} from '@rune-xr/protocol';
import {HEIGHT_SCALE, TILE_WORLD_SIZE} from '../config.js';

const LOCAL_TILE_SIZE = 128;

type ActorModel = NonNullable<Actor['model']>;
type ActorFace = ActorModel['faces'][number];
type ActorVertex = ActorModel['vertices'][number];

const fallbackActorColors = {
  self: new Color('#29bf6f'),
  player: new Color('#2a76d2'),
  npc: new Color('#d14b44'),
} satisfies Record<Actor['type'], Color>;

export function createActorMesh(actor: Pick<Actor, 'type'>, model: ActorModel) {
  const geometry = new BufferGeometry();
  const positions: number[] = [];
  const colors: number[] = [];
  const fallbackColor = fallbackActorColors[actor.type];
  const anchor = resolveActorAnchor(model);

  for (const face of model.faces) {
    const a = model.vertices[face.a];
    const b = model.vertices[face.b];
    const c = model.vertices[face.c];

    if (!a || !b || !c) {
      continue;
    }

    appendVertex(a, anchor, positions);
    appendVertex(b, anchor, positions);
    appendVertex(c, anchor, positions);

    appendColor(colors, resolveFaceVertexColor(face, 'A', fallbackColor));
    appendColor(colors, resolveFaceVertexColor(face, 'B', fallbackColor));
    appendColor(colors, resolveFaceVertexColor(face, 'C', fallbackColor));
  }

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const mesh = new Mesh(geometry, new MeshStandardMaterial({
    vertexColors: true,
    side: DoubleSide,
    roughness: 0.92,
    metalness: 0.02,
  }));

  mesh.name = 'actor-model';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function appendVertex(
  vertex: ActorVertex,
  anchor: {x: number; y: number; z: number},
  positions: number[],
) {
  positions.push(
    ((vertex.x - anchor.x) / LOCAL_TILE_SIZE) * TILE_WORLD_SIZE,
    (vertex.y - anchor.y) * HEIGHT_SCALE,
    (-(vertex.z - anchor.z) / LOCAL_TILE_SIZE) * TILE_WORLD_SIZE,
  );
}

function resolveActorAnchor(model: ActorModel) {
  let minY = Number.POSITIVE_INFINITY;

  for (const vertex of model.vertices) {
    minY = Math.min(minY, vertex.y);
  }

  return {
    x: 0,
    y: Number.isFinite(minY) ? minY : 0,
    z: 0,
  };
}

function appendColor(colors: number[], color: Color) {
  colors.push(color.r, color.g, color.b);
}

function resolveFaceVertexColor(face: ActorFace, suffix: 'A' | 'B' | 'C', fallbackColor: Color) {
  const rgb = switchFaceVertexRgb(face, suffix);

  if (rgb !== undefined) {
    return new Color(rgb);
  }

  if (face.rgb !== undefined) {
    return new Color(face.rgb);
  }

  return fallbackColor;
}

function switchFaceVertexRgb(face: ActorFace, suffix: 'A' | 'B' | 'C') {
  switch (suffix) {
    case 'A': {
      return face.rgbA;
    }

    case 'B': {
      return face.rgbB;
    }

    case 'C': {
      return face.rgbC;
    }
  }
}
