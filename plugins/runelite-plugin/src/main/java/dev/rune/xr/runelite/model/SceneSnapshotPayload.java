package dev.rune.xr.runelite.model;

import java.util.List;

public record SceneSnapshotPayload(
    int version,
    long timestamp,
    int baseX,
    int baseY,
    int plane,
    List<TilePayload> tiles,
    List<ActorPayload> actors,
    List<SceneObjectPayload> objects
)
{
}

