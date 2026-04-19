package dev.rune.xr.runelite;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.google.gson.Gson;
import dev.rune.xr.runelite.config.RuneXrConfig;
import dev.rune.xr.runelite.model.ActorModelBatchPayload;
import dev.rune.xr.runelite.model.ActorPayload;
import dev.rune.xr.runelite.model.ActorsFramePayload;
import dev.rune.xr.runelite.model.ObjectModelBatchPayload;
import dev.rune.xr.runelite.model.ObjectsSnapshotPayload;
import dev.rune.xr.runelite.model.ProtocolMessages;
import dev.rune.xr.runelite.model.SceneObjectPayload;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.model.TerrainSnapshotPayload;
import dev.rune.xr.runelite.model.TextureBatchPayload;
import dev.rune.xr.runelite.model.TilePayload;
import dev.rune.xr.runelite.model.TileSurfaceFacePayload;
import dev.rune.xr.runelite.model.TileSurfaceModelPayload;
import dev.rune.xr.runelite.model.TileSurfaceVertexPayload;
import dev.rune.xr.runelite.service.BridgeClientService;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class SnapshotPublisherTest
{
    private final Gson gson = new Gson();
    private final RuneXrConfig config = new RuneXrConfig() {};

    @Test
    void emitsActorsFrameOnlyForActorMovement()
    {
        RecordingBridgeClientService bridgeClient = new RecordingBridgeClientService(gson);
        SnapshotPublisher publisher = new SnapshotPublisher(gson, config, bridgeClient, textureIds -> List.of(), snapshot -> {});
        SceneSnapshotPayload first = createSnapshot(3200, 3200, 3200.5, 3200, 0);
        SceneSnapshotPayload second = createSnapshot(3200, 3200, 3200.75, 3200, 1);

        publisher.publish(first);
        bridgeClient.clearEvents();

        publisher.publish(second);

        assertEquals(List.of("actors_frame"), bridgeClient.events());
    }

    @Test
    void emitsObjectsSnapshotOnlyForObjectChanges()
    {
        RecordingBridgeClientService bridgeClient = new RecordingBridgeClientService(gson);
        SnapshotPublisher publisher = new SnapshotPublisher(gson, config, bridgeClient, textureIds -> List.of(), snapshot -> {});
        SceneSnapshotPayload first = createSnapshot(3200, 3200, 3200.5, 3200, 0);
        SceneSnapshotPayload second = new SceneSnapshotPayload(
            first.version(),
            first.timestamp() + 1,
            first.baseX(),
            first.baseY(),
            first.plane(),
            first.tiles(),
            first.actors(),
            List.of(new SceneObjectPayload(
                "wall_1",
                "wall",
                "Wall",
                3200,
                3200,
                0,
                1,
                1,
                90,
                1,
                2,
                null,
                createModel()
            ))
        );

        publisher.publish(first);
        bridgeClient.clearEvents();

        publisher.publish(second);

        assertEquals(List.of("objects_snapshot"), bridgeClient.events());
    }

    @Test
    void emitsTerrainObjectsAndActorsWhenWindowChanges()
    {
        RecordingBridgeClientService bridgeClient = new RecordingBridgeClientService(gson);
        SnapshotPublisher publisher = new SnapshotPublisher(gson, config, bridgeClient, textureIds -> List.of(), snapshot -> {});
        SceneSnapshotPayload first = createSnapshot(3200, 3200, 3200.5, 3200, 0);
        SceneSnapshotPayload second = createSnapshot(3201, 3200, 3201.5, 3200, 1);

        publisher.publish(first);
        bridgeClient.clearEvents();

        publisher.publish(second);

        assertEquals(List.of("terrain_snapshot", "objects_snapshot", "actors_frame"), bridgeClient.events());
    }

    @Test
    void stripsInlineActorAndObjectModelsFromSteadyStateDomainMessages()
    {
        RecordingBridgeClientService bridgeClient = new RecordingBridgeClientService(gson);
        SnapshotPublisher publisher = new SnapshotPublisher(gson, config, bridgeClient, textureIds -> List.of(), snapshot -> {});

        publisher.publish(createSnapshot(3200, 3200, 3200.5, 3200, 0));

        TerrainSnapshotPayload terrainSnapshot = bridgeClient.lastTerrainSnapshot();
        ObjectsSnapshotPayload objectsSnapshot = bridgeClient.lastObjectsSnapshot();
        ActorsFramePayload actorsFrame = bridgeClient.lastActorsFrame();

        assertNotNull(terrainSnapshot);
        assertNotNull(objectsSnapshot);
        assertNotNull(actorsFrame);
        assertNull(objectsSnapshot.objects().get(0).model());
        assertNotNull(objectsSnapshot.objects().get(0).modelKey());
        assertNull(actorsFrame.actors().get(0).model());
        assertNotNull(actorsFrame.actors().get(0).modelKey());
    }

    private static SceneSnapshotPayload createSnapshot(int baseX, int baseY, double preciseX, int actorX, long timestampOffset)
    {
        return new SceneSnapshotPayload(
            ProtocolMessages.VERSION,
            1L + timestampOffset,
            baseX,
            baseY,
            0,
            List.of(new TilePayload(baseX, baseY, 0, 0, null)),
            List.of(new ActorPayload(
                "self_1",
                "self",
                "Kolya",
                actorX,
                baseY,
                0,
                preciseX,
                (double) baseY + 0.5,
                180,
                1,
                null,
                createModel()
            )),
            List.of(new SceneObjectPayload(
                "wall_1",
                "wall",
                "Wall",
                baseX,
                baseY,
                0,
                1,
                1,
                90,
                1,
                null,
                null,
                createModel()
            ))
        );
    }

    private static TileSurfaceModelPayload createModel()
    {
        return new TileSurfaceModelPayload(
            List.of(
                new TileSurfaceVertexPayload(0, 0, 0),
                new TileSurfaceVertexPayload(128, 0, 0),
                new TileSurfaceVertexPayload(0, 128, 0)
            ),
            List.of(
                new TileSurfaceFacePayload(0, 1, 2, 0x778899, null, null, null, null, null, null, null, null, null, null)
            )
        );
    }

    private static final class RecordingBridgeClientService extends BridgeClientService
    {
        private final List<String> events = new ArrayList<>();
        private TerrainSnapshotPayload lastTerrainSnapshot;
        private ObjectsSnapshotPayload lastObjectsSnapshot;
        private ActorsFramePayload lastActorsFrame;

        private RecordingBridgeClientService(Gson gson)
        {
            super(gson);
        }

        @Override
        public synchronized boolean isConnected(RuneXrConfig config)
        {
            return true;
        }

        @Override
        public synchronized boolean sendActorModelBatch(RuneXrConfig config, ActorModelBatchPayload models)
        {
            events.add("actor_model_batch");
            return true;
        }

        @Override
        public synchronized boolean sendObjectModelBatch(RuneXrConfig config, ObjectModelBatchPayload models)
        {
            events.add("object_model_batch");
            return true;
        }

        @Override
        public synchronized boolean sendTextureBatch(RuneXrConfig config, TextureBatchPayload textures)
        {
            events.add("texture_batch");
            return true;
        }

        @Override
        public synchronized TerrainSnapshotPayload sendTerrainSnapshot(RuneXrConfig config, TerrainSnapshotPayload snapshot)
        {
            events.add("terrain_snapshot");
            lastTerrainSnapshot = snapshot;
            return snapshot;
        }

        @Override
        public synchronized boolean sendObjectsSnapshot(RuneXrConfig config, ObjectsSnapshotPayload snapshot)
        {
            events.add("objects_snapshot");
            lastObjectsSnapshot = snapshot;
            return true;
        }

        @Override
        public synchronized boolean sendActorsFrame(RuneXrConfig config, ActorsFramePayload frame)
        {
            events.add("actors_frame");
            lastActorsFrame = frame;
            return true;
        }

        private List<String> events()
        {
            return List.copyOf(events);
        }

        private void clearEvents()
        {
            events.clear();
        }

        private TerrainSnapshotPayload lastTerrainSnapshot()
        {
            return lastTerrainSnapshot;
        }

        private ObjectsSnapshotPayload lastObjectsSnapshot()
        {
            return lastObjectsSnapshot;
        }

        private ActorsFramePayload lastActorsFrame()
        {
            return lastActorsFrame;
        }
    }
}
