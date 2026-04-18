package dev.rune.xr.runelite.service;

import dev.rune.xr.runelite.model.TileSurfaceFacePayload;
import dev.rune.xr.runelite.model.TileSurfaceModelPayload;
import dev.rune.xr.runelite.model.TileSurfaceVertexPayload;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.runelite.api.Actor;
import net.runelite.api.DecorativeObject;
import net.runelite.api.DynamicObject;
import net.runelite.api.GameObject;
import net.runelite.api.Model;
import net.runelite.api.NPC;
import net.runelite.api.Perspective;
import net.runelite.api.Player;
import net.runelite.api.Renderable;
import net.runelite.api.TileObject;
import net.runelite.api.WallObject;
import net.runelite.api.coords.LocalPoint;
import net.runelite.api.coords.WorldPoint;

final class ModelPayloadExtractor
{
    private static final int HALF_TILE_SIZE = SceneTileSurfaceExtractor.LOCAL_TILE_SIZE / 2;
    private static final int MAX_CACHED_ACTOR_MODELS = 1024;
    private static final int MAX_CACHED_OBJECT_MODELS = 2048;

    private record RenderablePlacement(Renderable renderable, int orientation, int offsetX, int offsetY)
    {
    }

    private record FaceUvs(float uA, float vA, float uB, float vB, float uC, float vC)
    {
    }

    private record StaticObjectModelKey(long objectHash, int objectId, int x, int y, int plane)
    {
    }

    private final net.runelite.api.Client client;
    private final Map<Integer, Integer> textureColorCache;
    private final Map<String, TileSurfaceModelPayload> actorModelCache = new LinkedHashMap<>(128, 0.75f, true)
    {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, TileSurfaceModelPayload> eldest)
        {
            return size() > MAX_CACHED_ACTOR_MODELS;
        }
    };
    private final Map<StaticObjectModelKey, TileSurfaceModelPayload> objectModelCache = new LinkedHashMap<>(256, 0.75f, true)
    {
        @Override
        protected boolean removeEldestEntry(Map.Entry<StaticObjectModelKey, TileSurfaceModelPayload> eldest)
        {
            return size() > MAX_CACHED_OBJECT_MODELS;
        }
    };

    ModelPayloadExtractor(net.runelite.api.Client client, Map<Integer, Integer> textureColorCache)
    {
        this.client = client;
        this.textureColorCache = textureColorCache;
    }

    TileSurfaceModelPayload extractWallModel(WallObject wall)
    {
        return extractObjectModel(wall, List.of(
            new RenderablePlacement(wall.getRenderable1(), 0, 0, 0),
            new RenderablePlacement(wall.getRenderable2(), 0, 0, 0)
        ));
    }

    TileSurfaceModelPayload extractGameObjectModel(GameObject gameObject)
    {
        return extractObjectModel(gameObject, List.of(
            new RenderablePlacement(gameObject.getRenderable(), gameObject.getModelOrientation(), 0, 0)
        ));
    }

    TileSurfaceModelPayload extractDecorativeObjectModel(DecorativeObject decorativeObject)
    {
        return extractObjectModel(decorativeObject, List.of(
            new RenderablePlacement(decorativeObject.getRenderable(), 0, decorativeObject.getXOffset(), decorativeObject.getYOffset()),
            new RenderablePlacement(decorativeObject.getRenderable2(), 0, decorativeObject.getXOffset2(), decorativeObject.getYOffset2())
        ));
    }

    TileSurfaceModelPayload extractGroundObjectModel(net.runelite.api.GroundObject groundObject)
    {
        return extractObjectModel(groundObject, List.of(
            new RenderablePlacement(groundObject.getRenderable(), 0, 0, 0)
        ));
    }

    TileSurfaceModelPayload extractActorModel(Actor actor, String cacheKey)
    {
        if (cacheKey != null)
        {
            TileSurfaceModelPayload cachedModel = actorModelCache.get(cacheKey);

            if (cachedModel != null)
            {
                return cachedModel;
            }
        }

        LocalPoint reference = actor.getLocalLocation();
        Model model = resolveRenderableModel(actor);

        if (reference == null || model == null)
        {
            return null;
        }

        TileSurfaceModelPayload extractedModel = extractActorModel(model, reference.getX(), reference.getY());

        if (cacheKey != null && extractedModel != null)
        {
            actorModelCache.put(cacheKey, extractedModel);
        }

        return extractedModel;
    }

    String actorModelKey(Actor actor)
    {
        if (actor instanceof Player player)
        {
            return playerModelKey(player);
        }

        if (actor instanceof NPC npc)
        {
            return npcModelKey(npc);
        }

        return "actor-model:actor:" + sanitizeName(actor.getName() == null ? "actor" : actor.getName());
    }

    static Model resolveRenderableModel(Renderable renderable)
    {
        if (renderable == null)
        {
            return null;
        }

        if (renderable instanceof DynamicObject dynamicObject)
        {
            Model model = dynamicObject.getModelZbuf();

            if (hasUsableGeometry(model))
            {
                return model;
            }

            return dynamicObject.getModel();
        }

        if (renderable instanceof Model model)
        {
            return model;
        }

        return renderable.getModel();
    }

    static boolean hasRenderable(Renderable... renderables)
    {
        for (Renderable renderable : renderables)
        {
            if (renderable != null)
            {
                return true;
            }
        }

        return false;
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
                SceneTileSurfaceExtractor.normalizeTileHeight(worldLocalY + vy),
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

        Integer texture = valueAt(faceTextures, faceIndex, SceneTileSurfaceExtractor::normalizeTexture);
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

    private TileSurfaceModelPayload extractActorModel(Model model, int referenceOriginX, int referenceOriginZ)
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

        int vertexCount = Math.min(vertexX.length, Math.min(vertexY.length, vertexZ.length));
        int faceCount = Math.min(indices1.length, Math.min(indices2.length, indices3.length));

        if (vertexCount == 0 || faceCount == 0)
        {
            return null;
        }

        List<TileSurfaceVertexPayload> vertices = new ArrayList<>(vertexCount);
        List<TileSurfaceFacePayload> faces = new ArrayList<>(faceCount);

        for (int index = 0; index < vertexCount; index += 1)
        {
            vertices.add(new TileSurfaceVertexPayload(
                Math.round(referenceOriginX + vertexX[index]) - referenceOriginX,
                SceneTileSurfaceExtractor.normalizeTileHeight(Math.round(vertexY[index])),
                Math.round(referenceOriginZ + vertexZ[index]) - referenceOriginZ
            ));
        }

        int[] color1s = model.getFaceColors1();
        int[] color2s = model.getFaceColors2();
        int[] color3s = model.getFaceColors3();
        short[] faceTextures = model.getFaceTextures();

        for (int faceIndex = 0; faceIndex < faceCount; faceIndex += 1)
        {
            TileSurfaceFacePayload face = extractModelFace(model, color1s, color2s, color3s, faceTextures, faceIndex, 0, vertexCount);

            if (face != null)
            {
                faces.add(face);
            }
        }

        return faces.isEmpty() ? null : new TileSurfaceModelPayload(vertices, faces);
    }

    private String playerModelKey(Player player)
    {
        try
        {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            var composition = player.getPlayerComposition();

            if (composition == null)
            {
                updateDigest(digest, player.getId());
                return "actor-model:player:" + toHex(digest.digest());
            }

            updateDigest(digest, composition.getGender());
            updateDigest(digest, composition.getTransformedNpcId());
            updateDigest(digest, composition.getEquipmentIds());
            updateDigest(digest, composition.getColors());
            return "actor-model:player:" + toHex(digest.digest());
        }
        catch (NoSuchAlgorithmException exception)
        {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private String npcModelKey(NPC npc)
    {
        try
        {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            var composition = npc.getTransformedComposition();

            if (composition == null)
            {
                composition = npc.getComposition();
            }

            updateDigest(digest, composition == null ? npc.getId() : composition.getId());

            if (composition != null)
            {
                updateDigest(digest, composition.getModels());
                updateDigest(digest, composition.getColorToReplace());
                updateDigest(digest, composition.getColorToReplaceWith());
                updateDigest(digest, composition.getWidthScale());
                updateDigest(digest, composition.getHeightScale());
            }

            var overrides = npc.getModelOverrides();

            if (overrides != null)
            {
                updateDigest(digest, overrides.getModelIds());
                updateDigest(digest, overrides.getColorToReplaceWith());
                updateDigest(digest, overrides.getTextureToReplaceWith());
                updateDigest(digest, overrides.useLocalPlayer() ? 1 : 0);
            }

            return "actor-model:npc:" + toHex(digest.digest());
        }
        catch (NoSuchAlgorithmException exception)
        {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private String sanitizeName(String name)
    {
        return name.toLowerCase().replaceAll("[^a-z0-9]+", "_");
    }

    private Integer resolveTextureRgb(int textureId)
    {
        if (client.getTextureProvider() == null)
        {
            return null;
        }

        return SceneTileSurfaceExtractor.averageTextureRgb(client.getTextureProvider().load(textureId));
    }

    private static boolean hasUsableGeometry(Model model)
    {
        if (model == null)
        {
            return false;
        }

        float[] vertexX = model.getVerticesX();
        float[] vertexY = model.getVerticesY();
        float[] vertexZ = model.getVerticesZ();
        int[] indices1 = model.getFaceIndices1();
        int[] indices2 = model.getFaceIndices2();
        int[] indices3 = model.getFaceIndices3();

        if (vertexX == null || vertexY == null || vertexZ == null || indices1 == null || indices2 == null || indices3 == null)
        {
            return false;
        }

        int vertexCount = Math.min(vertexX.length, Math.min(vertexY.length, vertexZ.length));
        int faceCount = Math.min(indices1.length, Math.min(indices2.length, indices3.length));

        return vertexCount > 0 && faceCount > 0;
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
        return packedColor == null ? null : SceneTileSurfaceExtractor.packedHslToRgb(packedColor);
    }

    private static int accumulatePackedFaceColor(Integer packedColor, long[] totals)
    {
        if (packedColor == null)
        {
            return 0;
        }

        Integer rgb = SceneTileSurfaceExtractor.packedHslToRgb(packedColor);
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

    private static void updateDigest(MessageDigest digest, int[] values)
    {
        if (values == null)
        {
            updateDigest(digest, -1);
            return;
        }

        updateDigest(digest, values.length);

        for (int value : values)
        {
            updateDigest(digest, value);
        }
    }

    private static void updateDigest(MessageDigest digest, short[] values)
    {
        if (values == null)
        {
            updateDigest(digest, -1);
            return;
        }

        updateDigest(digest, values.length);

        for (short value : values)
        {
            updateDigest(digest, value);
        }
    }

    private static void updateDigest(MessageDigest digest, int value)
    {
        digest.update((byte) (value >>> 24));
        digest.update((byte) (value >>> 16));
        digest.update((byte) (value >>> 8));
        digest.update((byte) value);
    }

    private static String toHex(byte[] bytes)
    {
        StringBuilder builder = new StringBuilder(bytes.length * 2);

        for (byte value : bytes)
        {
            builder.append(Character.forDigit((value >>> 4) & 0xf, 16));
            builder.append(Character.forDigit(value & 0xf, 16));
        }

        return builder.toString();
    }
}
