package dev.rune.xr.runelite.model;

import java.util.List;

public record ObjectsSnapshotPayload(
    int version,
    long timestamp,
    String windowKey,
    List<SceneObjectPayload> objects
)
{
}
