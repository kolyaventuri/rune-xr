# Rune XR RuneLite Plugin

This subproject contains the RuneLite-side plugin that publishes scene
snapshots into the Rune XR bridge.

## What It Does

- connects to the bridge WebSocket at `ws://<bridgeHost>:<bridgePort>/ws`
- sends live extracted scene snapshots
- samples a configurable square around the local player
- pushes snapshots on the RuneLite client thread at the configured interval

## Prerequisites

- JDK 17+
- RuneLite installed locally
- `pnpm` workspace dependencies installed at the repo root

The Gradle wrapper is committed in this repo, so after Java is installed you do
not need a global `gradle` install for normal use.

## Setup

From the repo root:

```bash
pnpm install
pnpm dev:bridge
```

Optionally start the WebXR client in another terminal:

```bash
pnpm dev:web
```

Then use the plugin module from `plugins/runelite-plugin`.

## Local Development RuneLite

Launch a developer RuneLite client with the plugin preloaded:

```bash
cd plugins/runelite-plugin
./gradlew run
```

That task boots RuneLite with
`--developer-mode --debug --insecure-write-credentials`, loads
[`RuneXrPlugin`](/Users/kolya/dev/rune-xr/plugins/runelite-plugin/src/main/java/dev/rune/xr/runelite/RuneXrPlugin.java:1)
via
[`RuneXrPluginTest`](/Users/kolya/dev/rune-xr/plugins/runelite-plugin/src/test/java/dev/rune/xr/runelite/RuneXrPluginTest.java:1),
and uses the local project classes directly.

For dev runs, the Gradle task uses an isolated RuneLite home under:

- `build/runelite-dev-home/.runelite`

That keeps the development launch from loading the already-sideloaded jar in
your normal `~/.runelite/sideloaded-plugins` directory. When
`~/.runelite/credentials.properties` exists, the run task copies it into the
isolated dev home before launch so Jagex Launcher token-based login continues
to work. Set `RUNELITE_DEV_HOME` if you want a different dev home location.

If you want the dev launch to use your normal RuneLite profile directly, point
`RUNELITE_DEV_HOME` at your real home directory:

```bash
RUNELITE_DEV_HOME="$HOME" ./gradlew run
```

Recommended first run:

1. launch the bridge first
2. start the developer RuneLite client
3. log into RuneLite and enable `Rune XR`
4. confirm the bridge receives live snapshots

## Sideloading Into RuneLite

Build the plugin jar:

```bash
cd plugins/runelite-plugin
./gradlew jar
```

The sideloadable jar is written to:

- `build/libs/runelite-plugin-0.1.0.jar`

To copy it into RuneLite's sideload directory automatically:

```bash
./gradlew installSideloadPlugin
```

By default that copies the jar to:

- `~/.runelite/sideloaded-plugins`

You can override the destination by setting `RUNELITE_SIDELOAD_DIR`.

## Verification

Run the module tests:

```bash
cd plugins/runelite-plugin
./gradlew test
```

This verifies the Java toolchain, RuneLite dependency resolution, and payload
serialization.

## Runtime Defaults

The plugin config lives in
[`RuneXrConfig.java`](/Users/kolya/dev/rune-xr/plugins/runelite-plugin/src/main/java/dev/rune/xr/runelite/config/RuneXrConfig.java:1).
Default values are:

- `bridgeHost`: `127.0.0.1`
- `bridgePort`: `8787`
- `tileRadius`: `12`
- `updateRateMs`: `200`

Those defaults assume RuneLite and the bridge are running on the same machine.
If you move the bridge to another laptop or desktop on the LAN, change
`bridgeHost` to that machine's IP.

## Runtime Notes

The plugin samples live tile heights, nearby players and NPCs, and coarse
scene objects from the active RuneLite scene. While the plugin is running,
bridge host/port changes reconnect live, update rate changes reschedule the
snapshot loop, and failed sends no longer suppress future retries for unchanged
snapshots.

## References

The current dev-loading expectations above are based on RuneLite's official
Plugin Hub docs and example plugin template:

- [Plugin Hub README](https://github.com/runelite/plugin-hub#creating-new-plugins)
- [RuneLite example plugin](https://github.com/runelite/example-plugin)
