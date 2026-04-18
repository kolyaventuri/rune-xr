# Rune XR

Rune XR is a monorepo for a RuneLite-to-WebXR tabletop prototype:

- `packages/protocol`: shared wire types, validation, and fixtures
- `apps/bridge`: Node bridge that accepts plugin snapshots, broadcasts them to clients, and serves the built frontend
- `apps/webxr-client`: Three.js + WebXR client for desktop preview and Quest AR
- `plugins/runelite-plugin`: local RuneLite plugin scaffold for live snapshot extraction

## Prerequisites

- Node.js 24+
- `pnpm` 10+
- JDK 17+ for the RuneLite plugin
- RuneLite locally installed for manual plugin verification
- Meta Quest on the same LAN as the development machine for AR testing

## Quick Start

In separate terminals:

```bash
pnpm install
pnpm dev:bridge
pnpm dev:web
pnpm dev:runelite
```

Then:

1. Enable the `Rune XR` plugin in the developer RuneLite client.
2. Open the Vite URL on your desktop browser to inspect the board renderer.
3. Open the same client URL on Quest Browser over LAN.
4. Use `Enter AR` to place the board on a surface once the bridge is receiving live snapshots.

Notes:

- `pnpm dev:runelite` runs the plugin tests, rebuilds the plugin jar, and then launches a developer RuneLite client with the plugin preloaded.
- If the bridge logs `http://0.0.0.0:8787`, that is a bind address, not the client URL. Local senders and browsers on the same machine should still connect to `ws://127.0.0.1:8787/ws` or `http://127.0.0.1:8787`.

## Workspace Commands

```bash
pnpm lint
pnpm test
pnpm build
```

## RuneLite Plugin Notes

The plugin project lives under `plugins/runelite-plugin`.

- `./gradlew test` is the current Java verification entrypoint
- bridge defaults are `127.0.0.1:8787`

For the full Java setup and the current status of RuneLite dev loading, see
[plugins/runelite-plugin/README.md](plugins/runelite-plugin/README.md).
