package dev.rune.xr.runelite.model;

import java.util.List;

public final class ProtocolMessages
{
    public static final int VERSION = 2;

    private ProtocolMessages()
    {
    }

    public record HelloMessage(String kind, int protocolVersion, String role, String source)
    {
        public static HelloMessage plugin(String source)
        {
            return new HelloMessage("hello", VERSION, "plugin", source);
        }
    }

    public record SceneSnapshotMessage(String kind, SceneSnapshotPayload snapshot)
    {
        public static SceneSnapshotMessage fromSnapshot(SceneSnapshotPayload snapshot)
        {
            return new SceneSnapshotMessage("scene_snapshot", snapshot);
        }
    }

    public record TerrainSnapshotMessage(
        String kind,
        int version,
        long timestamp,
        String windowKey,
        int baseX,
        int baseY,
        int plane,
        List<TilePayload> tiles
    )
    {
        public static TerrainSnapshotMessage fromSnapshot(TerrainSnapshotPayload snapshot)
        {
            return new TerrainSnapshotMessage(
                "terrain_snapshot",
                snapshot.version(),
                snapshot.timestamp(),
                snapshot.windowKey(),
                snapshot.baseX(),
                snapshot.baseY(),
                snapshot.plane(),
                snapshot.tiles()
            );
        }
    }

    public record ObjectsSnapshotMessage(
        String kind,
        int version,
        long timestamp,
        String windowKey,
        List<SceneObjectPayload> objects
    )
    {
        public static ObjectsSnapshotMessage fromSnapshot(ObjectsSnapshotPayload snapshot)
        {
            return new ObjectsSnapshotMessage(
                "objects_snapshot",
                snapshot.version(),
                snapshot.timestamp(),
                snapshot.windowKey(),
                snapshot.objects()
            );
        }
    }

    public record ActorsFrameMessage(
        String kind,
        int version,
        long timestamp,
        String windowKey,
        List<ActorPayload> actors
    )
    {
        public static ActorsFrameMessage fromFrame(ActorsFramePayload frame)
        {
            return new ActorsFrameMessage(
                "actors_frame",
                frame.version(),
                frame.timestamp(),
                frame.windowKey(),
                frame.actors()
            );
        }
    }

    public record TextureBatchMessage(String kind, List<TextureDefinitionPayload> textures)
    {
        public static TextureBatchMessage fromTextures(TextureBatchPayload textures)
        {
            return new TextureBatchMessage("texture_batch", textures.textures());
        }
    }

    public record ObjectModelBatchMessage(String kind, List<ObjectModelDefinitionPayload> models)
    {
        public static ObjectModelBatchMessage fromModels(ObjectModelBatchPayload models)
        {
            return new ObjectModelBatchMessage("object_model_batch", models.models());
        }
    }

    public record ActorModelBatchMessage(String kind, List<ActorModelDefinitionPayload> models)
    {
        public static ActorModelBatchMessage fromModels(ActorModelBatchPayload models)
        {
            return new ActorModelBatchMessage("actor_model_batch", models.models());
        }
    }
}
