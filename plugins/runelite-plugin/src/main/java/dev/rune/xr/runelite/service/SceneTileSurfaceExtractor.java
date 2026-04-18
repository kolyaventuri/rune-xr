package dev.rune.xr.runelite.service;

import dev.rune.xr.runelite.model.TextureDefinitionPayload;
import dev.rune.xr.runelite.model.TilePayload;
import dev.rune.xr.runelite.model.TileSurfaceFacePayload;
import dev.rune.xr.runelite.model.TileSurfaceModelPayload;
import dev.rune.xr.runelite.model.TileSurfacePayload;
import dev.rune.xr.runelite.model.TileSurfaceVertexPayload;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import javax.imageio.ImageIO;
import net.runelite.api.Client;
import net.runelite.api.Scene;
import net.runelite.api.SceneTileModel;
import net.runelite.api.SceneTilePaint;
import net.runelite.api.Texture;
import net.runelite.api.TextureProvider;
import net.runelite.api.Tile;

final class SceneTileSurfaceExtractor
{
    static final int HEIGHT_UNIT_SCALE = 8;
    static final int LOCAL_TILE_SIZE = 128;
    private static final int TEXTURE_SIZE = 128;

    private final Client client;
    private final Map<Integer, Integer> textureColorCache;

    SceneTileSurfaceExtractor(Client client, Map<Integer, Integer> textureColorCache)
    {
        this.client = client;
        this.textureColorCache = textureColorCache;
    }

    List<TilePayload> collectTiles(int baseX, int baseY, int radius, int plane)
    {
        List<TilePayload> tiles = new ArrayList<>();
        Scene scene = client.getScene();
        Tile[][] planeTiles = scene.getTiles()[plane];
        int sceneBaseX = client.getBaseX();
        int sceneBaseY = client.getBaseY();
        int[][][] heights = client.getTileHeights();
        int limit = radius * 2;

        for (int offsetX = 0; offsetX <= limit; offsetX++)
        {
            for (int offsetY = 0; offsetY <= limit; offsetY++)
            {
                int worldX = baseX + offsetX;
                int worldY = baseY + offsetY;
                int sceneX = worldX - sceneBaseX;
                int sceneY = worldY - sceneBaseY;

                if (!isSceneCoordinate(sceneX) || !isSceneCoordinate(sceneY))
                {
                    continue;
                }

                Tile tile = planeTiles[sceneX][sceneY];
                int rawHeight = heights[plane][sceneX][sceneY];
                TileSurfacePayload surface = tile == null ? null : extractTileSurface(scene, tile, sceneX, sceneY, heights);

                tiles.add(new TilePayload(worldX, worldY, plane, normalizeTileHeight(rawHeight), surface));
            }
        }

        return tiles;
    }

    List<TextureDefinitionPayload> extractTextureDefinitions(Iterable<Integer> textureIds)
    {
        TextureProvider textureProvider = client.getTextureProvider();

        if (textureProvider == null)
        {
            return List.of();
        }

        Texture[] textures = textureProvider.getTextures();

        if (textures == null || textures.length == 0)
        {
            return List.of();
        }

        double brightness = textureProvider.getBrightness();
        List<TextureDefinitionPayload> definitions = new ArrayList<>();

        try
        {
            textureProvider.setBrightness(1.0d);

            for (Integer textureIdValue : textureIds)
            {
                if (textureIdValue == null)
                {
                    continue;
                }

                int textureId = textureIdValue;

                if (textureId < 0 || textureId >= textures.length)
                {
                    continue;
                }

                Texture texture = textures[textureId];

                if (texture == null)
                {
                    continue;
                }

                int[] pixels = textureProvider.load(textureId);

                if (pixels == null || pixels.length != TEXTURE_SIZE * TEXTURE_SIZE)
                {
                    continue;
                }

                String pngBase64 = encodeTexturePng(pixels, TEXTURE_SIZE, TEXTURE_SIZE);

                if (pngBase64 == null)
                {
                    continue;
                }

                definitions.add(new TextureDefinitionPayload(
                    textureId,
                    TEXTURE_SIZE,
                    TEXTURE_SIZE,
                    pngBase64,
                    normalizePositive(texture.getAnimationDirection()),
                    normalizePositive(texture.getAnimationSpeed())
                ));
            }
        }
        finally
        {
            textureProvider.setBrightness(brightness);
        }

        return definitions;
    }

    private TileSurfacePayload extractTileSurface(Scene scene, Tile tile, int sceneX, int sceneY, int[][][] heights)
    {
        SceneTilePaint paint = tile.getSceneTilePaint();
        SceneTileModel model = tile.getSceneTileModel();
        Integer texture = paint == null ? firstModelTexture(model) : normalizeTexture(paint.getTexture());
        Integer rgb = paint == null ? resolveModelRgb(texture, model) : normalizeRgb(paint.getRBG());
        byte[][][] tileShapes = scene.getTileShapes();
        short[][][] overlayIds = scene.getOverlayIds();
        short[][][] underlayIds = scene.getUnderlayIds();
        int plane = tile.getPlane();
        Integer shape = model == null ? Byte.toUnsignedInt(tileShapes[plane][sceneX][sceneY]) : model.getShape();
        TileSurfaceModelPayload surfaceModel = extractSurfaceModel(model, sceneX, sceneY);
        boolean hasBridge = tile.getBridge() != null;

        return new TileSurfacePayload(
            rgb,
            texture,
            normalizeId(overlayIds[plane][sceneX][sceneY]),
            normalizeId(underlayIds[plane][sceneX][sceneY]),
            shape,
            tile.getRenderLevel(),
            hasBridge,
            resolveBridgeHeight(tile, sceneX, sceneY, heights),
            surfaceModel
        );
    }

    private Integer resolveModelRgb(Integer texture, SceneTileModel model)
    {
        if (texture != null)
        {
            Integer textureRgb = textureColorCache.computeIfAbsent(texture, this::resolveTextureRgb);
            if (textureRgb != null)
            {
                return textureRgb;
            }
        }

        return averageModelRgb(model);
    }

    private Integer resolveTextureRgb(int textureId)
    {
        if (client.getTextureProvider() == null)
        {
            return null;
        }

        return averageTextureRgb(client.getTextureProvider().load(textureId));
    }

    static int normalizeTileHeight(int rawHeight)
    {
        return Math.round((float) -rawHeight / HEIGHT_UNIT_SCALE);
    }

    static Integer averageModelRgb(SceneTileModel model)
    {
        if (model == null)
        {
            return null;
        }

        long[] totals = new long[3];
        int sampleCount = 0;

        sampleCount += accumulateTriangleColors(model.getTriangleColorA(), totals);
        sampleCount += accumulateTriangleColors(model.getTriangleColorB(), totals);
        sampleCount += accumulateTriangleColors(model.getTriangleColorC(), totals);

        if (sampleCount == 0)
        {
            return null;
        }

        int red = Math.toIntExact(totals[0] / sampleCount);
        int green = Math.toIntExact(totals[1] / sampleCount);
        int blue = Math.toIntExact(totals[2] / sampleCount);
        return (red << 16) | (green << 8) | blue;
    }

    static Integer packedHslToRgb(int packedHsl)
    {
        if (packedHsl < 0 || packedHsl > 0xffff)
        {
            return null;
        }

        double hue = ((packedHsl >> 10) & 63) / 64.0d + 0.0078125d;
        double saturation = ((packedHsl >> 7) & 7) / 8.0d + 0.0625d;
        double luminance = (packedHsl & 127) / 128.0d;
        double red = luminance;
        double green = luminance;
        double blue = luminance;
        double blended;

        if (luminance < 0.5d)
        {
            blended = luminance * (1.0d + saturation);
        }
        else
        {
            blended = luminance + saturation - luminance * saturation;
        }

        double base = 2.0d * luminance - blended;
        double shiftedRedHue = hue + (1.0d / 3.0d);

        if (shiftedRedHue > 1.0d)
        {
            shiftedRedHue -= 1.0d;
        }

        double shiftedBlueHue = hue - (1.0d / 3.0d);

        if (shiftedBlueHue < 0.0d)
        {
            shiftedBlueHue += 1.0d;
        }

        if (6.0d * shiftedRedHue < 1.0d)
        {
            red = base + (blended - base) * 6.0d * shiftedRedHue;
        }
        else if (2.0d * shiftedRedHue < 1.0d)
        {
            red = blended;
        }
        else if (3.0d * shiftedRedHue < 2.0d)
        {
            red = base + (blended - base) * ((2.0d / 3.0d) - shiftedRedHue) * 6.0d;
        }
        else
        {
            red = base;
        }

        if (6.0d * hue < 1.0d)
        {
            green = base + (blended - base) * 6.0d * hue;
        }
        else if (2.0d * hue < 1.0d)
        {
            green = blended;
        }
        else if (3.0d * hue < 2.0d)
        {
            green = base + (blended - base) * ((2.0d / 3.0d) - hue) * 6.0d;
        }
        else
        {
            green = base;
        }

        if (6.0d * shiftedBlueHue < 1.0d)
        {
            blue = base + (blended - base) * 6.0d * shiftedBlueHue;
        }
        else if (2.0d * shiftedBlueHue < 1.0d)
        {
            blue = blended;
        }
        else if (3.0d * shiftedBlueHue < 2.0d)
        {
            blue = base + (blended - base) * ((2.0d / 3.0d) - shiftedBlueHue) * 6.0d;
        }
        else
        {
            blue = base;
        }

        int redByte = channelToByte(red);
        int greenByte = channelToByte(green);
        int blueByte = channelToByte(blue);
        return (redByte << 16) | (greenByte << 8) | blueByte;
    }

    static Integer resolveBridgeHeight(Tile tile, int sceneX, int sceneY, int[][][] heights)
    {
        if (tile == null || tile.getBridge() == null)
        {
            return null;
        }

        int renderLevel = tile.getRenderLevel();

        if (renderLevel < 0 || renderLevel >= heights.length)
        {
            return null;
        }

        return normalizeTileHeight(heights[renderLevel][sceneX][sceneY]);
    }

    static Integer averageTextureRgb(int[] pixels)
    {
        if (pixels == null || pixels.length == 0)
        {
            return null;
        }

        long redTotal = 0;
        long greenTotal = 0;
        long blueTotal = 0;

        for (int pixel : pixels)
        {
            int rgb = pixel & 0xffffff;
            redTotal += (rgb >> 16) & 0xff;
            greenTotal += (rgb >> 8) & 0xff;
            blueTotal += rgb & 0xff;
        }

        int red = Math.toIntExact(redTotal / pixels.length);
        int green = Math.toIntExact(greenTotal / pixels.length);
        int blue = Math.toIntExact(blueTotal / pixels.length);
        return (red << 16) | (green << 8) | blue;
    }

    static Integer firstModelTexture(SceneTileModel model)
    {
        if (model == null)
        {
            return null;
        }

        int[] triangleTextureIds = model.getTriangleTextureId();

        if (triangleTextureIds == null)
        {
            return null;
        }

        for (int texture : triangleTextureIds)
        {
            Integer normalizedTexture = normalizeTexture(texture);
            if (normalizedTexture != null)
            {
                return normalizedTexture;
            }
        }

        return null;
    }

    static TileSurfaceModelPayload extractSurfaceModel(SceneTileModel model, int sceneX, int sceneY)
    {
        if (model == null)
        {
            return null;
        }

        int[] vertexX = model.getVertexX();
        int[] vertexY = model.getVertexY();
        int[] vertexZ = model.getVertexZ();
        int[] faceX = model.getFaceX();
        int[] faceY = model.getFaceY();
        int[] faceZ = model.getFaceZ();

        if (vertexX == null || vertexY == null || vertexZ == null || faceX == null || faceY == null || faceZ == null)
        {
            return null;
        }

        int vertexCount = Math.min(vertexX.length, Math.min(vertexY.length, vertexZ.length));
        int faceCount = Math.min(faceX.length, Math.min(faceY.length, faceZ.length));

        if (vertexCount == 0 || faceCount == 0)
        {
            return null;
        }

        int tileOriginX = sceneX * LOCAL_TILE_SIZE;
        int tileOriginZ = sceneY * LOCAL_TILE_SIZE;
        List<TileSurfaceVertexPayload> vertices = new ArrayList<>(vertexCount);

        for (int index = 0; index < vertexCount; index += 1)
        {
            vertices.add(new TileSurfaceVertexPayload(
                vertexX[index] - tileOriginX,
                normalizeTileHeight(vertexY[index]),
                vertexZ[index] - tileOriginZ
            ));
        }

        int[] triangleColorA = model.getTriangleColorA();
        int[] triangleColorB = model.getTriangleColorB();
        int[] triangleColorC = model.getTriangleColorC();
        int[] triangleTextureId = model.getTriangleTextureId();
        List<TileSurfaceFacePayload> faces = new ArrayList<>(faceCount);

        for (int index = 0; index < faceCount; index += 1)
        {
            int a = faceX[index];
            int b = faceY[index];
            int c = faceZ[index];

            if (a < 0 || b < 0 || c < 0 || a >= vertexCount || b >= vertexCount || c >= vertexCount)
            {
                continue;
            }

            Integer faceTexture = valueAt(triangleTextureId, index, SceneTileSurfaceExtractor::normalizeTexture);
            Integer rgbA = packedFaceColorToRgb(valueAt(triangleColorA, index));
            Integer rgbB = packedFaceColorToRgb(valueAt(triangleColorB, index));
            Integer rgbC = packedFaceColorToRgb(valueAt(triangleColorC, index));
            faces.add(new TileSurfaceFacePayload(
                a,
                b,
                c,
                faceTexture == null ? averagePackedFaceColor(triangleColorA, triangleColorB, triangleColorC, index) : null,
                rgbA,
                rgbB,
                rgbC,
                faceTexture,
                null,
                null,
                null,
                null,
                null,
                null
            ));
        }

        return faces.isEmpty() ? null : new TileSurfaceModelPayload(vertices, faces);
    }

    static String encodeTexturePng(int[] pixels, int width, int height)
    {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);

        for (int y = 0; y < height; y += 1)
        {
            for (int x = 0; x < width; x += 1)
            {
                int rgb = pixels[(y * width) + x] & 0xffffff;
                int argb = rgb == 0 ? 0 : 0xff000000 | rgb;
                image.setRGB(x, y, argb);
            }
        }

        try (ByteArrayOutputStream output = new ByteArrayOutputStream())
        {
            if (!ImageIO.write(image, "png", output))
            {
                return null;
            }

            return Base64.getEncoder().encodeToString(output.toByteArray());
        }
        catch (IOException exception)
        {
            return null;
        }
    }

    static Integer normalizeTexture(int texture)
    {
        return texture < 0 ? null : texture;
    }

    private static int channelToByte(double value)
    {
        return Math.max(0, Math.min(255, (int) Math.round(value * 255)));
    }

    private static Integer averagePackedFaceColor(int[] triangleColorA, int[] triangleColorB, int[] triangleColorC, int index)
    {
        return averagePackedFaceColor(valueAt(triangleColorA, index), valueAt(triangleColorB, index), valueAt(triangleColorC, index));
    }

    private static Integer averagePackedFaceColor(Integer colorA, Integer colorB, Integer colorC)
    {
        long[] totals = new long[3];
        int sampleCount = 0;

        sampleCount += accumulatePackedFaceColor(colorA, totals);
        sampleCount += accumulatePackedFaceColor(colorB, totals);
        sampleCount += accumulatePackedFaceColor(colorC, totals);

        if (sampleCount == 0)
        {
            return null;
        }

        int red = Math.toIntExact(totals[0] / sampleCount);
        int green = Math.toIntExact(totals[1] / sampleCount);
        int blue = Math.toIntExact(totals[2] / sampleCount);
        return (red << 16) | (green << 8) | blue;
    }

    private static Integer packedFaceColorToRgb(Integer packedColor)
    {
        return packedColor == null ? null : packedHslToRgb(packedColor);
    }

    private static int accumulateTriangleColors(int[] triangleColors, long[] totals)
    {
        if (triangleColors == null)
        {
            return 0;
        }

        int sampleCount = 0;

        for (int color : triangleColors)
        {
            Integer rgb = packedHslToRgb(color);
            if (rgb == null)
            {
                continue;
            }

            totals[0] += (rgb >> 16) & 0xff;
            totals[1] += (rgb >> 8) & 0xff;
            totals[2] += rgb & 0xff;
            sampleCount += 1;
        }

        return sampleCount;
    }

    private static int accumulatePackedFaceColor(Integer packedColor, long[] totals)
    {
        if (packedColor == null)
        {
            return 0;
        }

        Integer rgb = packedHslToRgb(packedColor);
        if (rgb == null)
        {
            return 0;
        }

        totals[0] += (rgb >> 16) & 0xff;
        totals[1] += (rgb >> 8) & 0xff;
        totals[2] += rgb & 0xff;
        return 1;
    }

    private static Integer valueAt(int[] values, int index)
    {
        if (values == null || index < 0 || index >= values.length)
        {
            return null;
        }

        return values[index];
    }

    private static Integer valueAt(int[] values, int index, java.util.function.IntFunction<Integer> transform)
    {
        Integer value = valueAt(values, index);
        return value == null ? null : transform.apply(value);
    }

    private static Integer normalizeId(short id)
    {
        return id <= 0 ? null : Short.toUnsignedInt(id);
    }

    private static Integer normalizeRgb(int rgb)
    {
        return rgb < 0 || rgb > 0xffffff ? null : rgb;
    }

    private static Integer normalizePositive(int value)
    {
        return value > 0 ? value : null;
    }

    private static boolean isSceneCoordinate(int value)
    {
        return value >= 0 && value < 104;
    }
}
