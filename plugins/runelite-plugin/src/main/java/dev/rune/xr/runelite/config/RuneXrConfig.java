package dev.rune.xr.runelite.config;

import net.runelite.client.config.Config;
import net.runelite.client.config.ConfigGroup;
import net.runelite.client.config.ConfigItem;

@ConfigGroup("runexr")
public interface RuneXrConfig extends Config
{
    @ConfigItem(
        keyName = "bridgeHost",
        name = "Bridge host",
        description = "Hostname or IP for the Rune XR bridge"
    )
    default String bridgeHost()
    {
        return "127.0.0.1";
    }

    @ConfigItem(
        keyName = "bridgePort",
        name = "Bridge port",
        description = "WebSocket port for the Rune XR bridge"
    )
    default int bridgePort()
    {
        return 8787;
    }

    @ConfigItem(
        keyName = "tileRadius",
        name = "Tile radius",
        description = "World-space radius sampled around the local player"
    )
    default int tileRadius()
    {
        return 12;
    }

    @ConfigItem(
        keyName = "updateRateMs",
        name = "Update rate (ms)",
        description = "How frequently the plugin pushes snapshots"
    )
    default int updateRateMs()
    {
        return 200;
    }

    @ConfigItem(
        keyName = "coordinateDumpEnabled",
        name = "Coordinate dump",
        description = "Write live self actor coordinate dumps to a JSONL file for debugging"
    )
    default boolean coordinateDumpEnabled()
    {
        return true;
    }

    @ConfigItem(
        keyName = "coordinateDumpPath",
        name = "Coordinate dump path",
        description = "File path used for live coordinate dumps"
    )
    default String coordinateDumpPath()
    {
        return "/tmp/rune-xr-coordinate-dump.jsonl";
    }
}
