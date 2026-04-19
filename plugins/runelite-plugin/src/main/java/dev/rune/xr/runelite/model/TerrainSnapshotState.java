package dev.rune.xr.runelite.model;

import java.util.List;

public record TerrainSnapshotState(
    int version,
    String windowKey,
    int baseX,
    int baseY,
    int plane,
    List<TilePayload> tiles
)
{
    public static TerrainSnapshotState fromSnapshot(TerrainSnapshotPayload snapshot)
    {
        return new TerrainSnapshotState(
            snapshot.version(),
            snapshot.windowKey(),
            snapshot.baseX(),
            snapshot.baseY(),
            snapshot.plane(),
            snapshot.tiles()
        );
    }
}
