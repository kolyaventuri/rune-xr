package dev.rune.xr.runelite.model;

import java.util.List;

public record SceneSnapshotState(
    int version,
    int baseX,
    int baseY,
    int plane,
    List<TilePayload> tiles,
    List<ActorPayload> actors,
    List<SceneObjectPayload> objects
)
{
    public static SceneSnapshotState fromSnapshot(SceneSnapshotPayload snapshot)
    {
        return new SceneSnapshotState(
            snapshot.version(),
            snapshot.baseX(),
            snapshot.baseY(),
            snapshot.plane(),
            snapshot.tiles(),
            snapshot.actors(),
            snapshot.objects()
        );
    }
}
