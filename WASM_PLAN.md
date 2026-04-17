# WASM Evaluation for `webxr-client`

## Summary
Local synthetic benchmarking says the best WASM candidates are the pure numeric mesh builders, not the XR/render loop or scene-state code.

- `ObjectMeshBuilder` is the strongest candidate. In a local synthetic case of `150` modeled objects with `256` faces each, mesh generation took about `13.7 ms` per rebuild.
- `TerrainMeshBuilder` is the next-best candidate. A `64x64` flat-cell terrain rebuild took about `3.35 ms`; a modeled `32x32` terrain took about `6.13 ms`.
- `WorldStateStore` is already cheap. Applying a `64x64` terrain snapshot with `1000` actors took about `0.41 ms`; actor interpolation was about `0.07 ms`.
- A proxy-heavy `BoardScene.applySnapshot()` case took about `12.5 ms`, but that path is mostly Three scene-graph work and mesh creation, so the right fix there is instancing/incremental updates, not WASM.

These numbers are from desktop-local synthetic data, so use them for ranking, not absolute Quest budgets.

## Likely Biggest Lift
1. Move modeled object mesh expansion in [ObjectMeshBuilder.ts](/Users/kolya/dev/rune-xr/apps/webxr-client/src/render/ObjectMeshBuilder.ts) to WASM first.
2. Move terrain mesh expansion, especially modeled tiles and seam stitching, in [TerrainMeshBuilder.ts](/Users/kolya/dev/rune-xr/apps/webxr-client/src/render/TerrainMeshBuilder.ts) second.
3. Keep [BoardScene.ts](/Users/kolya/dev/rune-xr/apps/webxr-client/src/render/BoardScene.ts) in JS and optimize it with `InstancedMesh`, geometry reuse, and partial rebuilds instead of WASM.
4. Do not spend WASM effort on state hashing/interpolation first.

Important nuance: `computeVertexNormals()` is only part of the cost. In the benchmarks above it was roughly `0.5 ms` of terrain rebuilds and `2.8 ms` of the modeled-object rebuild. That means a “WASM normals only” port is too narrow; the useful unit is the whole buffer-generation pipeline.

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
- First, add a benchmark/profiling harness with representative live snapshots and measure on Quest Browser.
- Second, do the low-risk JS wins:
  - Workerize terrain/object rebuilds.
  - Replace repeated `number[]` growth plus `Float32Array` conversion with pre-sized typed arrays where practical.
  - Convert repeated proxy meshes in `BoardScene` to instancing/reuse.
- Third, only if snapshot rebuild spikes are still material, implement a WASM spike for object meshes, then terrain meshes.
- Leave protocol JSON as-is for the first spike. Only consider a binary snapshot format if profiling later shows JSON parse/object materialization is a meaningful share.

## Test Plan
- Benchmark baseline TS, TS+Worker, and WASM on desktop Chrome and Quest Browser.
- Use at least three scene classes:
  - large flat terrain
  - modeled terrain with seam stitching
  - model-heavy object sets
- Acceptance default:
  - keep visual output byte/vertex-equivalent to the TS path within normal float tolerance
  - reduce combined terrain/object rebuild p95 by at least `35%` on Quest-sized scenes
  - avoid regressions in snapshot correctness, texture assignment, and actor motion

## Assumptions
- Primary target is Quest/mobile-class CPU, not desktop.
- Real bridge snapshots will be much larger and more model-heavy than the sample fixture.
- No Rust toolchain is installed in the repo today, so WASM adds build/CI complexity and should be justified by measured gains.
- Default recommendation is “JS/Worker/instancing first, WASM second,” with modeled object generation as the first WASM candidate.
