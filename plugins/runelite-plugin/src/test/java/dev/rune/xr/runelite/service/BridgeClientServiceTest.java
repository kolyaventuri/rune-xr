package dev.rune.xr.runelite.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.Gson;
import dev.rune.xr.runelite.model.ProtocolMessages;
import dev.rune.xr.runelite.model.SceneObjectPayload;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.model.TilePayload;
import dev.rune.xr.runelite.model.TileSurfaceFacePayload;
import dev.rune.xr.runelite.model.TileSurfaceModelPayload;
import dev.rune.xr.runelite.model.TileSurfacePayload;
import dev.rune.xr.runelite.model.TileSurfaceVertexPayload;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class BridgeClientServiceTest
{
    private final Gson gson = new Gson();

    @Test
    void keepsFullSnapshotWhenItFitsTransportBudget()
    {
        SceneSnapshotPayload snapshot = createSnapshot(null, null);
        BridgeClientService.PreparedSnapshot preparedSnapshot = BridgeClientService.prepareSnapshotPayload(gson, snapshot, 8_192L);

        assertEquals(BridgeClientService.SnapshotVariant.FULL, preparedSnapshot.variant());
        assertSame(snapshot, preparedSnapshot.snapshot());
        assertTrue(preparedSnapshot.payloadBytes() <= 8_192L);
    }

    @Test
    void stripsObjectModelsBeforeTileModels()
    {
        TileSurfaceModelPayload tileModel = createModel(8);
        TileSurfaceModelPayload objectModel = createModel(48);
        SceneSnapshotPayload snapshot = createSnapshot(tileModel, objectModel);
        SceneSnapshotPayload withoutObjectModels = createSnapshot(tileModel, null);
        long objectOnlyBudget = payloadBytes(withoutObjectModels) + 32L;

        BridgeClientService.PreparedSnapshot preparedSnapshot =
            BridgeClientService.prepareSnapshotPayload(gson, snapshot, objectOnlyBudget);

        assertTrue(payloadBytes(snapshot) > objectOnlyBudget);
        assertTrue(preparedSnapshot.payloadBytes() <= objectOnlyBudget);
        assertEquals(BridgeClientService.SnapshotVariant.WITHOUT_OBJECT_MODELS, preparedSnapshot.variant());
        assertNull(preparedSnapshot.snapshot().objects().get(0).model());
        assertNotNull(preparedSnapshot.snapshot().tiles().get(0).surface());
        assertNotNull(preparedSnapshot.snapshot().tiles().get(0).surface().model());
    }

    @Test
    void stripsTileModelsWhenObjectStrippingIsNotEnough()
    {
        TileSurfaceModelPayload tileModel = createModel(32);
        TileSurfaceModelPayload objectModel = createModel(48);
        SceneSnapshotPayload snapshot = createSnapshot(tileModel, objectModel);
        SceneSnapshotPayload withoutAnyModels = createSnapshot(null, null);
        long flattenedBudget = payloadBytes(withoutAnyModels) + 32L;

        BridgeClientService.PreparedSnapshot preparedSnapshot =
            BridgeClientService.prepareSnapshotPayload(gson, snapshot, flattenedBudget);

        assertTrue(payloadBytes(snapshot) > flattenedBudget);
        assertTrue(preparedSnapshot.payloadBytes() <= flattenedBudget);
        assertEquals(BridgeClientService.SnapshotVariant.WITHOUT_TILE_AND_OBJECT_MODELS, preparedSnapshot.variant());
        assertNull(preparedSnapshot.snapshot().objects().get(0).model());
        assertNotNull(preparedSnapshot.snapshot().tiles().get(0).surface());
        assertNull(preparedSnapshot.snapshot().tiles().get(0).surface().model());
    }

    private long payloadBytes(SceneSnapshotPayload snapshot)
    {
        String payload = gson.toJson(ProtocolMessages.SceneSnapshotMessage.fromSnapshot(snapshot));
        return payload.getBytes(StandardCharsets.UTF_8).length;
    }

    private static SceneSnapshotPayload createSnapshot(TileSurfaceModelPayload tileModel, TileSurfaceModelPayload objectModel)
    {
        TileSurfacePayload surface = new TileSurfacePayload(
            0x445566,
            12,
            3,
            4,
            1,
            0,
            true,
            24,
            tileModel
        );
        TilePayload tile = new TilePayload(3200, 3200, 0, 16, surface);
        SceneObjectPayload object = new SceneObjectPayload(
            "game_1",
            "game",
            "Large chest",
            3200,
            3201,
            0,
            1,
            1,
            90,
            null,
            null,
            null,
            objectModel
        );

        return new SceneSnapshotPayload(
            1,
            123L,
            3199,
            3199,
            0,
            List.of(tile),
            List.of(),
            List.of(object)
        );
    }

    private static TileSurfaceModelPayload createModel(int faceCount)
    {
        List<TileSurfaceVertexPayload> vertices = new ArrayList<>(faceCount * 3);
        List<TileSurfaceFacePayload> faces = new ArrayList<>(faceCount);

        for (int faceIndex = 0; faceIndex < faceCount; faceIndex += 1)
        {
            int vertexBase = vertices.size();
            vertices.add(new TileSurfaceVertexPayload((faceIndex * 7) % 128, faceIndex, (faceIndex * 11) % 128));
            vertices.add(new TileSurfaceVertexPayload((faceIndex * 7 + 32) % 128, faceIndex + 2, (faceIndex * 11 + 16) % 128));
            vertices.add(new TileSurfaceVertexPayload((faceIndex * 7 + 64) % 128, faceIndex + 4, (faceIndex * 11 + 32) % 128));
            faces.add(new TileSurfaceFacePayload(
                vertexBase,
                vertexBase + 1,
                vertexBase + 2,
                0x665544,
                0x112233,
                0x334455,
                0x556677,
                faceIndex % 4,
                0.0f,
                0.0f,
                1.0f,
                0.0f,
                0.0f,
                1.0f
            ));
        }

        return new TileSurfaceModelPayload(List.copyOf(vertices), List.copyOf(faces));
    }
}
