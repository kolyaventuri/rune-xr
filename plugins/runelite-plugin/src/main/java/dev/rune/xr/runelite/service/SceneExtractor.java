package dev.rune.xr.runelite.service;

import dev.rune.xr.runelite.model.ActorPayload;
import dev.rune.xr.runelite.model.ProtocolMessages;
import dev.rune.xr.runelite.model.SceneObjectPayload;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.model.TilePayload;
import dev.rune.xr.runelite.model.TileSurfaceFacePayload;
import dev.rune.xr.runelite.model.TileSurfaceModelPayload;
import dev.rune.xr.runelite.model.TileSurfacePayload;
import dev.rune.xr.runelite.model.TileSurfaceVertexPayload;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import net.runelite.api.Actor;
import net.runelite.api.Client;
import net.runelite.api.DecorativeObject;
import net.runelite.api.GameObject;
import net.runelite.api.GroundObject;
import net.runelite.api.JagexColor;
import net.runelite.api.NPC;
import net.runelite.api.ObjectComposition;
import net.runelite.api.Player;
import net.runelite.api.Scene;
import net.runelite.api.SceneTileModel;
import net.runelite.api.SceneTilePaint;
import net.runelite.api.Tile;
import net.runelite.api.TileObject;
import net.runelite.api.WallObject;
import net.runelite.api.coords.WorldPoint;

public final class SceneExtractor
{
    static final int HEIGHT_UNIT_SCALE = 8;
    static final int LOCAL_TILE_SIZE = 128;

    private final Client client;
    private final Map<Integer, Integer> textureColorCache = new HashMap<>();

    public SceneExtractor(Client client)
    {
        this.client = client;
    }

    public Optional<SceneSnapshotPayload> extract(int radius)
    {
        Player localPlayer = client.getLocalPlayer();

        if (localPlayer == null)
        {
            return Optional.empty();
        }

        WorldPoint origin = localPlayer.getWorldLocation();
        int plane = client.getPlane();
        int baseX = origin.getX() - radius;
        int baseY = origin.getY() - radius;
        List<TilePayload> tiles = collectTiles(baseX, baseY, radius, plane);
        List<ActorPayload> actors = collectActors(origin, radius, plane);
        List<SceneObjectPayload> objects = collectObjects(origin, radius, plane);

        return Optional.of(new SceneSnapshotPayload(
            ProtocolMessages.VERSION,
            System.currentTimeMillis(),
            baseX,
            baseY,
            plane,
            tiles,
            actors,
            objects
        ));
    }

    private List<TilePayload> collectTiles(int baseX, int baseY, int radius, int plane)
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
                int renderLevel = tile == null ? plane : tile.getRenderLevel();
                int rawHeight = heights[renderLevel][sceneX][sceneY];
                TileSurfacePayload surface = tile == null ? null : extractTileSurface(scene, tile, sceneX, sceneY);

                tiles.add(new TilePayload(worldX, worldY, plane, normalizeTileHeight(rawHeight), surface));
            }
        }

        return tiles;
    }

    private List<ActorPayload> collectActors(WorldPoint origin, int radius, int plane)
    {
        List<ActorPayload> actors = new ArrayList<>();
        Player localPlayer = client.getLocalPlayer();

        if (localPlayer != null)
        {
            addActorPayload(actors, localPlayer, "self", plane, true);
        }

        for (Player player : client.getPlayers())
        {
            if (player == null || player == localPlayer || !withinRadius(origin, player.getWorldLocation(), radius))
            {
                continue;
            }

            addActorPayload(actors, player, "player", plane, true);
        }

        for (NPC npc : client.getNpcs())
        {
            if (npc == null || !withinRadius(origin, npc.getWorldLocation(), radius))
            {
                continue;
            }

            addActorPayload(actors, npc, "npc", plane, false);
        }

        return actors;
    }

    private List<SceneObjectPayload> collectObjects(WorldPoint origin, int radius, int plane)
    {
        List<SceneObjectPayload> objects = new ArrayList<>();
        Scene scene = client.getScene();
        Tile[][][] sceneTiles = scene.getTiles();
        Tile[][] planeTiles = sceneTiles[plane];

        for (Tile[] row : planeTiles)
        {
            for (Tile tile : row)
            {
                if (tile == null)
                {
                    continue;
                }

                WorldPoint point = WorldPoint.fromLocalInstance(client, tile.getLocalLocation());

                if (!withinRadius(origin, point, radius))
                {
                    continue;
                }

                appendTileObjects(objects, tile, plane);
            }
        }

        return objects;
    }

    private void appendTileObjects(List<SceneObjectPayload> objects, Tile tile, int plane)
    {
        WallObject wall = tile.getWallObject();
        DecorativeObject decor = tile.getDecorativeObject();
        GroundObject ground = tile.getGroundObject();

        if (wall != null)
        {
            objects.add(buildWallPayload(wall, plane));
        }

        if (decor != null)
        {
            objects.add(buildTileObjectPayload("decor", decor, plane, 0, null, null));
        }

        if (ground != null)
        {
            objects.add(buildTileObjectPayload("ground", ground, plane, 0, null, null));
        }

        int gameIndex = 0;
        for (GameObject gameObject : tile.getGameObjects())
        {
            if (gameObject == null)
            {
                continue;
            }

            objects.add(buildGameObjectPayload(gameObject, plane, gameIndex));
            gameIndex += 1;
        }
    }

    private SceneObjectPayload buildWallPayload(WallObject wall, int plane)
    {
        Integer wallOrientationA = normalizeWallOrientation(wall.getOrientationA());
        Integer wallOrientationB = normalizeWallOrientation(wall.getOrientationB());
        return buildTileObjectPayload("wall", wall, plane, 0, wallOrientationA, wallOrientationB);
    }

    private SceneObjectPayload buildGameObjectPayload(GameObject gameObject, int plane, int gameIndex)
    {
        ObjectComposition composition = resolveObjectComposition(gameObject.getId());
        WorldPoint point = gameObject.getWorldLocation();
        return new SceneObjectPayload(
            buildInstanceId("game", gameObject, point, plane, gameIndex),
            "game",
            resolveObjectName("Game object", composition),
            point.getX(),
            point.getY(),
            plane,
            gameObject.sizeX(),
            gameObject.sizeY(),
            normalizeGameObjectRotationDegrees(gameObject.getOrientation()),
            null,
            null
        );
    }

    private SceneObjectPayload buildTileObjectPayload(
        String kind,
        TileObject object,
        int plane,
        int variantIndex,
        Integer wallOrientationA,
        Integer wallOrientationB
    )
    {
        ObjectComposition composition = resolveObjectComposition(object.getId());
        WorldPoint point = object.getWorldLocation();
        Integer sizeX = composition == null ? null : composition.getSizeX();
        Integer sizeY = composition == null ? null : composition.getSizeY();

        return new SceneObjectPayload(
            buildInstanceId(kind, object, point, plane, variantIndex),
            kind,
            resolveObjectName(defaultObjectName(kind), composition),
            point.getX(),
            point.getY(),
            plane,
            normalizePositiveSize(sizeX),
            normalizePositiveSize(sizeY),
            null,
            wallOrientationA,
            wallOrientationB
        );
    }

    private String buildInstanceId(String kind, TileObject object, WorldPoint point, int plane, int variantIndex)
    {
        return kind
            + "_"
            + object.getId()
            + "_"
            + point.getX()
            + "_"
            + point.getY()
            + "_"
            + plane
            + "_"
            + variantIndex
            + "_"
            + Long.toUnsignedString(object.getHash());
    }

    private ObjectComposition resolveObjectComposition(int objectId)
    {
        ObjectComposition composition = client.getObjectDefinition(objectId);

        if (composition == null)
        {
            return null;
        }

        if (composition.getImpostorIds() == null)
        {
            return composition;
        }

        ObjectComposition impostor = composition.getImpostor();
        return impostor == null ? composition : impostor;
    }

    private String resolveObjectName(String fallback, ObjectComposition composition)
    {
        if (composition == null)
        {
            return fallback;
        }

        String name = composition.getName();
        if (name == null || name.isBlank() || "null".equalsIgnoreCase(name))
        {
            return fallback;
        }

        return name;
    }

    private String defaultObjectName(String kind)
    {
        return switch (kind)
        {
            case "wall" -> "Wall object";
            case "decor" -> "Decorative object";
            case "ground" -> "Ground object";
            default -> "Game object";
        };
    }

    static Integer normalizeGameObjectRotationDegrees(int orientation)
    {
        return normalizeQuarterTurnDegrees(Math.round((float) orientation / 512F));
    }

    static Integer normalizeQuarterTurnDegrees(int quarterTurns)
    {
        int normalized = Math.floorMod(quarterTurns, 4);
        return switch (normalized)
        {
            case 0 -> 0;
            case 1 -> 90;
            case 2 -> 180;
            default -> 270;
        };
    }

    static Integer normalizeWallOrientation(int orientation)
    {
        int normalized = orientation & 0xff;
        return normalized == 0 ? null : normalized;
    }

    private static Integer normalizePositiveSize(Integer size)
    {
        if (size == null || size <= 0)
        {
            return null;
        }

        return size;
    }

    private void addActorPayload(List<ActorPayload> actors, Actor actor, String type, int plane, boolean preferName)
    {
        WorldPoint point = actor.getWorldLocation();
        String name = preferName ? actor.getName() : actor.getName() != null ? actor.getName() : "NPC";
        String actorId = buildActorId(actor, type, name);

        actors.add(new ActorPayload(actorId, type, name, point.getX(), point.getY(), plane));
    }

    private String buildActorId(Actor actor, String type, String name)
    {
        if (actor instanceof Player player)
        {
            return type + "_" + player.getId();
        }

        if (actor instanceof NPC npc)
        {
            return type + "_" + npc.getId() + "_" + npc.getIndex();
        }

        return type + "_" + sanitizeName(name);
    }

    private String sanitizeName(String name)
    {
        return name.toLowerCase().replaceAll("[^a-z0-9]+", "_");
    }

    private boolean withinRadius(WorldPoint origin, WorldPoint point, int radius)
    {
        if (point == null)
        {
            return false;
        }

        return Math.abs(point.getX() - origin.getX()) <= radius
            && Math.abs(point.getY() - origin.getY()) <= radius
            && point.getPlane() == origin.getPlane();
    }

    private boolean isSceneCoordinate(int value)
    {
        return value >= 0 && value < 104;
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

        short hsl = (short) packedHsl;
        double hue = (double) JagexColor.unpackHue(hsl) / JagexColor.HUE_MAX;
        double saturation = (double) JagexColor.unpackSaturation(hsl) / JagexColor.SATURATION_MAX;
        double luminance = (double) JagexColor.unpackLuminance(hsl) / JagexColor.LUMINANCE_MAX;
        double q = luminance < 0.5
            ? luminance * (1 + saturation)
            : luminance + saturation - luminance * saturation;
        double p = 2 * luminance - q;
        int red = channelToByte(hueToRgb(p, q, hue + (1.0 / 3.0)));
        int green = channelToByte(hueToRgb(p, q, hue));
        int blue = channelToByte(hueToRgb(p, q, hue - (1.0 / 3.0)));
        return (red << 16) | (green << 8) | blue;
    }

    private TileSurfacePayload extractTileSurface(Scene scene, Tile tile, int sceneX, int sceneY)
    {
        Tile surfaceTile = tile;
        SceneTilePaint paint = surfaceTile.getSceneTilePaint();
        SceneTileModel model = surfaceTile.getSceneTileModel();
        Integer texture = paint == null ? firstModelTexture(model) : normalizeTexture(paint.getTexture());
        Integer rgb = paint == null ? resolveModelRgb(texture, model) : normalizeRgb(paint.getRBG());
        byte[][][] tileShapes = scene.getTileShapes();
        short[][][] overlayIds = scene.getOverlayIds();
        short[][][] underlayIds = scene.getUnderlayIds();
        int plane = surfaceTile.getPlane();
        Integer shape = model == null ? Byte.toUnsignedInt(tileShapes[plane][sceneX][sceneY]) : model.getShape();
        TileSurfaceModelPayload surfaceModel = extractSurfaceModel(model, sceneX, sceneY);

        return new TileSurfacePayload(
            rgb,
            texture,
            normalizeId(overlayIds[plane][sceneX][sceneY]),
            normalizeId(underlayIds[plane][sceneX][sceneY]),
            shape,
            surfaceTile.getRenderLevel(),
            tile.getBridge() != null,
            surfaceModel
        );
    }

    private static int channelToByte(double value)
    {
        return Math.max(0, Math.min(255, (int) Math.round(value * 255)));
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

            Integer faceTexture = valueAt(triangleTextureId, index, SceneExtractor::normalizeTexture);
            faces.add(new TileSurfaceFacePayload(
                a,
                b,
                c,
                faceTexture == null ? averagePackedFaceColor(triangleColorA, triangleColorB, triangleColorC, index) : null,
                faceTexture
            ));
        }

        return faces.isEmpty() ? null : new TileSurfaceModelPayload(vertices, faces);
    }

    private static double hueToRgb(double p, double q, double t)
    {
        double hue = t;

        if (hue < 0)
        {
            hue += 1;
        }

        if (hue > 1)
        {
            hue -= 1;
        }

        if (hue < (1.0 / 6.0))
        {
            return p + (q - p) * 6 * hue;
        }

        if (hue < 0.5)
        {
            return q;
        }

        if (hue < (2.0 / 3.0))
        {
            return p + (q - p) * ((2.0 / 3.0) - hue) * 6;
        }

        return p;
    }

    private static Integer averagePackedFaceColor(int[] triangleColorA, int[] triangleColorB, int[] triangleColorC, int index)
    {
        long[] totals = new long[3];
        int sampleCount = 0;

        sampleCount += accumulatePackedFaceColor(valueAt(triangleColorA, index), totals);
        sampleCount += accumulatePackedFaceColor(valueAt(triangleColorB, index), totals);
        sampleCount += accumulatePackedFaceColor(valueAt(triangleColorC, index), totals);

        if (sampleCount == 0)
        {
            return null;
        }

        int red = Math.toIntExact(totals[0] / sampleCount);
        int green = Math.toIntExact(totals[1] / sampleCount);
        int blue = Math.toIntExact(totals[2] / sampleCount);
        return (red << 16) | (green << 8) | blue;
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

    private static Integer normalizeTexture(int texture)
    {
        return texture < 0 ? null : texture;
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
}
