# Render Fidelity Plan

## Current Status

- Terrain texture streaming phase 1 is implemented.
- The bridge now caches and replays `texture_batch` payloads, the RuneLite plugin extracts terrain texture PNGs once per texture ID, and the WebXR client renders textured terrain through a shared atlas with a color fallback.
- That work improves ground readability, but it does not get us close to RuneLite client parity by itself.
- The screenshot comparison made the remaining gap clear: most of the visual miss is object fidelity, not terrain streaming.

## Completed Work

### Terrain texture streaming

- Added protocol support for `texture_batch` and `TextureDefinition`.
- Kept `scene_snapshot` texture references lightweight by sending only terrain/object texture IDs there and streaming pixel data separately.
- Added bridge-side texture caching and replay so late clients receive known textures before the latest snapshot.
- Extracted texture PNGs from RuneLite `TextureProvider` at brightness `1.0`.
- Added a `2048x2048` atlas in the WebXR client and split terrain rendering into:
  - textured terrain faces
  - vertex-colored fallback terrain faces
- Added UV generation for flat tiles, shaped terrain faces, and terrain seam stitches.
- Kept texture updates material-only so incoming texture batches do not trigger terrain rebuilds.

## Current Priority

### Object parity

- Terrain fidelity alone is not enough because walls, buildings, doors, banners, stairs, and most recognizable landmarks are RuneLite object models, while the XR client previously rendered coarse proxies.
- The active work is to replace those proxies with extracted object geometry and materials wherever the RuneLite client exposes renderable model data.

### Object parity implementation

- Extend `SceneObject` payloads with optional extracted model data:
  - vertices
  - faces
  - face colors
  - face texture IDs
  - per-face UVs when available
- Extract object models from RuneLite `Renderable` / `Model` data for:
  - `GameObject`
  - `WallObject`
  - `DecorativeObject`
  - `GroundObject`
- Preserve object orientation and local placement offsets so rendered geometry lands in the same tile space as the RuneLite client.
- Render model-backed objects in the WebXR client as real meshes, with:
  - a lit vertex-colored mesh
  - a textured overlay mesh using the shared texture atlas
- Keep proxy geometry only as a fallback for objects that still do not provide usable model data.
- Treat object model changes as object-scene changes so they trigger object rebuilds even when IDs and tile positions stay the same.

## Next Work Item After Object Parity

### Terrain fidelity follow-up

- Once object parity is in place, come back to terrain fidelity and close the remaining gap between streamed terrain textures and actual RuneLite terrain composition.
- Focus areas:
  - overlay/underlay-aware terrain material selection
  - closer handling of shaped-tile orientation rules
  - client-like blending between surfaces where possible
  - animated texture playback using the streamed animation metadata
- This should be treated as a follow-up pass after object parity, not as the current blocker.

## Later Parity Work

- Actor parity still remains out of scope for the current pass.
- A later phase should replace coarse player/NPC markers with extracted actor model data and animation state.

## Verification

- Protocol tests cover `texture_batch` and richer object/tile payload shapes.
- Plugin tests cover payload serialization and build integrity.
- WebXR tests cover terrain texturing behavior, object-model rendering, and rebuild invalidation when model payloads change.

## Practical Outcome

- Terrain texture streaming is done and worth keeping.
- The biggest remaining step toward “looks like RuneLite” is object parity.
- After object parity lands, terrain fidelity should get a second pass to tighten mapping, blending, and animation behavior.
