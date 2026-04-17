package dev.rune.xr.runelite.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Proxy;
import net.runelite.api.Model;
import net.runelite.api.Renderable;
import net.runelite.api.SceneTileModel;
import net.runelite.api.Tile;
import dev.rune.xr.runelite.model.TileSurfaceModelPayload;
import org.junit.jupiter.api.Test;

class SceneExtractorTest
{
    @Test
    void normalizesRuneLiteTileHeightsToBoardScale()
    {
        assertEquals(-10, SceneExtractor.normalizeTileHeight(80));
        assertEquals(-30, SceneExtractor.normalizeTileHeight(240));
        assertEquals(30, SceneExtractor.normalizeTileHeight(-240));
    }

    @Test
    void convertsPackedHslColorsToRgb()
    {
        assertEquals(0x000000, SceneExtractor.packedHslToRgb(0));
        Integer rgb = SceneExtractor.packedHslToRgb(959);

        assertNotNull(rgb);
        assertTrue(((rgb >> 16) & 0xff) > ((rgb >> 8) & 0xff));
        assertTrue(((rgb >> 16) & 0xff) > (rgb & 0xff));
    }

    @Test
    void ignoresOutOfRangePackedHslValues()
    {
        assertEquals(null, SceneExtractor.packedHslToRgb(-1));
        assertEquals(null, SceneExtractor.packedHslToRgb(12345678));
    }

    @Test
    void normalizesObjectRotationToQuarterTurns()
    {
        assertEquals(0, SceneExtractor.normalizeGameObjectRotationDegrees(0));
        assertEquals(90, SceneExtractor.normalizeGameObjectRotationDegrees(512));
        assertEquals(180, SceneExtractor.normalizeGameObjectRotationDegrees(1024));
        assertEquals(270, SceneExtractor.normalizeGameObjectRotationDegrees(1536));
    }

    @Test
    void keepsOnlySupportedWallOrientationBits()
    {
        assertEquals(1, SceneExtractor.normalizeWallOrientation(1));
        assertEquals(8, SceneExtractor.normalizeWallOrientation(8));
        assertEquals(null, SceneExtractor.normalizeWallOrientation(0));
        assertEquals(255, SceneExtractor.normalizeWallOrientation(0x1ff));
    }

    @Test
    void ignoresObjectsWithoutRenderableGeometry()
    {
        Renderable renderable = (Renderable) Proxy.newProxyInstance(
            Renderable.class.getClassLoader(),
            new Class<?>[] {Renderable.class},
            (proxy, method, args) -> null
        );

        assertFalse(SceneExtractor.hasRenderable((Renderable) null));
        assertFalse(SceneExtractor.hasRenderable(null, null));
        assertTrue(SceneExtractor.hasRenderable(renderable));
        assertTrue(SceneExtractor.hasRenderable(null, renderable));
    }

    @Test
    void resolvesModelsFromGenericRenderableWrappers()
    {
        Model model = (Model) Proxy.newProxyInstance(
            Model.class.getClassLoader(),
            new Class<?>[] {Model.class},
            (proxy, method, args) -> null
        );
        Renderable renderable = (Renderable) Proxy.newProxyInstance(
            Renderable.class.getClassLoader(),
            new Class<?>[] {Renderable.class},
            (proxy, method, args) -> "getModel".equals(method.getName()) ? model : null
        );

        assertSame(model, SceneExtractor.resolveRenderableModel(renderable));
    }

    @Test
    void resolvesBridgeHeightFromRenderLevelHeights()
    {
        int[][][] heights = new int[4][104][104];
        heights[2][10][11] = -240;

        assertEquals(30, SceneExtractor.resolveBridgeHeight(tileWithBridgeAndRenderLevel(2), 10, 11, heights));
        assertNull(SceneExtractor.resolveBridgeHeight(tileWithRenderLevel(2), 10, 11, heights));
    }

    @Test
    void suppressesAnonymousObjectsWhenNoModelCanBeExtracted()
    {
        assertFalse(SceneExtractor.shouldEmitObjectPayload("wall", "Wall object", null));
        assertFalse(SceneExtractor.shouldEmitObjectPayload("game", "Game object", null));
        assertTrue(SceneExtractor.shouldEmitObjectPayload("game", "Rock", null));
    }

    @Test
    void averagesTexturePixelsIntoRepresentativeRgb()
    {
        assertEquals(0x3f007f, SceneExtractor.averageTextureRgb(new int[] {0x0000ff, 0x7f0000}));
        assertNull(SceneExtractor.averageTextureRgb(null));
    }

    @Test
    void toleratesSceneTileModelsWithNullFaceArrays()
    {
        SceneTileModel model = (SceneTileModel) Proxy.newProxyInstance(
            SceneTileModel.class.getClassLoader(),
            new Class<?>[] {SceneTileModel.class},
            (proxy, method, args) -> switch (method.getName())
            {
                case "getTriangleTextureId", "getTriangleColorA", "getTriangleColorB", "getTriangleColorC" -> null;
                case "isFlat" -> false;
                case "getShape", "getRotation", "getModelUnderlay", "getModelOverlay", "getBufferOffset",
                    "getUvBufferOffset", "getBufferLen" -> 0;
                default -> null;
            }
        );

        assertNull(SceneExtractor.firstModelTexture(model));
        assertNull(SceneExtractor.averageModelRgb(model));
        assertNull(SceneExtractor.extractSurfaceModel(model, 5, 6));
    }

    @Test
    void extractsLocalizedSceneTileModelGeometry()
    {
        SceneTileModel model = (SceneTileModel) Proxy.newProxyInstance(
            SceneTileModel.class.getClassLoader(),
            new Class<?>[] {SceneTileModel.class},
            (proxy, method, args) -> switch (method.getName())
            {
                case "getVertexX" -> new int[] {640, 768, 640};
                case "getVertexY" -> new int[] {-80, -80, -80};
                case "getVertexZ" -> new int[] {768, 768, 896};
                case "getFaceX" -> new int[] {0};
                case "getFaceY" -> new int[] {1};
                case "getFaceZ" -> new int[] {2};
                case "getTriangleColorA", "getTriangleColorB", "getTriangleColorC" -> new int[] {959};
                case "getTriangleTextureId" -> new int[] {0};
                case "isFlat" -> false;
                case "getShape", "getRotation", "getModelUnderlay", "getModelOverlay", "getBufferOffset",
                    "getUvBufferOffset", "getBufferLen" -> 0;
                default -> null;
            }
        );

        TileSurfaceModelPayload payload = SceneExtractor.extractSurfaceModel(model, 5, 6);

        assertNotNull(payload);
        assertEquals(3, payload.vertices().size());
        assertEquals(0, payload.vertices().get(0).x());
        assertEquals(10, payload.vertices().get(0).y());
        assertEquals(0, payload.vertices().get(0).z());
        assertEquals(1, payload.faces().size());
        assertEquals(0, payload.faces().get(0).a());
        assertEquals(1, payload.faces().get(0).b());
        assertEquals(2, payload.faces().get(0).c());
        assertNull(payload.faces().get(0).rgb());
        assertEquals(SceneExtractor.packedHslToRgb(959), payload.faces().get(0).rgbA());
        assertEquals(SceneExtractor.packedHslToRgb(959), payload.faces().get(0).rgbB());
        assertEquals(SceneExtractor.packedHslToRgb(959), payload.faces().get(0).rgbC());
        assertEquals(0, payload.faces().get(0).texture());
    }

    private static Tile tileWithRenderLevel(int renderLevel)
    {
        return (Tile) Proxy.newProxyInstance(
            Tile.class.getClassLoader(),
            new Class<?>[] {Tile.class},
            (proxy, method, args) -> switch (method.getName())
            {
                case "getRenderLevel", "getPlane" -> renderLevel;
                default -> null;
            }
        );
    }

    private static Tile tileWithBridgeAndRenderLevel(int renderLevel)
    {
        Tile bridge = (Tile) Proxy.newProxyInstance(
            Tile.class.getClassLoader(),
            new Class<?>[] {Tile.class},
            (proxy, method, args) -> null
        );

        return (Tile) Proxy.newProxyInstance(
            Tile.class.getClassLoader(),
            new Class<?>[] {Tile.class},
            (proxy, method, args) -> switch (method.getName())
            {
                case "getRenderLevel", "getPlane" -> renderLevel;
                case "getBridge" -> bridge;
                default -> null;
            }
        );
    }
}
