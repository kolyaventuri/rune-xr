package dev.rune.xr.runelite.model;

import java.util.List;

public final class ProtocolMessages
{
    public static final int VERSION = 1;

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
}
