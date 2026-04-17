package dev.rune.xr.runelite.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import java.util.List;
import org.junit.jupiter.api.Test;

class SceneSnapshotStateTest
{
    @Test
    void ignoresTimestampWhenComparingSnapshots()
    {
        SceneSnapshotPayload first = new SceneSnapshotPayload(
            1,
            100L,
            3200,
            3200,
            0,
            List.of(new TilePayload(3200, 3200, 0, 0, null)),
            List.of(new ActorPayload("self", "self", "Kolya", 3200, 3200, 0)),
            List.of()
        );
        SceneSnapshotPayload second = new SceneSnapshotPayload(
            1,
            101L,
            3200,
            3200,
            0,
            List.of(new TilePayload(3200, 3200, 0, 0, null)),
            List.of(new ActorPayload("self", "self", "Kolya", 3200, 3200, 0)),
            List.of()
        );

        assertEquals(SceneSnapshotState.fromSnapshot(first), SceneSnapshotState.fromSnapshot(second));
    }

    @Test
    void detectsRealSceneChanges()
    {
        SceneSnapshotPayload first = new SceneSnapshotPayload(
            1,
            100L,
            3200,
            3200,
            0,
            List.of(new TilePayload(3200, 3200, 0, 0, null)),
            List.of(new ActorPayload("self", "self", "Kolya", 3200, 3200, 0)),
            List.of()
        );
        SceneSnapshotPayload second = new SceneSnapshotPayload(
            1,
            101L,
            3200,
            3200,
            0,
            List.of(new TilePayload(3200, 3200, 0, 0, null)),
            List.of(new ActorPayload("self", "self", "Kolya", 3201, 3200, 0)),
            List.of()
        );

        assertNotEquals(SceneSnapshotState.fromSnapshot(first), SceneSnapshotState.fromSnapshot(second));
    }
}
