# WASM Evaluation for `webxr-client`

## Summary
Synthetic scene benchmarking has been removed because it was not representative
enough for Quest performance or render-capability decisions. Treat the current
WASM ranking as a hypothesis only until it is backed by representative live
RuneLite snapshots captured from the bridge.

- The most plausible WASM candidates are still the pure numeric mesh builders,
  especially modeled object expansion and terrain mesh generation.
- The XR loop, DOM/UI work, socket handling, and scene-graph ownership should
  remain in TypeScript unless live profiling proves otherwise.
- `BoardScene.applySnapshot()` is still more likely to benefit from
  instancing/reuse and partial rebuilds than from WASM.

## Likely Biggest Lift
1. Measure [ObjectMeshBuilder.ts](/Users/kolya/dev/rune-xr/apps/webxr-client/src/render/ObjectMeshBuilder.ts) against recorded live snapshots first.
2. Measure [TerrainMeshBuilder.ts](/Users/kolya/dev/rune-xr/apps/webxr-client/src/render/TerrainMeshBuilder.ts), especially modeled tiles and seam stitching, second.
3. Keep [BoardScene.ts](/Users/kolya/dev/rune-xr/apps/webxr-client/src/render/BoardScene.ts) in JS and optimize it with `InstancedMesh`, geometry reuse, and partial rebuilds before considering WASM.
4. Do not spend WASM effort on state hashing/interpolation first.

Important nuance: a “WASM normals only” port is likely too narrow. Profile the
whole buffer-generation pipeline, not just `computeVertexNormals()`.

## What The WASM Version Should Look Like
Use WASM only for coarse, pure-data kernels.

- Add an internal `webxr-kernels` module, preferably Rust-based WASM, loaded by Vite.
- Keep WebXR, Three scene ownership, texture decode, socket handling, and DOM/UI in TS.
- Flatten snapshot data into typed arrays before crossing the JS/WASM boundary.
- Expose coarse entrypoints such as:
  - `buildTerrainBuffers(flatTiles, modeledTiles, models, textureMeta) -> {positions, colors, uvs, normals?, groups}`
  - `buildObjectBuffers(objects, vertices, faces, textureMeta) -> {positions, colors, uvs, normals?, textureRanges}`
- In TS, wrap those outputs into `BufferGeometry`/`Mesh` objects.
- Keep a TS fallback implementation for correctness tests and rollout safety.
- Run the rebuild path in a Web Worker whether or not WASM is used. On Quest-class CPUs, moving rebuild spikes off the main thread is likely as important as raw compute speed.

## Recommended Implementation Order
- First, add a replay/profiling harness driven by representative live snapshots captured from the bridge and measure on Quest Browser.
- Second, do the low-risk JS wins:
  - Workerize terrain/object rebuilds.
  - Replace repeated `number[]` growth plus `Float32Array` conversion with pre-sized typed arrays where practical.
  - Convert repeated proxy meshes in `BoardScene` to instancing/reuse.
- Third, only if snapshot rebuild spikes are still material, implement a WASM spike for object meshes, then terrain meshes.
- Leave protocol JSON as-is for the first spike. Only consider a binary snapshot format if profiling later shows JSON parse/object materialization is a meaningful share.

## Test Plan
- Benchmark baseline TS, TS+Worker, and WASM on desktop Chrome and Quest Browser.
- Use at least three captured live scene classes that cover:
  - mostly flat terrain
  - modeled terrain with seam stitching
  - model-heavy object sets
- Acceptance default:
  - keep visual output byte/vertex-equivalent to the TS path within normal float tolerance
  - reduce combined terrain/object rebuild p95 by at least `35%` on Quest-sized scenes
  - avoid regressions in snapshot correctness, texture assignment, and actor motion

## Assumptions
- Primary target is Quest/mobile-class CPU, not desktop.
- Replay fixtures should come from real bridge snapshots rather than synthetic scenes.
- No Rust toolchain is installed in the repo today, so WASM adds build/CI complexity and should be justified by measured gains.
- Default recommendation is “JS/Worker/instancing first, WASM second,” with modeled object generation as the first WASM candidate.
