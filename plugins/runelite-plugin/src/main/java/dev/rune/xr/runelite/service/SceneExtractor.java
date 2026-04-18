package dev.rune.xr.runelite.service;

import dev.rune.xr.runelite.model.ActorPayload;
import dev.rune.xr.runelite.model.ProtocolMessages;
import dev.rune.xr.runelite.model.SceneObjectPayload;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.model.TextureDefinitionPayload;
import dev.rune.xr.runelite.model.TilePayload;
import dev.rune.xr.runelite.model.TileSurfaceModelPayload;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import net.runelite.api.Actor;
import net.runelite.api.Client;
import net.runelite.api.Model;
import net.runelite.api.NPC;
import net.runelite.api.Player;
import net.runelite.api.Renderable;
import net.runelite.api.SceneTileModel;
import net.runelite.api.Tile;
import net.runelite.api.coords.LocalPoint;
import net.runelite.api.coords.WorldPoint;

public final class SceneExtractor
{
    static final int LOCAL_TILE_SIZE = SceneTileSurfaceExtractor.LOCAL_TILE_SIZE;

    private final Client client;
    private final SceneTileSurfaceExtractor tileSurfaceExtractor;
    private final ActorModelExtractor actorModelExtractor;
    private final SceneObjectExtractor sceneObjectExtractor;

    public SceneExtractor(Client client)
    {
        this.client = client;
        Map<Integer, Integer> textureColorCache = new HashMap<>();
        ModelGeometryExtractor geometryExtractor = new ModelGeometryExtractor(client, textureColorCache);
        this.tileSurfaceExtractor = new SceneTileSurfaceExtractor(client, textureColorCache);
        this.actorModelExtractor = new ActorModelExtractor(geometryExtractor);
        this.sceneObjectExtractor = new SceneObjectExtractor(client, new ObjectModelExtractor(client, geometryExtractor));
    }

    public Optional<SceneSnapshotPayload> extract(int radius)
    {
        Player localPlayer = client.getLocalPlayer();

        if (localPlayer == null)
        {
            return Optional.empty();
        }

        int plane = client.getPlane();
        WorldPoint origin = resolveActorWorldPoint(localPlayer, plane);

        if (origin == null)
        {
            return Optional.empty();
        }

        int baseX = origin.getX() - radius;
        int baseY = origin.getY() - radius;
        List<TilePayload> tiles = tileSurfaceExtractor.collectTiles(baseX, baseY, radius, plane);
        List<ActorPayload> actors = collectActors(origin, radius, plane);
        List<SceneObjectPayload> objects = sceneObjectExtractor.collectObjects(origin, radius, plane);

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
        return tileSurfaceExtractor.extractTextureDefinitions(textureIds);
    }

    private List<ActorPayload> collectActors(WorldPoint origin, int radius, int plane)
    {
        List<ActorPayload> actors = new ArrayList<>();
        Player localPlayer = client.getLocalPlayer();

        if (localPlayer != null)
        {
            WorldPoint point = resolveActorWorldPoint(localPlayer, plane);

            if (withinRadius(origin, point, radius))
            {
                addActorPayload(actors, localPlayer, point, "self", plane, true);
            }
        }

        for (Player player : client.getPlayers())
        {
            if (player == null || player == localPlayer)
            {
                continue;
            }

            WorldPoint point = resolveActorWorldPoint(player, plane);

            if (!withinRadius(origin, point, radius))
            {
                continue;
            }

            addActorPayload(actors, player, point, "player", plane, true);
        }

        for (NPC npc : client.getNpcs())
        {
            if (npc == null)
            {
                continue;
            }

            WorldPoint point = resolveActorWorldPoint(npc, plane);

            if (!withinRadius(origin, point, radius))
            {
                continue;
            }

            addActorPayload(actors, npc, point, "npc", plane, false);
        }

        return actors;
    }

    private void addActorPayload(List<ActorPayload> actors, Actor actor, WorldPoint point, String type, int plane, boolean preferName)
    {
        String name = preferName ? actor.getName() : actor.getName() != null ? actor.getName() : "NPC";
        String actorId = buildActorId(actor, type, name);
        String modelKey = actorModelExtractor.actorModelKey(actor);
        TileSurfaceModelPayload model = actorModelExtractor.extractActorModel(actor, modelKey);
        LocalPoint localPoint = actor.getLocalLocation();
        Double preciseX = localPoint == null ? null : preciseTileCoordinate(point.getX(), localPoint.getX());
        Double preciseY = localPoint == null ? null : preciseTileCoordinate(point.getY(), localPoint.getY());

        actors.add(new ActorPayload(
            actorId,
            type,
            name,
            point.getX(),
            point.getY(),
            plane,
            preciseX,
            preciseY,
            normalizeActorRotationDegrees(actor.getCurrentOrientation()),
            normalizePositiveSize(actor.getFootprintSize()),
            model == null ? null : modelKey,
            model
        ));
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

        return type + "_" + name.toLowerCase().replaceAll("[^a-z0-9]+", "_");
    }

    private WorldPoint resolveActorWorldPoint(Actor actor, int plane)
    {
        if (actor == null)
        {
            return null;
        }

        LocalPoint localPoint = actor.getLocalLocation();

        if (localPoint != null)
        {
            return WorldPoint.fromLocalInstance(client, localPoint, plane);
        }

        return actor.getWorldLocation();
    }

    static double preciseTileCoordinate(int worldCoordinate, int localCoordinate)
    {
        return worldCoordinate + (double) Math.floorMod(localCoordinate, LOCAL_TILE_SIZE) / LOCAL_TILE_SIZE;
    }

    static Integer normalizeGameObjectRotationDegrees(int orientation)
    {
        return SceneObjectExtractor.normalizeGameObjectRotationDegrees(orientation);
    }

    static Integer normalizeWallOrientation(int orientation)
    {
        return SceneObjectExtractor.normalizeWallOrientation(orientation);
    }

    static boolean hasRenderable(Renderable... renderables)
    {
        return RenderableModelResolver.hasRenderable(renderables);
    }

    static Model resolveRenderableModel(Renderable renderable)
    {
        return RenderableModelResolver.resolveRenderableModel(renderable);
    }

    static Integer resolveBridgeHeight(Tile tile, int sceneX, int sceneY, int[][][] heights)
    {
        return SceneTileSurfaceExtractor.resolveBridgeHeight(tile, sceneX, sceneY, heights);
    }

    static boolean shouldEmitObjectPayload(String kind, String name, TileSurfaceModelPayload model)
    {
        return SceneObjectExtractor.shouldEmitObjectPayload(kind, name, model);
    }

    static int normalizeTileHeight(int rawHeight)
    {
        return SceneTileSurfaceExtractor.normalizeTileHeight(rawHeight);
    }

    static Integer averageModelRgb(SceneTileModel model)
    {
        return SceneTileSurfaceExtractor.averageModelRgb(model);
    }

    static Integer packedHslToRgb(int packedHsl)
    {
        return SceneTileSurfaceExtractor.packedHslToRgb(packedHsl);
    }

    static Integer averageTextureRgb(int[] pixels)
    {
        return SceneTileSurfaceExtractor.averageTextureRgb(pixels);
    }

    static Integer firstModelTexture(SceneTileModel model)
    {
        return SceneTileSurfaceExtractor.firstModelTexture(model);
    }

    static TileSurfaceModelPayload extractSurfaceModel(SceneTileModel model, int sceneX, int sceneY)
    {
        return SceneTileSurfaceExtractor.extractSurfaceModel(model, sceneX, sceneY);
    }

    private static Integer normalizeActorRotationDegrees(int orientation)
    {
        return Math.floorMod(Math.round((float) orientation * 360F / 2048F), 360);
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
