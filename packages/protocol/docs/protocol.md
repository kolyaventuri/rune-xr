# Rune XR Protocol

The bridge, browser client, and RuneLite plugin communicate over JSON messages.

## Envelope

- `hello`: identifies a connection as `plugin` or `client`
- `scene_snapshot`: legacy full-scene envelope kept for fixtures/debugging
- `terrain_snapshot`: delivers the current tile window for a `windowKey`
- `objects_snapshot`: delivers object state for a `windowKey`
- `actors_frame`: delivers actor state for a `windowKey`
- `ping`: optional liveness message
- `ack`: success response to `hello`, `ping`, or accepted control messages
- `error`: validation or role mismatch errors

## Snapshot Shape

`SceneSnapshot` contains:

- `version`: protocol schema version
- `timestamp`: Unix epoch milliseconds
- `baseX` / `baseY`: world-space origin for the tile window
- `plane`: RuneScape plane for the snapshot
- `tiles`: sampled terrain heights, normalized to compact board-scale units, plus optional surface metadata (`rgb`, `texture`, overlay/underlay ids, shape, render level, bridge flag, and optional modeled vertices/faces for shaped tiles)
- `actors`: player and NPC markers
- `objects`: coarse object proxies

The shared validation schema lives in `src/schema.ts`.

## Live Transport

The live plugin path uses the split domain messages instead of `scene_snapshot`.

- `windowKey` is `${plane}:${baseX}:${baseY}`
- `terrain_snapshot` carries `version`, `timestamp`, `windowKey`, `baseX`, `baseY`, `plane`, and `tiles`
- `objects_snapshot` carries `version`, `timestamp`, `windowKey`, and `objects`
- `actors_frame` carries `version`, `timestamp`, `windowKey`, and `actors`

Actor and object transport messages should reference extracted geometry through
`modelKey` and send the actual geometry separately via `actor_model_batch` and
`object_model_batch`.
