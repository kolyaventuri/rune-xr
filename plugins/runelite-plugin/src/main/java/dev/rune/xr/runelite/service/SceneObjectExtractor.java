package dev.rune.xr.runelite.service;

import dev.rune.xr.runelite.model.SceneObjectPayload;
import dev.rune.xr.runelite.model.TileSurfaceModelPayload;
import java.util.ArrayList;
import java.util.List;
import net.runelite.api.DecorativeObject;
import net.runelite.api.GameObject;
import net.runelite.api.GroundObject;
import net.runelite.api.ObjectComposition;
import net.runelite.api.Scene;
import net.runelite.api.Tile;
import net.runelite.api.TileObject;
import net.runelite.api.WallObject;
import net.runelite.api.coords.WorldPoint;

final class SceneObjectExtractor
{
    private final net.runelite.api.Client client;
    private final ObjectModelExtractor objectModelExtractor;

    SceneObjectExtractor(net.runelite.api.Client client, ObjectModelExtractor objectModelExtractor)
    {
        this.client = client;
        this.objectModelExtractor = objectModelExtractor;
    }

    List<SceneObjectPayload> collectObjects(WorldPoint origin, int radius, int plane)
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

    static Integer normalizeGameObjectRotationDegrees(int orientation)
    {
        return normalizeQuarterTurnDegrees(Math.round((float) orientation / 512F));
    }

    static Integer normalizeWallOrientation(int orientation)
    {
        int normalized = orientation & 0xff;
        return normalized == 0 ? null : normalized;
    }

    static boolean shouldEmitObjectPayload(String kind, String name, TileSurfaceModelPayload model)
    {
        return model != null || !defaultObjectName(kind).equals(name);
    }

    private void appendTileObjects(List<SceneObjectPayload> objects, Tile tile, int plane)
    {
        WallObject wall = tile.getWallObject();
        DecorativeObject decor = tile.getDecorativeObject();
        GroundObject ground = tile.getGroundObject();

        if (wall != null)
        {
            SceneObjectPayload payload = buildWallPayload(wall, plane);
            if (payload != null)
            {
                objects.add(payload);
            }
        }

        if (decor != null)
        {
            SceneObjectPayload payload = buildTileObjectPayload("decor", decor, plane, 0, null, null);
            if (payload != null)
            {
                objects.add(payload);
            }
        }

        if (ground != null)
        {
            SceneObjectPayload payload = buildTileObjectPayload("ground", ground, plane, 0, null, null);
            if (payload != null)
            {
                objects.add(payload);
            }
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

            SceneObjectPayload payload = buildGameObjectPayload(gameObject, plane, gameIndex);
            if (payload != null)
            {
                objects.add(payload);
            }
            gameIndex += 1;
        }
    }

    private SceneObjectPayload buildWallPayload(WallObject wall, int plane)
    {
        if (!RenderableModelResolver.hasRenderable(wall.getRenderable1(), wall.getRenderable2()))
        {
            return null;
        }

        Integer wallOrientationA = normalizeWallOrientation(wall.getOrientationA());
        Integer wallOrientationB = normalizeWallOrientation(wall.getOrientationB());
        return buildTileObjectPayload(
            "wall",
            wall,
            plane,
            0,
            wallOrientationA,
            wallOrientationB,
            objectModelExtractor.extractWallModel(wall)
        );
    }

    private SceneObjectPayload buildGameObjectPayload(GameObject gameObject, int plane, int gameIndex)
    {
        if (!RenderableModelResolver.hasRenderable(gameObject.getRenderable()))
        {
            return null;
        }

        ObjectComposition composition = resolveObjectComposition(gameObject.getId());
        WorldPoint point = gameObject.getWorldLocation();
        String name = resolveObjectName("Game object", composition);
        TileSurfaceModelPayload model = objectModelExtractor.extractGameObjectModel(gameObject);

        if (!shouldEmitObjectPayload("game", name, model))
        {
            return null;
        }

        return new SceneObjectPayload(
            buildInstanceId("game", gameObject, point, plane, gameIndex),
            "game",
            name,
            point.getX(),
            point.getY(),
            plane,
            gameObject.sizeX(),
            gameObject.sizeY(),
            normalizeGameObjectRotationDegrees(gameObject.getOrientation()),
            null,
            null,
            null,
            model
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
        String name = resolveObjectName(defaultObjectName(kind), composition);
        Integer sizeX = composition == null ? null : composition.getSizeX();
        Integer sizeY = composition == null ? null : composition.getSizeY();

        if (!shouldEmitObjectPayload(kind, name, model))
        {
            return null;
        }

        return new SceneObjectPayload(
            buildInstanceId(kind, object, point, plane, variantIndex),
            kind,
            name,
            point.getX(),
            point.getY(),
            plane,
            normalizePositiveSize(sizeX),
            normalizePositiveSize(sizeY),
            null,
            wallOrientationA,
            wallOrientationB,
            null,
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
        if (object instanceof DecorativeObject decorativeObject)
        {
            if (!RenderableModelResolver.hasRenderable(decorativeObject.getRenderable(), decorativeObject.getRenderable2()))
            {
                return null;
            }

            return buildTileObjectPayload(
                kind,
                object,
                plane,
                variantIndex,
                wallOrientationA,
                wallOrientationB,
                objectModelExtractor.extractDecorativeObjectModel(decorativeObject)
            );
        }

        if (object instanceof GroundObject groundObject)
        {
            if (!RenderableModelResolver.hasRenderable(groundObject.getRenderable()))
            {
                return null;
            }

            return buildTileObjectPayload(
                kind,
                object,
                plane,
                variantIndex,
                wallOrientationA,
                wallOrientationB,
                objectModelExtractor.extractGroundObjectModel(groundObject)
            );
        }

        return buildTileObjectPayload(kind, object, plane, variantIndex, wallOrientationA, wallOrientationB, null);
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

    private static String defaultObjectName(String kind)
    {
        return switch (kind)
        {
            case "wall" -> "Wall object";
            case "decor" -> "Decorative object";
            case "ground" -> "Ground object";
            default -> "Game object";
        };
    }

    private static Integer normalizeQuarterTurnDegrees(int quarterTurns)
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

    private static Integer normalizePositiveSize(Integer size)
    {
        if (size == null || size <= 0)
        {
            return null;
        }

        return size;
    }

    private static boolean withinRadius(WorldPoint origin, WorldPoint point, int radius)
    {
        if (point == null)
        {
            return false;
        }

        return Math.abs(point.getX() - origin.getX()) <= radius
            && Math.abs(point.getY() - origin.getY()) <= radius
            && point.getPlane() == origin.getPlane();
    }
}
