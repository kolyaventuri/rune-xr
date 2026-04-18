package dev.rune.xr.runelite.model;

import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.Gson;
import java.util.List;
import org.junit.jupiter.api.Test;

class PayloadSerializationTest
{
    private final Gson gson = new Gson();

    @Test
    void serializesSceneSnapshot()
    {
        SceneSnapshotPayload snapshot = new SceneSnapshotPayload(
            ProtocolMessages.VERSION,
            1L,
            3200,
            3200,
            0,
            List.of(new TilePayload(3200, 3200, 0, 0, null)),
            List.of(new ActorPayload("self", "self", "Kolya", 3200, 3200, 0, 3200.5, 3200.5, 180, 1, null, null)),
            List.of(new SceneObjectPayload("tree", "game", "Tree", 3200, 3201, 0, 1, 1, null, null, null, null, null))
        );
        String json = gson.toJson(ProtocolMessages.SceneSnapshotMessage.fromSnapshot(snapshot));

        assertTrue(json.contains("\"kind\":\"scene_snapshot\""));
        assertTrue(json.contains("\"tiles\""));
        assertTrue(json.contains("\"actors\""));
    }

    @Test
    void serializesTextureBatch()
    {
        TextureBatchPayload batch = new TextureBatchPayload(List.of(
            new TextureDefinitionPayload(12, 128, 128, "Zm9v", 1, 2)
        ));
        String json = gson.toJson(ProtocolMessages.TextureBatchMessage.fromTextures(batch));

        assertTrue(json.contains("\"kind\":\"texture_batch\""));
        assertTrue(json.contains("\"textures\":[{"));
        assertTrue(!json.contains("\"textures\":{\"textures\""));
        assertTrue(json.contains("\"pngBase64\":\"Zm9v\""));
    }

    @Test
    void serializesActorModelBatch()
    {
        ActorModelBatchPayload batch = new ActorModelBatchPayload(List.of(
            new ActorModelDefinitionPayload(
                "actor-model:test",
                new TileSurfaceModelPayload(
                    List.of(
                        new TileSurfaceVertexPayload(-16, 0, -8),
                        new TileSurfaceVertexPayload(16, 0, -8),
                        new TileSurfaceVertexPayload(0, 64, 12)
                    ),
                    List.of(
                        new TileSurfaceFacePayload(0, 1, 2, 0x4478c8, null, null, null, null, null, null, null, null, null, null)
                    )
                )
            )
        ));
        String json = gson.toJson(ProtocolMessages.ActorModelBatchMessage.fromModels(batch));

        assertTrue(json.contains("\"kind\":\"actor_model_batch\""));
        assertTrue(json.contains("\"models\":[{"));
        assertTrue(!json.contains("\"models\":{\"models\""));
    }
}
