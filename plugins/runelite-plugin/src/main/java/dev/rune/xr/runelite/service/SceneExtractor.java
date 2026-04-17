package dev.rune.xr.runelite.service;

import dev.rune.xr.runelite.model.ActorPayload;
import dev.rune.xr.runelite.model.ProtocolMessages;
import dev.rune.xr.runelite.model.SceneObjectPayload;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.model.TilePayload;
import dev.rune.xr.runelite.model.TextureDefinitionPayload;
import dev.rune.xr.runelite.model.TileSurfaceFacePayload;
import dev.rune.xr.runelite.model.TileSurfaceModelPayload;
import dev.rune.xr.runelite.model.TileSurfacePayload;
import dev.rune.xr.runelite.model.TileSurfaceVertexPayload;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import net.runelite.api.Actor;
import net.runelite.api.Client;
import net.runelite.api.DecorativeObject;
import net.runelite.api.DynamicObject;
import net.runelite.api.GameObject;
import net.runelite.api.GroundObject;
import net.runelite.api.JagexColor;
import net.runelite.api.Model;
import net.runelite.api.NPC;
import net.runelite.api.ObjectComposition;
import net.runelite.api.Perspective;
import net.runelite.api.Player;
import net.runelite.api.Renderable;
import net.runelite.api.Scene;
import net.runelite.api.SceneTileModel;
import net.runelite.api.SceneTilePaint;
import net.runelite.api.Tile;
import net.runelite.api.TileObject;
import net.runelite.api.Texture;
import net.runelite.api.TextureProvider;
import net.runelite.api.WallObject;
import net.runelite.api.coords.LocalPoint;
import net.runelite.api.coords.WorldPoint;
import javax.imageio.ImageIO;

public final class SceneExtractor
{
    static final int HEIGHT_UNIT_SCALE = 8;
    static final int LOCAL_TILE_SIZE = 128;
    static final int HALF_TILE_SIZE = LOCAL_TILE_SIZE / 2;
    static final int TEXTURE_SIZE = 128;
    static final int MAX_CACHED_OBJECT_MODELS = 2048;

    private record RenderablePlacement(Renderable renderable, int orientation, int offsetX, int offsetY)
    {
    }

    private record FaceUvs(float uA, float vA, float uB, float vB, float uC, float vC)
    {
    }

    private record StaticObjectModelKey(long objectHash, int objectId, int x, int y, int plane)
    {
    }

    private final Client client;
    private final Map<Integer, Integer> textureColorCache = new HashMap<>();
    private final Map<StaticObjectModelKey, TileSurfaceModelPayload> objectModelCache = new LinkedHashMap<>(256, 0.75f, true)
    {
        @Override
        protected boolean removeEldestEntry(Map.Entry<StaticObjectModelKey, TileSurfaceModelPayload> eldest)
        {
            return size() > MAX_CACHED_OBJECT_MODELS;
        }
    };

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

    public List<TextureDefinitionPayload> extractTextureDefinitions(Iterable<Integer> textureIds)
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

            if (!gameObject.getSceneMinLocation().equals(tile.getSceneLocation()))
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
        return buildTileObjectPayload(
            "wall",
            wall,
            plane,
            0,
            wallOrientationA,
            wallOrientationB,
            extractObjectModel(wall, List.of(
                new RenderablePlacement(wall.getRenderable1(), 0, 0, 0),
                new RenderablePlacement(wall.getRenderable2(), 0, 0, 0)
            ))
        );
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
            null,
            extractObjectModel(gameObject, List.of(
                new RenderablePlacement(gameObject.getRenderable(), gameObject.getModelOrientation(), 0, 0)
            ))
        );
    }

    private SceneObjectPayload buildTileObjectPayload(
        String kind,
        TileObject object,
        int plane,
        int variantIndex,
        Integer wallOrientationA,
        Integer wallOrientationB,
        TileSurfaceModelPayload model
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
            wallOrientationB,
            model
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
        TileSurfaceModelPayload model;

        if (object instanceof DecorativeObject decorativeObject)
        {
            model = extractObjectModel(decorativeObject, List.of(
                new RenderablePlacement(decorativeObject.getRenderable(), 0, decorativeObject.getXOffset(), decorativeObject.getYOffset()),
                new RenderablePlacement(decorativeObject.getRenderable2(), 0, decorativeObject.getXOffset2(), decorativeObject.getYOffset2())
            ));
        }
        else if (object instanceof GroundObject groundObject)
        {
            model = extractObjectModel(groundObject, List.of(
                new RenderablePlacement(groundObject.getRenderable(), 0, 0, 0)
            ));
        }
        else
        {
            model = null;
        }

        return buildTileObjectPayload(kind, object, plane, variantIndex, wallOrientationA, wallOrientationB, model);
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

    private TileSurfaceModelPayload extractObjectModel(TileObject object, List<RenderablePlacement> placements)
    {
        if (placements.isEmpty())
        {
            return null;
        }

        StaticObjectModelKey cacheKey = createStaticObjectModelKey(object, placements);

        if (cacheKey != null)
        {
            TileSurfaceModelPayload cachedModel = objectModelCache.get(cacheKey);

            if (cachedModel != null)
            {
                return cachedModel;
            }
        }

        WorldPoint point = object.getWorldLocation();
        LocalPoint reference = LocalPoint.fromWorld(client, point);

        if (reference == null)
        {
            return null;
        }

        int referenceOriginX = reference.getX() - HALF_TILE_SIZE;
        int referenceOriginZ = reference.getY() - HALF_TILE_SIZE;
        List<TileSurfaceVertexPayload> vertices = new ArrayList<>();
        List<TileSurfaceFacePayload> faces = new ArrayList<>();

        for (RenderablePlacement placement : placements)
        {
            appendRenderableModel(object, placement, referenceOriginX, referenceOriginZ, vertices, faces);
        }

        TileSurfaceModelPayload model = faces.isEmpty() ? null : new TileSurfaceModelPayload(vertices, faces);

        if (cacheKey != null && model != null)
        {
            objectModelCache.put(cacheKey, model);
        }

        return model;
    }

    private static StaticObjectModelKey createStaticObjectModelKey(TileObject object, List<RenderablePlacement> placements)
    {
        for (RenderablePlacement placement : placements)
        {
            Renderable renderable = placement.renderable();

            if (renderable == null)
            {
                continue;
            }

            if (!(renderable instanceof Model) || renderable instanceof DynamicObject)
            {
                return null;
            }
        }

        WorldPoint point = object.getWorldLocation();

        if (point == null)
        {
            return null;
        }

        return new StaticObjectModelKey(
            object.getHash(),
            object.getId(),
            point.getX(),
            point.getY(),
            point.getPlane()
        );
    }

    private void appendRenderableModel(
        TileObject object,
        RenderablePlacement placement,
        int referenceOriginX,
        int referenceOriginZ,
        List<TileSurfaceVertexPayload> vertices,
        List<TileSurfaceFacePayload> faces
    )
    {
        Model model = resolveRenderableModel(placement.renderable());

        if (model == null)
        {
            return;
        }

        float[] vertexX = model.getVerticesX();
        float[] vertexY = model.getVerticesY();
        float[] vertexZ = model.getVerticesZ();
        int[] indices1 = model.getFaceIndices1();
        int[] indices2 = model.getFaceIndices2();
        int[] indices3 = model.getFaceIndices3();

        if (vertexX == null || vertexY == null || vertexZ == null || indices1 == null || indices2 == null || indices3 == null)
        {
            return;
        }

        int vertexCount = Math.min(vertexX.length, Math.min(vertexY.length, vertexZ.length));
        int faceCount = Math.min(indices1.length, Math.min(indices2.length, indices3.length));

        if (vertexCount == 0 || faceCount == 0)
        {
            return;
        }

        int vertexBase = vertices.size();
        int orientation = placement.orientation();
        int orientSin = orientation == 0 ? 0 : Perspective.SINE[orientation];
        int orientCos = orientation == 0 ? 0 : Perspective.COSINE[orientation];
        int worldLocalX = object.getX() + placement.offsetX();
        int worldLocalY = object.getZ();
        int worldLocalZ = object.getY() + placement.offsetY();

        for (int index = 0; index < vertexCount; index += 1)
        {
            int vx = Math.round(vertexX[index]);
            int vy = Math.round(vertexY[index]);
            int vz = Math.round(vertexZ[index]);

            if (orientation != 0)
            {
                int x0 = vx;
                vx = vz * orientSin + x0 * orientCos >> 16;
                vz = vz * orientCos - x0 * orientSin >> 16;
            }

            vertices.add(new TileSurfaceVertexPayload(
                worldLocalX + vx - referenceOriginX,
                normalizeTileHeight(worldLocalY + vy),
                worldLocalZ + vz - referenceOriginZ
            ));
        }

        int[] color1s = model.getFaceColors1();
        int[] color2s = model.getFaceColors2();
        int[] color3s = model.getFaceColors3();
        short[] faceTextures = model.getFaceTextures();

        for (int faceIndex = 0; faceIndex < faceCount; faceIndex += 1)
        {
            TileSurfaceFacePayload face = extractModelFace(model, color1s, color2s, color3s, faceTextures, faceIndex, vertexBase, vertexCount);

            if (face != null)
            {
                faces.add(face);
            }
        }
    }

    private Model resolveRenderableModel(Renderable renderable)
    {
        if (renderable == null)
        {
            return null;
        }

        if (renderable instanceof Model model)
        {
            return model;
        }

        if (renderable instanceof DynamicObject dynamicObject)
        {
            return dynamicObject.getModelZbuf();
        }

        return null;
    }

    private TileSurfaceFacePayload extractModelFace(
        Model model,
        int[] color1s,
        int[] color2s,
        int[] color3s,
        short[] faceTextures,
        int faceIndex,
        int vertexBase,
        int vertexCount
    )
    {
        int a = valueAt(model.getFaceIndices1(), faceIndex, -1);
        int b = valueAt(model.getFaceIndices2(), faceIndex, -1);
        int c = valueAt(model.getFaceIndices3(), faceIndex, -1);

        if (a < 0 || b < 0 || c < 0 || a >= vertexCount || b >= vertexCount || c >= vertexCount)
        {
            return null;
        }

        Integer color1 = valueAt(color1s, faceIndex);
        Integer color2 = valueAt(color2s, faceIndex);
        Integer color3 = valueAt(color3s, faceIndex);

        if (color3 != null && color3 == -2)
        {
            return null;
        }

        if (color3 != null && color3 == -1)
        {
            color2 = color1;
            color3 = color1;
        }

        Integer texture = valueAt(faceTextures, faceIndex, SceneExtractor::normalizeTexture);
        FaceUvs uvs = computeFaceUvs(model, faceIndex);
        Integer rgbA = packedFaceColorToRgb(color1);
        Integer rgbB = packedFaceColorToRgb(color2);
        Integer rgbC = packedFaceColorToRgb(color3);
        Integer rgb = texture == null
            ? averagePackedFaceColor(color1, color2, color3)
            : textureColorCache.computeIfAbsent(texture, this::resolveTextureRgb);

        return new TileSurfaceFacePayload(
            a + vertexBase,
            b + vertexBase,
            c + vertexBase,
            rgb,
            rgbA,
            rgbB,
            rgbC,
            texture,
            uvs == null ? null : uvs.uA(),
            uvs == null ? null : uvs.vA(),
            uvs == null ? null : uvs.uB(),
            uvs == null ? null : uvs.vB(),
            uvs == null ? null : uvs.uC(),
            uvs == null ? null : uvs.vC()
        );
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

    private static FaceUvs computeFaceUvs(Model model, int face)
    {
        float[] vertexX = model.getVerticesX();
        float[] vertexY = model.getVerticesY();
        float[] vertexZ = model.getVerticesZ();
        int[] indices1 = model.getFaceIndices1();
        int[] indices2 = model.getFaceIndices2();
        int[] indices3 = model.getFaceIndices3();

        if (vertexX == null || vertexY == null || vertexZ == null || indices1 == null || indices2 == null || indices3 == null)
        {
            return null;
        }

        int triangleA = valueAt(indices1, face, -1);
        int triangleB = valueAt(indices2, face, -1);
        int triangleC = valueAt(indices3, face, -1);

        if (triangleA < 0 || triangleB < 0 || triangleC < 0
            || triangleA >= vertexX.length || triangleB >= vertexX.length || triangleC >= vertexX.length)
        {
            return null;
        }

        byte[] textureFaces = model.getTextureFaces();
        int[] texIndices1 = model.getTexIndices1();
        int[] texIndices2 = model.getTexIndices2();
        int[] texIndices3 = model.getTexIndices3();

        if (textureFaces != null && face < textureFaces.length && textureFaces[face] != -1)
        {
            int tfaceIdx = textureFaces[face] & 0xff;

            if (texIndices1 == null || texIndices2 == null || texIndices3 == null
                || tfaceIdx < 0 || tfaceIdx >= texIndices1.length || tfaceIdx >= texIndices2.length || tfaceIdx >= texIndices3.length)
            {
                return null;
            }

            int texA = texIndices1[tfaceIdx];
            int texB = texIndices2[tfaceIdx];
            int texC = texIndices3[tfaceIdx];

            if (texA < 0 || texB < 0 || texC < 0
                || texA >= vertexX.length || texB >= vertexX.length || texC >= vertexX.length)
            {
                return null;
            }

            float v1x = vertexX[texA];
            float v1y = vertexY[texA];
            float v1z = vertexZ[texA];
            float v2x = vertexX[texB] - v1x;
            float v2y = vertexY[texB] - v1y;
            float v2z = vertexZ[texB] - v1z;
            float v3x = vertexX[texC] - v1x;
            float v3y = vertexY[texC] - v1y;
            float v3z = vertexZ[texC] - v1z;

            float v4x = vertexX[triangleA] - v1x;
            float v4y = vertexY[triangleA] - v1y;
            float v4z = vertexZ[triangleA] - v1z;
            float v5x = vertexX[triangleB] - v1x;
            float v5y = vertexY[triangleB] - v1y;
            float v5z = vertexZ[triangleB] - v1z;
            float v6x = vertexX[triangleC] - v1x;
            float v6y = vertexY[triangleC] - v1y;
            float v6z = vertexZ[triangleC] - v1z;

            float v7x = v2y * v3z - v2z * v3y;
            float v7y = v2z * v3x - v2x * v3z;
            float v7z = v2x * v3y - v2y * v3x;

            float v8x = v3y * v7z - v3z * v7y;
            float v8y = v3z * v7x - v3x * v7z;
            float v8z = v3x * v7y - v3y * v7x;
            float f = 1.0F / (v8x * v2x + v8y * v2y + v8z * v2z);

            float uA = (v8x * v4x + v8y * v4y + v8z * v4z) * f;
            float uB = (v8x * v5x + v8y * v5y + v8z * v5z) * f;
            float uC = (v8x * v6x + v8y * v6y + v8z * v6z) * f;

            v8x = v2y * v7z - v2z * v7y;
            v8y = v2z * v7x - v2x * v7z;
            v8z = v2x * v7y - v2y * v7x;
            f = 1.0F / (v8x * v3x + v8y * v3y + v8z * v3z);

            float vA = (v8x * v4x + v8y * v4y + v8z * v4z) * f;
            float vB = (v8x * v5x + v8y * v5y + v8z * v5z) * f;
            float vC = (v8x * v6x + v8y * v6y + v8z * v6z) * f;
            return new FaceUvs(uA, vA, uB, vB, uC, vC);
        }

        return new FaceUvs(0f, 0f, 1f, 0f, 0f, 1f);
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

    private static int valueAt(int[] values, int index, int fallback)
    {
        Integer value = valueAt(values, index);
        return value == null ? fallback : value;
    }

    private static Integer valueAt(short[] values, int index, java.util.function.IntFunction<Integer> transform)
    {
        if (values == null || index < 0 || index >= values.length)
        {
            return null;
        }

        return transform.apply(values[index]);
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

    private static Integer normalizePositive(int value)
    {
        return value > 0 ? value : null;
    }
}
