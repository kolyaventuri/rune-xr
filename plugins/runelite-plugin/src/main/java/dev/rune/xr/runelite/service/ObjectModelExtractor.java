package dev.rune.xr.runelite.service;

import dev.rune.xr.runelite.model.TileSurfaceModelPayload;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.runelite.api.DecorativeObject;
import net.runelite.api.DynamicObject;
import net.runelite.api.GameObject;
import net.runelite.api.Model;
import net.runelite.api.Renderable;
import net.runelite.api.TileObject;
import net.runelite.api.WallObject;
import net.runelite.api.coords.WorldPoint;

final class ObjectModelExtractor
{
    private static final int MAX_CACHED_OBJECT_MODELS = 2048;

    private record StaticObjectModelKey(long objectHash, int objectId, int x, int y, int plane)
    {
    }

    private final ModelGeometryExtractor geometryExtractor;
    private final Map<StaticObjectModelKey, TileSurfaceModelPayload> objectModelCache = new LinkedHashMap<>(256, 0.75f, true)
    {
        @Override
        protected boolean removeEldestEntry(Map.Entry<StaticObjectModelKey, TileSurfaceModelPayload> eldest)
        {
            return size() > MAX_CACHED_OBJECT_MODELS;
        }
    };

    ObjectModelExtractor(net.runelite.api.Client client, ModelGeometryExtractor geometryExtractor)
    {
        this.geometryExtractor = geometryExtractor;
    }

    TileSurfaceModelPayload extractWallModel(WallObject wall)
    {
        return extractObjectModel(wall, List.of(
            new ModelGeometryExtractor.ModelPlacement(wall.getRenderable1(), 0, 0, 0),
            new ModelGeometryExtractor.ModelPlacement(wall.getRenderable2(), 0, 0, 0)
        ));
    }

    TileSurfaceModelPayload extractGameObjectModel(GameObject gameObject)
    {
        return extractObjectModel(gameObject, List.of(
            new ModelGeometryExtractor.ModelPlacement(gameObject.getRenderable(), gameObject.getModelOrientation(), 0, 0)
        ));
    }

    TileSurfaceModelPayload extractDecorativeObjectModel(DecorativeObject decorativeObject)
    {
        return extractObjectModel(decorativeObject, List.of(
            new ModelGeometryExtractor.ModelPlacement(decorativeObject.getRenderable(), 0, decorativeObject.getXOffset(), decorativeObject.getYOffset()),
            new ModelGeometryExtractor.ModelPlacement(decorativeObject.getRenderable2(), 0, decorativeObject.getXOffset2(), decorativeObject.getYOffset2())
        ));
    }

    TileSurfaceModelPayload extractGroundObjectModel(net.runelite.api.GroundObject groundObject)
    {
        return extractObjectModel(groundObject, List.of(
            new ModelGeometryExtractor.ModelPlacement(groundObject.getRenderable(), 0, 0, 0)
        ));
    }

    private TileSurfaceModelPayload extractObjectModel(TileObject object, List<ModelGeometryExtractor.ModelPlacement> placements)
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

        TileSurfaceModelPayload model = geometryExtractor.extractObjectModel(object, placements);

        if (cacheKey != null && model != null)
        {
            objectModelCache.put(cacheKey, model);
        }

        return model;
    }

    private static StaticObjectModelKey createStaticObjectModelKey(
        TileObject object,
        List<ModelGeometryExtractor.ModelPlacement> placements
    )
    {
        for (ModelGeometryExtractor.ModelPlacement placement : placements)
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
}
