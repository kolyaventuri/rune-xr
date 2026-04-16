# Rune XR Protocol

The bridge, browser client, and RuneLite plugin communicate over JSON messages.

## Envelope

- `hello`: identifies a connection as `plugin` or `client`
- `scene_snapshot`: delivers the latest visible scene state
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
