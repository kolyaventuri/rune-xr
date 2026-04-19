package dev.rune.xr.runelite.model;

import java.util.List;

public record TerrainSnapshotPayload(
    int version,
    long timestamp,
    String windowKey,
    int baseX,
    int baseY,
    int plane,
    List<TilePayload> tiles
)
{
}
