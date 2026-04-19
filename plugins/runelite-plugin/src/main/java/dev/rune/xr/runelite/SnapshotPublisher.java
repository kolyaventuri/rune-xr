package dev.rune.xr.runelite;

import com.google.gson.Gson;
import dev.rune.xr.runelite.config.RuneXrConfig;
import dev.rune.xr.runelite.model.ActorModelBatchPayload;
import dev.rune.xr.runelite.model.ActorModelDefinitionPayload;
import dev.rune.xr.runelite.model.ActorsFramePayload;
import dev.rune.xr.runelite.model.ActorsFrameState;
import dev.rune.xr.runelite.model.ObjectModelBatchPayload;
import dev.rune.xr.runelite.model.ObjectModelDefinitionPayload;
import dev.rune.xr.runelite.model.ObjectsSnapshotPayload;
import dev.rune.xr.runelite.model.ObjectsSnapshotState;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.model.TerrainSnapshotPayload;
import dev.rune.xr.runelite.model.TerrainSnapshotState;
import dev.rune.xr.runelite.model.TextureBatchPayload;
import dev.rune.xr.runelite.model.TextureDefinitionPayload;
import dev.rune.xr.runelite.service.BridgeClientService;
import dev.rune.xr.runelite.service.SceneExtractor;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

final class SnapshotPublisher
{
    private static final Logger log = LoggerFactory.getLogger(SnapshotPublisher.class);

    private final Gson gson;
    private final RuneXrConfig config;
    private final BridgeClientService bridgeClient;
    private final TextureDefinitionResolver textureDefinitionResolver;
    private final SnapshotDumpWriter snapshotDumpWriter;
    private TerrainSnapshotState lastTerrainState;
    private ObjectsSnapshotState lastObjectsState;
    private ActorsFrameState lastActorsState;
    private String lastWindowKey;
    private final Set<String> sentActorModelKeys = new LinkedHashSet<>();
    private final Set<String> sentObjectModelKeys = new LinkedHashSet<>();
    private final Set<Integer> sentTextureIds = new LinkedHashSet<>();

    @FunctionalInterface
    interface TextureDefinitionResolver
    {
        List<TextureDefinitionPayload> extractTextureDefinitions(Iterable<Integer> textureIds);
    }

    @FunctionalInterface
    interface SnapshotDumpWriter
    {
        void maybeDump(SceneSnapshotPayload snapshot);
    }

    SnapshotPublisher(
        Gson gson,
        RuneXrConfig config,
        BridgeClientService bridgeClient,
        SceneExtractor sceneExtractor,
        CoordinateDumpWriter coordinateDumpWriter
    )
    {
        this(
            gson,
            config,
            bridgeClient,
            sceneExtractor::extractTextureDefinitions,
            coordinateDumpWriter::maybeDump
        );
    }

    SnapshotPublisher(
        Gson gson,
        RuneXrConfig config,
        BridgeClientService bridgeClient,
        TextureDefinitionResolver textureDefinitionResolver,
        SnapshotDumpWriter snapshotDumpWriter
    )
    {
        this.gson = gson;
        this.config = config;
        this.bridgeClient = bridgeClient;
        this.textureDefinitionResolver = textureDefinitionResolver;
        this.snapshotDumpWriter = snapshotDumpWriter;
    }

    void publish(SceneSnapshotPayload snapshot)
    {
        RuneXrPlugin.SnapshotTransportBundle transportBundle = SnapshotTransportPlanner.splitModels(snapshot);
        SceneSnapshotPayload transportSnapshot = transportBundle.snapshot();
        String windowKey = SnapshotTransportPlanner.windowKey(transportSnapshot);
        TerrainSnapshotPayload terrainSnapshot = SnapshotTransportPlanner.terrainSnapshot(transportSnapshot, windowKey);
        ObjectsSnapshotPayload objectsSnapshot = SnapshotTransportPlanner.objectsSnapshot(transportSnapshot, windowKey);
        ActorsFramePayload actorsFrame = SnapshotTransportPlanner.actorsFrame(transportSnapshot, windowKey);
        TerrainSnapshotState terrainState = TerrainSnapshotState.fromSnapshot(terrainSnapshot);
        ObjectsSnapshotState objectsState = ObjectsSnapshotState.fromSnapshot(objectsSnapshot);
        ActorsFrameState actorsState = ActorsFrameState.fromSnapshot(actorsFrame);
        boolean bridgeDisconnected = !bridgeClient.isConnected(config);
        boolean windowChanged = lastWindowKey == null || !windowKey.equals(lastWindowKey);
        boolean shouldSendTerrain = bridgeDisconnected || windowChanged || !terrainState.equals(lastTerrainState);
        boolean shouldSendObjects = bridgeDisconnected || windowChanged || !objectsState.equals(lastObjectsState);
        boolean shouldSendActors = bridgeDisconnected || windowChanged || !actorsState.equals(lastActorsState);

        if (!sendPendingActorModels(transportBundle.actorModelDefinitions()))
        {
            clearState();
            return;
        }

        if (!sendPendingObjectModels(transportBundle.objectModelDefinitions()))
        {
            clearState();
            return;
        }

        if (!sendPendingTextures(transportSnapshot, transportBundle.objectModelDefinitions()))
        {
            clearState();
            return;
        }

        if (!shouldSendTerrain && !shouldSendObjects && !shouldSendActors)
        {
            return;
        }

        snapshotDumpWriter.maybeDump(snapshot);

        if (shouldSendTerrain)
        {
            TerrainSnapshotPayload sentTerrainSnapshot = bridgeClient.sendTerrainSnapshot(config, terrainSnapshot);

            if (sentTerrainSnapshot == null)
            {
                clearState();
                return;
            }

            lastTerrainState = TerrainSnapshotState.fromSnapshot(sentTerrainSnapshot);
            lastWindowKey = sentTerrainSnapshot.windowKey();
        }

        if (shouldSendObjects)
        {
            if (!bridgeClient.sendObjectsSnapshot(config, objectsSnapshot))
            {
                clearState();
                return;
            }

            lastObjectsState = objectsState;
        }

        if (shouldSendActors)
        {
            if (!bridgeClient.sendActorsFrame(config, actorsFrame))
            {
                clearState();
                return;
            }

            lastActorsState = actorsState;
        }
    }

    void clearState()
    {
        lastTerrainState = null;
        lastObjectsState = null;
        lastActorsState = null;
        lastWindowKey = null;
        sentActorModelKeys.clear();
        sentObjectModelKeys.clear();
        sentTextureIds.clear();
    }

    private boolean sendPendingActorModels(List<ActorModelDefinitionPayload> modelDefinitions)
    {
        if (modelDefinitions.isEmpty())
        {
            return true;
        }

        LinkedHashMap<String, ActorModelDefinitionPayload> pendingDefinitions = new LinkedHashMap<>();

        for (ActorModelDefinitionPayload definition : modelDefinitions)
        {
            if (!sentActorModelKeys.contains(definition.key()))
            {
                pendingDefinitions.putIfAbsent(definition.key(), definition);
            }
        }

        if (pendingDefinitions.isEmpty())
        {
            return true;
        }

        List<List<ActorModelDefinitionPayload>> batches = SnapshotTransportPlanner.partitionActorModelDefinitions(
            gson,
            new ArrayList<>(pendingDefinitions.values())
        );

        int sentBatches = 0;

        for (List<ActorModelDefinitionPayload> batch : batches)
        {
            if (sentBatches >= RuneXrPlugin.MAX_OBJECT_MODEL_BATCHES_PER_TICK)
            {
                break;
            }

            if (!bridgeClient.sendActorModelBatch(config, new ActorModelBatchPayload(batch)))
            {
                return false;
            }

            for (ActorModelDefinitionPayload definition : batch)
            {
                sentActorModelKeys.add(definition.key());
            }

            sentBatches += 1;
        }

        if (sentBatches > 0)
        {
            log.debug(
                "Rune XR pending actor models: uniqueModels={}, batches={}, sentBatches={}",
                pendingDefinitions.size(),
                batches.size(),
                sentBatches
            );
        }

        return true;
    }

    private boolean sendPendingObjectModels(List<ObjectModelDefinitionPayload> modelDefinitions)
    {
        if (modelDefinitions.isEmpty())
        {
            return true;
        }

        LinkedHashMap<String, ObjectModelDefinitionPayload> pendingDefinitions = new LinkedHashMap<>();

        for (ObjectModelDefinitionPayload definition : modelDefinitions)
        {
            if (!sentObjectModelKeys.contains(definition.key()))
            {
                pendingDefinitions.putIfAbsent(definition.key(), definition);
            }
        }

        if (pendingDefinitions.isEmpty())
        {
            return true;
        }

        List<List<ObjectModelDefinitionPayload>> batches = SnapshotTransportPlanner.partitionObjectModelDefinitions(
            gson,
            new ArrayList<>(pendingDefinitions.values())
        );

        int sentBatches = 0;

        for (List<ObjectModelDefinitionPayload> batch : batches)
        {
            if (sentBatches >= RuneXrPlugin.MAX_OBJECT_MODEL_BATCHES_PER_TICK)
            {
                break;
            }

            if (!bridgeClient.sendObjectModelBatch(config, new ObjectModelBatchPayload(batch)))
            {
                return false;
            }

            for (ObjectModelDefinitionPayload definition : batch)
            {
                sentObjectModelKeys.add(definition.key());
            }

            sentBatches += 1;
        }

        if (sentBatches > 0)
        {
            log.debug(
                "Rune XR pending object models: uniqueModels={}, batches={}, sentBatches={}",
                pendingDefinitions.size(),
                batches.size(),
                sentBatches
            );
        }

        return true;
    }

    private boolean sendPendingTextures(SceneSnapshotPayload snapshot, List<ObjectModelDefinitionPayload> objectModels)
    {
        LinkedHashSet<Integer> pendingTextureIds = SnapshotTransportPlanner.collectTextureIds(snapshot, objectModels);
        pendingTextureIds.removeAll(sentTextureIds);

        if (pendingTextureIds.isEmpty())
        {
            return true;
        }

        List<TextureDefinitionPayload> definitions = textureDefinitionResolver.extractTextureDefinitions(pendingTextureIds);

        if (definitions.isEmpty())
        {
            return true;
        }

        List<List<TextureDefinitionPayload>> batches = SnapshotTransportPlanner.partitionTextureDefinitions(definitions);

        if (batches.isEmpty())
        {
            return true;
        }

        List<TextureDefinitionPayload> batch = batches.get(0);
        int estimatedBatchChars = batch.stream()
            .mapToInt(definition -> definition.pngBase64().length() + 128)
            .sum();

        log.debug(
            "Rune XR pending textures: ids={}, extractedDefinitions={}, batches={}, sendingBatchTextures={}, estimatedBatchChars={}",
            pendingTextureIds.size(),
            definitions.size(),
            batches.size(),
            batch.size(),
            estimatedBatchChars
        );

        if (!bridgeClient.sendTextureBatch(config, new TextureBatchPayload(batch)))
        {
            return false;
        }

        for (TextureDefinitionPayload definition : batch)
        {
            sentTextureIds.add(definition.id());
        }

        return true;
    }
}
