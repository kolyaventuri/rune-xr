package dev.rune.xr.runelite;

import static org.junit.jupiter.api.Assertions.assertEquals;

import dev.rune.xr.runelite.model.SceneObjectPayload;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.model.TilePayload;
import dev.rune.xr.runelite.model.TileSurfaceFacePayload;
import dev.rune.xr.runelite.model.TileSurfaceModelPayload;
import dev.rune.xr.runelite.model.TileSurfacePayload;
import dev.rune.xr.runelite.model.TileSurfaceVertexPayload;
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
}
