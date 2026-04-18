package dev.rune.xr.runelite.service;

import dev.rune.xr.runelite.model.TileSurfaceModelPayload;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.LinkedHashMap;
import java.util.Map;
import net.runelite.api.Actor;
import net.runelite.api.Model;
import net.runelite.api.NPC;
import net.runelite.api.Player;
import net.runelite.api.coords.LocalPoint;

final class ActorModelExtractor
{
    private static final int MAX_CACHED_ACTOR_MODELS = 1024;

    private final ModelGeometryExtractor geometryExtractor;
    private final Map<String, TileSurfaceModelPayload> actorModelCache = new LinkedHashMap<>(128, 0.75f, true)
    {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, TileSurfaceModelPayload> eldest)
        {
            return size() > MAX_CACHED_ACTOR_MODELS;
        }
    };

    ActorModelExtractor(ModelGeometryExtractor geometryExtractor)
    {
        this.geometryExtractor = geometryExtractor;
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
        Model model = RenderableModelResolver.resolveRenderableModel(actor);

        if (reference == null || model == null)
        {
            return null;
        }

        TileSurfaceModelPayload extractedModel = geometryExtractor.extractActorModel(model, reference.getX(), reference.getY());

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

    private static String sanitizeName(String name)
    {
        return name.toLowerCase().replaceAll("[^a-z0-9]+", "_");
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
