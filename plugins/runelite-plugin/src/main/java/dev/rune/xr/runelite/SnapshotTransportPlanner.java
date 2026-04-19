package dev.rune.xr.runelite;

import com.google.gson.Gson;
import dev.rune.xr.runelite.model.ActorModelDefinitionPayload;
import dev.rune.xr.runelite.model.ActorPayload;
import dev.rune.xr.runelite.model.ActorsFramePayload;
import dev.rune.xr.runelite.model.ObjectModelDefinitionPayload;
import dev.rune.xr.runelite.model.ObjectsSnapshotPayload;
import dev.rune.xr.runelite.model.SceneObjectPayload;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.model.TextureDefinitionPayload;
import dev.rune.xr.runelite.model.TerrainSnapshotPayload;
import dev.rune.xr.runelite.model.TileSurfaceModelPayload;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

final class SnapshotTransportPlanner
{
    private SnapshotTransportPlanner()
    {
    }

    static List<List<TextureDefinitionPayload>> partitionTextureDefinitions(List<TextureDefinitionPayload> definitions)
    {
        List<List<TextureDefinitionPayload>> batches = new ArrayList<>();
        List<TextureDefinitionPayload> currentBatch = new ArrayList<>();
        int currentChars = 0;

        for (TextureDefinitionPayload definition : definitions)
        {
            int estimatedChars = estimateTextureDefinitionChars(definition);

            if (!currentBatch.isEmpty() && currentChars + estimatedChars > RuneXrPlugin.MAX_TEXTURE_BATCH_CHARS)
            {
                batches.add(List.copyOf(currentBatch));
                currentBatch.clear();
                currentChars = 0;
            }

            currentBatch.add(definition);
            currentChars += estimatedChars;
        }

        if (!currentBatch.isEmpty())
        {
            batches.add(List.copyOf(currentBatch));
        }

        return batches;
    }

    static List<List<ObjectModelDefinitionPayload>> partitionObjectModelDefinitions(
        Gson gson,
        List<ObjectModelDefinitionPayload> definitions
    )
    {
        List<List<ObjectModelDefinitionPayload>> batches = new ArrayList<>();
        List<ObjectModelDefinitionPayload> currentBatch = new ArrayList<>();
        int currentChars = 0;

        for (ObjectModelDefinitionPayload definition : definitions)
        {
            int estimatedChars = estimateObjectModelDefinitionChars(gson, definition);

            if (!currentBatch.isEmpty() && currentChars + estimatedChars > RuneXrPlugin.MAX_OBJECT_MODEL_BATCH_CHARS)
            {
                batches.add(List.copyOf(currentBatch));
                currentBatch.clear();
                currentChars = 0;
            }

            currentBatch.add(definition);
            currentChars += estimatedChars;
        }

        if (!currentBatch.isEmpty())
        {
            batches.add(List.copyOf(currentBatch));
        }

        return batches;
    }

    static List<List<ActorModelDefinitionPayload>> partitionActorModelDefinitions(
        Gson gson,
        List<ActorModelDefinitionPayload> definitions
    )
    {
        List<List<ActorModelDefinitionPayload>> batches = new ArrayList<>();
        List<ActorModelDefinitionPayload> currentBatch = new ArrayList<>();
        int currentChars = 0;

        for (ActorModelDefinitionPayload definition : definitions)
        {
            int estimatedChars = estimateActorModelDefinitionChars(gson, definition);

            if (!currentBatch.isEmpty() && currentChars + estimatedChars > RuneXrPlugin.MAX_OBJECT_MODEL_BATCH_CHARS)
            {
                batches.add(List.copyOf(currentBatch));
                currentBatch.clear();
                currentChars = 0;
            }

            currentBatch.add(definition);
            currentChars += estimatedChars;
        }

        if (!currentBatch.isEmpty())
        {
            batches.add(List.copyOf(currentBatch));
        }

        return batches;
    }

    static LinkedHashSet<Integer> collectTextureIds(SceneSnapshotPayload snapshot)
    {
        LinkedHashSet<Integer> textureIds = new LinkedHashSet<>();

        for (var tile : snapshot.tiles())
        {
            var surface = tile.surface();

            if (surface == null)
            {
                continue;
            }

            if (surface.texture() != null)
            {
                textureIds.add(surface.texture());
            }

            addModelTextureIds(textureIds, surface.model());
        }

        for (var object : snapshot.objects())
        {
            addModelTextureIds(textureIds, object.model());
        }

        return textureIds;
    }

    static LinkedHashSet<Integer> collectTextureIds(
        SceneSnapshotPayload snapshot,
        List<ObjectModelDefinitionPayload> objectModels
    )
    {
        LinkedHashSet<Integer> textureIds = collectTextureIds(snapshot);

        for (ObjectModelDefinitionPayload definition : objectModels)
        {
            addModelTextureIds(textureIds, definition.model());
        }

        return textureIds;
    }

    static String windowKey(int plane, int baseX, int baseY)
    {
        return plane + ":" + baseX + ":" + baseY;
    }

    static String windowKey(SceneSnapshotPayload snapshot)
    {
        return windowKey(snapshot.plane(), snapshot.baseX(), snapshot.baseY());
    }

    static TerrainSnapshotPayload terrainSnapshot(SceneSnapshotPayload snapshot)
    {
        return terrainSnapshot(snapshot, windowKey(snapshot));
    }

    static TerrainSnapshotPayload terrainSnapshot(SceneSnapshotPayload snapshot, String windowKey)
    {
        return new TerrainSnapshotPayload(
            snapshot.version(),
            snapshot.timestamp(),
            windowKey,
            snapshot.baseX(),
            snapshot.baseY(),
            snapshot.plane(),
            snapshot.tiles()
        );
    }

    static ObjectsSnapshotPayload objectsSnapshot(SceneSnapshotPayload snapshot)
    {
        return objectsSnapshot(snapshot, windowKey(snapshot));
    }

    static ObjectsSnapshotPayload objectsSnapshot(SceneSnapshotPayload snapshot, String windowKey)
    {
        return new ObjectsSnapshotPayload(
            snapshot.version(),
            snapshot.timestamp(),
            windowKey,
            snapshot.objects()
        );
    }

    static ActorsFramePayload actorsFrame(SceneSnapshotPayload snapshot)
    {
        return actorsFrame(snapshot, windowKey(snapshot));
    }

    static ActorsFramePayload actorsFrame(SceneSnapshotPayload snapshot, String windowKey)
    {
        return new ActorsFramePayload(
            snapshot.version(),
            snapshot.timestamp(),
            windowKey,
            snapshot.actors()
        );
    }

    static RuneXrPlugin.SnapshotTransportBundle splitModels(SceneSnapshotPayload snapshot)
    {
        LinkedHashMap<String, ActorModelDefinitionPayload> actorModelDefinitions = new LinkedHashMap<>();
        LinkedHashMap<String, ObjectModelDefinitionPayload> objectModelDefinitions = new LinkedHashMap<>();
        List<ActorPayload> actors = new ArrayList<>(snapshot.actors().size());
        List<SceneObjectPayload> objects = new ArrayList<>(snapshot.objects().size());

        for (ActorPayload actor : snapshot.actors())
        {
            TileSurfaceModelPayload model = actor.model();

            if (model == null)
            {
                actors.add(actor);
                continue;
            }

            String modelKey = actor.modelKey();

            if (modelKey == null || modelKey.isBlank())
            {
                modelKey = modelKeyForModel(model, "actor-model");
            }

            actorModelDefinitions.putIfAbsent(modelKey, new ActorModelDefinitionPayload(modelKey, model));
            actors.add(new ActorPayload(
                actor.id(),
                actor.type(),
                actor.name(),
                actor.x(),
                actor.y(),
                actor.plane(),
                actor.preciseX(),
                actor.preciseY(),
                actor.rotationDegrees(),
                actor.size(),
                modelKey,
                null
            ));
        }

        for (SceneObjectPayload object : snapshot.objects())
        {
            TileSurfaceModelPayload model = object.model();

            if (model == null)
            {
                objects.add(object);
                continue;
            }

            String modelKey = object.modelKey();

            if (modelKey == null || modelKey.isBlank())
            {
                modelKey = modelKeyForModel(model);
            }

            objectModelDefinitions.putIfAbsent(modelKey, new ObjectModelDefinitionPayload(modelKey, model));
            objects.add(new SceneObjectPayload(
                object.id(),
                object.kind(),
                object.name(),
                object.x(),
                object.y(),
                object.plane(),
                object.sizeX(),
                object.sizeY(),
                object.rotationDegrees(),
                object.wallOrientationA(),
                object.wallOrientationB(),
                modelKey,
                null
            ));
        }

        return new RuneXrPlugin.SnapshotTransportBundle(
            new SceneSnapshotPayload(
                snapshot.version(),
                snapshot.timestamp(),
                snapshot.baseX(),
                snapshot.baseY(),
                snapshot.plane(),
                snapshot.tiles(),
                List.copyOf(actors),
                List.copyOf(objects)
            ),
            List.copyOf(actorModelDefinitions.values()),
            List.copyOf(objectModelDefinitions.values())
        );
    }

    static String modelKeyForModel(TileSurfaceModelPayload model)
    {
        return modelKeyForModel(model, "object-model");
    }

    static String modelKeyForModel(TileSurfaceModelPayload model, String prefix)
    {
        try
        {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            updateDigest(digest, model.vertices().size());
            updateDigest(digest, model.faces().size());

            for (var vertex : model.vertices())
            {
                updateDigest(digest, vertex.x());
                updateDigest(digest, vertex.y());
                updateDigest(digest, vertex.z());
            }

            for (var face : model.faces())
            {
                updateDigest(digest, face.a());
                updateDigest(digest, face.b());
                updateDigest(digest, face.c());
                updateDigest(digest, face.rgb());
                updateDigest(digest, face.rgbA());
                updateDigest(digest, face.rgbB());
                updateDigest(digest, face.rgbC());
                updateDigest(digest, face.texture());
                updateDigest(digest, face.uA());
                updateDigest(digest, face.vA());
                updateDigest(digest, face.uB());
                updateDigest(digest, face.vB());
                updateDigest(digest, face.uC());
                updateDigest(digest, face.vC());
            }

            return prefix + ":" + toHex(digest.digest());
        }
        catch (NoSuchAlgorithmException exception)
        {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private static int estimateTextureDefinitionChars(TextureDefinitionPayload definition)
    {
        return definition.pngBase64().length() + 128;
    }

    private static int estimateObjectModelDefinitionChars(Gson gson, ObjectModelDefinitionPayload definition)
    {
        return gson.toJson(definition).length() + 64;
    }

    private static int estimateActorModelDefinitionChars(Gson gson, ActorModelDefinitionPayload definition)
    {
        return gson.toJson(definition).length() + 64;
    }

    private static void updateDigest(MessageDigest digest, Integer value)
    {
        if (value == null)
        {
            updateDigest(digest, -1);
            return;
        }

        updateDigest(digest, value.intValue());
    }

    private static void updateDigest(MessageDigest digest, Float value)
    {
        if (value == null)
        {
            updateDigest(digest, -1);
            return;
        }

        updateDigest(digest, Float.floatToIntBits(value));
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

    private static void addModelTextureIds(Set<Integer> textureIds, TileSurfaceModelPayload model)
    {
        if (model == null)
        {
            return;
        }

        for (var face : model.faces())
        {
            if (face.texture() != null)
            {
                textureIds.add(face.texture());
            }
        }
    }
}
