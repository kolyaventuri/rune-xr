# Texture Streaming Evaluation: Terrain-First Path Toward Client Parity

## Summary

- This is feasible in the current architecture, with moderate scope, because the RuneLite plugin already extracts and ships terrain `texture` IDs and the client already invalidates terrain when `tile.surface` changes.
- The missing pieces are not discovery of texture identity; they are actual pixel transport, texture caching, and UV/material generation in the WebXR renderer.
- Phase 1 should target terrain parity only. It will make the world feel closer to the RuneLite client, but it will not deliver full client parity because objects, walls, NPCs, and players are still rendered as coarse proxies today.

## Implementation Changes

### Protocol and bridge

- Add a new protocol message kind: `texture_batch`.
- Add `TextureDefinition` with `id`, `width`, `height`, `pngBase64`, and optional `animationDirection` / `animationSpeed`.
- Keep `scene_snapshot` as reference-only for terrain textures via existing `surface.texture` and `face.texture`; do not inline pixel data into snapshots.
- Update the bridge to cache texture definitions by `id` and replay all cached textures to a newly connected client before replaying the latest `scene_snapshot`.

### RuneLite plugin

- In `SceneExtractor`, continue collecting `surface.texture` and `face.texture` IDs from flat and modeled tiles.
- Add a texture extraction path that, for newly referenced texture IDs only, calls `TextureProvider.load(id)` at brightness `1.0`, converts the returned `128x128` RGBA pixels to PNG, and sends them in `texture_batch`.
- Capture animation metadata from RuneLite `Texture` objects now, but treat it as future-facing metadata; v1 rendering remains static.
- Maintain a per-connection “sent texture IDs” cache in the plugin and clear it on reconnect/reset.

### WebXR renderer

- Extend the socket client with `onTextureBatch` handling separate from `onSnapshot`.
- Add a fixed `2048x2048` terrain atlas for RuneLite texture IDs `0..255` and update atlas slots as batches arrive.
- Split terrain output into two meshes:
  1. A textured terrain mesh for faces with texture IDs.
  2. The existing color-driven terrain mesh for faces without textures or with failed texture loads.
- Update terrain generation so textured faces emit `uv` data. Flat tiles should map the full tile to the texture slot; modeled faces and stitch faces should derive UVs from local tile `x/z` coordinates so shaped terrain stays coherent.
- Use a standard lit terrain material for the textured mesh and keep the current vertex-colored material for the fallback mesh.
- Receiving `texture_batch` must update materials only; it must not force a terrain geometry rebuild.

### Phase 2 toward broader parity

- Leave actors and object proxies unchanged in phase 1.
- A later parity phase would replace coarse object/actor payloads with extracted model data and texture references. That is a separate extraction/rendering project, not part of terrain texture streaming.

## Public API / Interface Changes

- `ProtocolMessage` gains `texture_batch`.
- New shared types: `TextureDefinition`, `TextureBatchMessage`.
- Bridge client callback surface gains texture-batch handling.
- No phase-1 wire changes to object payloads.

## Test Plan

- Add protocol tests for valid/invalid `texture_batch` messages.
- Add bridge tests proving cached textures are replayed to late clients before the latest snapshot.
- Add plugin tests proving only newly referenced texture IDs are encoded and sent, and that missing loads fall back cleanly.
- Add terrain builder tests for:
  - flat-tile UV generation,
  - modeled-face UV generation,
  - textured vs non-textured mesh splitting,
  - no terrain rebuild on texture-only updates.
- Manual verification:
  - connect a fresh client to a live bridge and confirm textured terrain appears immediately,
  - move between areas with different terrain textures and confirm only new texture IDs stream,
  - verify untextured areas still render with the current color fallback.

## Assumptions and Defaults

- Phase 1 scope is terrain surfaces only.
- Renderer v1 uses static textures only; animation metadata is carried but not rendered yet.
- JSON WebSocket plus base64 PNG is acceptable because textures are cached and streamed once/delta rather than every `scene_snapshot`.
- RuneLite terrain texture IDs fit the current `0..255` texture set exposed by the client.
- This improves terrain realism substantially, but “actual client” parity still requires a later model-extraction phase for objects and actors.
