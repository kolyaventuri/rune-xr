package dev.rune.xr.runelite;

import com.google.gson.Gson;
import dev.rune.xr.runelite.config.RuneXrConfig;
import dev.rune.xr.runelite.model.ActorModelBatchPayload;
import dev.rune.xr.runelite.model.ActorModelDefinitionPayload;
import dev.rune.xr.runelite.model.ObjectModelBatchPayload;
import dev.rune.xr.runelite.model.ObjectModelDefinitionPayload;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.model.SceneSnapshotState;
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
    private final SceneExtractor sceneExtractor;
    private final CoordinateDumpWriter coordinateDumpWriter;
    private SceneSnapshotState lastSnapshotState;
    private final Set<String> sentActorModelKeys = new LinkedHashSet<>();
    private final Set<String> sentObjectModelKeys = new LinkedHashSet<>();
    private final Set<Integer> sentTextureIds = new LinkedHashSet<>();

    SnapshotPublisher(
        Gson gson,
        RuneXrConfig config,
        BridgeClientService bridgeClient,
        SceneExtractor sceneExtractor,
        CoordinateDumpWriter coordinateDumpWriter
    )
    {
        this.gson = gson;
        this.config = config;
        this.bridgeClient = bridgeClient;
        this.sceneExtractor = sceneExtractor;
        this.coordinateDumpWriter = coordinateDumpWriter;
    }

    void publish(SceneSnapshotPayload snapshot)
    {
        RuneXrPlugin.SnapshotTransportBundle transportBundle = SnapshotTransportPlanner.splitModels(snapshot);
        SceneSnapshotState snapshotState = SceneSnapshotState.fromSnapshot(transportBundle.snapshot());
        boolean shouldSendSnapshot = !snapshotState.equals(lastSnapshotState) || !bridgeClient.isConnected(config);

        if (shouldSendSnapshot)
        {
            coordinateDumpWriter.maybeDump(snapshot);
        }

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

        if (shouldSendSnapshot)
        {
            SceneSnapshotPayload transportSnapshot = bridgeClient.sendSnapshot(config, transportBundle.snapshot());

            if (transportSnapshot == null)
            {
                clearState();
                return;
            }

            lastSnapshotState = SceneSnapshotState.fromSnapshot(transportSnapshot);
        }

        sendPendingTextures(transportBundle.snapshot(), transportBundle.objectModelDefinitions());
    }

    void clearState()
    {
        lastSnapshotState = null;
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

    private void sendPendingTextures(SceneSnapshotPayload snapshot, List<ObjectModelDefinitionPayload> objectModels)
    {
        LinkedHashSet<Integer> pendingTextureIds = SnapshotTransportPlanner.collectTextureIds(snapshot, objectModels);
        pendingTextureIds.removeAll(sentTextureIds);

        if (pendingTextureIds.isEmpty())
        {
            return;
        }

        List<TextureDefinitionPayload> definitions = sceneExtractor.extractTextureDefinitions(pendingTextureIds);

        if (definitions.isEmpty())
        {
            return;
        }

        List<List<TextureDefinitionPayload>> batches = SnapshotTransportPlanner.partitionTextureDefinitions(definitions);

        if (batches.isEmpty())
        {
            return;
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
            clearState();
            return;
        }

        for (TextureDefinitionPayload definition : batch)
        {
            sentTextureIds.add(definition.id());
        }
    }
}
