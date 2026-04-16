package dev.rune.xr.runelite.model;

import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.Gson;
import dev.rune.xr.runelite.service.SyntheticSceneFactory;
import org.junit.jupiter.api.Test;

class PayloadSerializationTest
{
    private final Gson gson = new Gson();

    @Test
    void serializesSyntheticSnapshot()
    {
        SyntheticSceneFactory factory = new SyntheticSceneFactory();
        SceneSnapshotPayload snapshot = factory.nextSnapshot(4);
        String json = gson.toJson(ProtocolMessages.SceneSnapshotMessage.fromSnapshot(snapshot));

        assertTrue(json.contains("\"kind\":\"scene_snapshot\""));
        assertTrue(json.contains("\"tiles\""));
        assertTrue(json.contains("\"actors\""));
    }
}
