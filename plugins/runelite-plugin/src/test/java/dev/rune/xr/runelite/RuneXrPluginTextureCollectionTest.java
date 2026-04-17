package dev.rune.xr.runelite;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import dev.rune.xr.runelite.model.ObjectModelDefinitionPayload;
import dev.rune.xr.runelite.model.SceneObjectPayload;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.model.TilePayload;
import dev.rune.xr.runelite.model.TileSurfaceFacePayload;
import dev.rune.xr.runelite.model.TileSurfaceModelPayload;
import dev.rune.xr.runelite.model.TileSurfacePayload;
import dev.rune.xr.runelite.model.TileSurfaceVertexPayload;
import dev.rune.xr.runelite.model.TextureDefinitionPayload;
import java.util.LinkedHashSet;
import java.util.List;
import org.junit.jupiter.api.Test;

class RuneXrPluginTextureCollectionTest
{
    @Test
    void collectsTextureIdsFromTerrainAndObjectModels()
    {
        SceneSnapshotPayload snapshot = new SceneSnapshotPayload(
            1,
            100L,
            3200,
            3200,
            0,
            List.of(
                new TilePayload(
                    3200,
                    3200,
                    0,
                    0,
                    new TileSurfacePayload(
                        null,
                        12,
                        null,
                        null,
                        null,
                        null,
                        false,
                        null,
                        new TileSurfaceModelPayload(
                            List.of(
                                new TileSurfaceVertexPayload(0, 0, 0),
                                new TileSurfaceVertexPayload(128, 0, 0),
                                new TileSurfaceVertexPayload(0, 0, 128)
                            ),
                            List.of(
                                new TileSurfaceFacePayload(0, 1, 2, null, null, null, null, 13, null, null, null, null, null, null)
                            )
                        )
                    )
                )
            ),
            List.of(),
            List.of(
                new SceneObjectPayload(
                    "wall_1",
                    "wall",
                    "Castle wall",
                    3200,
                    3200,
                    0,
                    1,
                    1,
                    null,
                    1,
                    null,
                    null,
                    new TileSurfaceModelPayload(
                        List.of(
                            new TileSurfaceVertexPayload(0, 0, 0),
                            new TileSurfaceVertexPayload(128, 0, 0),
                            new TileSurfaceVertexPayload(0, 128, 0)
                        ),
                        List.of(
                            new TileSurfaceFacePayload(0, 1, 2, null, null, null, null, 28, 0f, 0f, 1f, 0f, 0f, 1f)
                        )
                    )
                )
            )
        );

        LinkedHashSet<Integer> textureIds = RuneXrPlugin.collectTextureIds(snapshot);

        assertEquals(new LinkedHashSet<>(List.of(12, 13, 28)), textureIds);
    }

    @Test
    void partitionsTextureDefinitionsIntoSmallerBatches()
    {
        List<TextureDefinitionPayload> definitions = List.of(
            new TextureDefinitionPayload(1, 128, 128, "A".repeat(140_000), null, null),
            new TextureDefinitionPayload(2, 128, 128, "B".repeat(140_000), null, null),
            new TextureDefinitionPayload(3, 128, 128, "C".repeat(20_000), null, null)
        );

        List<List<TextureDefinitionPayload>> batches = RuneXrPlugin.partitionTextureDefinitions(definitions);

        assertEquals(2, batches.size());
        assertEquals(List.of(definitions.get(0)), batches.get(0));
        assertEquals(List.of(definitions.get(1), definitions.get(2)), batches.get(1));
    }

    @Test
    void splitsObjectModelsIntoReusableDefinitions()
    {
        TileSurfaceModelPayload sharedModel = new TileSurfaceModelPayload(
            List.of(
                new TileSurfaceVertexPayload(0, 0, 0),
                new TileSurfaceVertexPayload(128, 0, 0),
                new TileSurfaceVertexPayload(0, 128, 0)
            ),
            List.of(
                new TileSurfaceFacePayload(0, 1, 2, null, null, null, null, 28, 0f, 0f, 1f, 0f, 0f, 1f)
            )
        );
        SceneSnapshotPayload snapshot = new SceneSnapshotPayload(
            1,
            100L,
            3200,
            3200,
            0,
            List.of(new TilePayload(3200, 3200, 0, 0, null)),
            List.of(),
            List.of(
                new SceneObjectPayload("wall_1", "wall", "Castle wall", 3200, 3200, 0, 1, 1, null, 1, null, null, sharedModel),
                new SceneObjectPayload("wall_2", "wall", "Castle wall", 3201, 3200, 0, 1, 1, null, 1, null, null, sharedModel)
            )
        );

        var transportBundle = RuneXrPlugin.splitObjectModels(snapshot);

        assertEquals(1, transportBundle.modelDefinitions().size());
        ObjectModelDefinitionPayload definition = transportBundle.modelDefinitions().get(0);
        assertNotNull(definition.key());
        assertEquals(sharedModel, definition.model());
        assertEquals(definition.key(), transportBundle.snapshot().objects().get(0).modelKey());
        assertEquals(definition.key(), transportBundle.snapshot().objects().get(1).modelKey());
        assertNull(transportBundle.snapshot().objects().get(0).model());
        assertNull(transportBundle.snapshot().objects().get(1).model());
    }
}
