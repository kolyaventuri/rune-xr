package dev.rune.xr.runelite.model;

import java.util.List;

public record ObjectsSnapshotState(
    int version,
    String windowKey,
    List<SceneObjectPayload> objects
)
{
    public static ObjectsSnapshotState fromSnapshot(ObjectsSnapshotPayload snapshot)
    {
        return new ObjectsSnapshotState(
            snapshot.version(),
            snapshot.windowKey(),
            snapshot.objects()
        );
    }
}
