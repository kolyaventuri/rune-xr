package dev.rune.xr.runelite;

import com.google.gson.Gson;
import com.google.inject.Provides;
import dev.rune.xr.runelite.config.RuneXrConfig;
import dev.rune.xr.runelite.model.ObjectModelBatchPayload;
import dev.rune.xr.runelite.model.ObjectModelDefinitionPayload;
import dev.rune.xr.runelite.model.SceneSnapshotState;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.model.SceneObjectPayload;
import dev.rune.xr.runelite.model.TextureBatchPayload;
import dev.rune.xr.runelite.model.TextureDefinitionPayload;
import dev.rune.xr.runelite.model.TileSurfaceModelPayload;
import dev.rune.xr.runelite.service.BridgeClientService;
import dev.rune.xr.runelite.service.SceneExtractor;
import dev.rune.xr.runelite.service.SyntheticSceneFactory;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import javax.inject.Inject;
import net.runelite.api.Client;
import net.runelite.client.callback.ClientThread;
import net.runelite.client.config.ConfigManager;
import net.runelite.client.eventbus.Subscribe;
import net.runelite.client.events.ConfigChanged;
import net.runelite.client.plugins.Plugin;
import net.runelite.client.plugins.PluginDescriptor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@PluginDescriptor(
    name = "Rune XR",
    configName = "runexr",
    description = "Streams nearby RuneScape state into the Rune XR bridge",
    tags = {"xr", "vr", "bridge", "webxr"},
    enabledByDefault = false,
    developerPlugin = true
)
public class RuneXrPlugin extends Plugin
{
    private static final Logger log = LoggerFactory.getLogger(RuneXrPlugin.class);
    static final int MAX_OBJECT_MODEL_BATCH_CHARS = 500_000;
    static final int MAX_OBJECT_MODEL_BATCHES_PER_TICK = 4;
    static final int MAX_TEXTURE_BATCH_CHARS = 250_000;

    @Inject
    private Client client;

    @Inject
    private ClientThread clientThread;

    @Inject
    private RuneXrConfig config;

    @Inject
    private Gson gson;

    private ScheduledExecutorService executor;
    private BridgeClientService bridgeClient;
    private SceneExtractor sceneExtractor;
    private SyntheticSceneFactory syntheticSceneFactory;
    private SceneSnapshotState lastSnapshotState;
    private final Set<String> sentObjectModelKeys = new LinkedHashSet<>();
    private final Set<Integer> sentTextureIds = new LinkedHashSet<>();
    private final AtomicBoolean snapshotScheduled = new AtomicBoolean();

    @Override
    protected void startUp()
    {
        bridgeClient = new BridgeClientService(gson);
        sceneExtractor = new SceneExtractor(client);
        syntheticSceneFactory = new SyntheticSceneFactory();
        clearSentState();
        startSnapshotLoop();
    }

    @Override
    protected void shutDown()
    {
        stopSnapshotLoop();

        if (bridgeClient != null)
        {
            bridgeClient.close();
            bridgeClient = null;
        }

        clearSentState();
    }

    @Subscribe
    public void onConfigChanged(ConfigChanged event)
    {
        if (!"runexr".equals(event.getGroup()))
        {
            return;
        }

        clearSentState();

        switch (event.getKey())
        {
            case "bridgeHost", "bridgePort" ->
            {
                if (bridgeClient != null)
                {
                    bridgeClient.resetConnection();
                }
            }
            case "updateRateMs" -> startSnapshotLoop();
            default ->
            {
            }
        }
    }

    private void startSnapshotLoop()
    {
        stopSnapshotLoop();
        executor = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "rune-xr-snapshot-loop");
            thread.setDaemon(true);
            return thread;
        });
        executor.scheduleAtFixedRate(
            this::scheduleSnapshotPublish,
            0L,
            Math.max(100, config.updateRateMs()),
            TimeUnit.MILLISECONDS
        );
    }

    private void stopSnapshotLoop()
    {
        if (executor != null)
        {
            executor.shutdownNow();
            executor = null;
        }

        snapshotScheduled.set(false);
    }

    private void publishSnapshot()
    {
        try
        {
            Optional<SceneSnapshotPayload> snapshot = config.syntheticMode()
                ? Optional.of(syntheticSceneFactory.nextSnapshot(config.tileRadius()))
                : sceneExtractor.extract(config.tileRadius());

            snapshot.ifPresent(this::sendIfChanged);
        }
        finally
        {
            snapshotScheduled.set(false);
        }
    }

    private void scheduleSnapshotPublish()
    {
        if (!snapshotScheduled.compareAndSet(false, true))
        {
            return;
        }

        clientThread.invoke(this::publishSnapshot);
    }

    private void sendIfChanged(SceneSnapshotPayload snapshot)
    {
        SnapshotTransportBundle transportBundle = splitObjectModels(snapshot);
        SceneSnapshotState snapshotState = SceneSnapshotState.fromSnapshot(transportBundle.snapshot());
        boolean shouldSendSnapshot = !snapshotState.equals(lastSnapshotState) || !bridgeClient.isConnected(config);

        if (!sendPendingObjectModels(transportBundle.modelDefinitions()))
        {
            clearSentState();
            return;
        }

        if (shouldSendSnapshot)
        {
            SceneSnapshotPayload transportSnapshot = bridgeClient.sendSnapshot(config, transportBundle.snapshot());

            if (transportSnapshot == null)
            {
                clearSentState();
                return;
            }

            lastSnapshotState = SceneSnapshotState.fromSnapshot(transportSnapshot);
        }

        sendPendingTextures(transportBundle.snapshot(), transportBundle.modelDefinitions());
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

        List<List<ObjectModelDefinitionPayload>> batches = partitionObjectModelDefinitions(
            gson,
            new ArrayList<>(pendingDefinitions.values())
        );

        int sentBatches = 0;

        for (List<ObjectModelDefinitionPayload> batch : batches)
        {
            if (sentBatches >= MAX_OBJECT_MODEL_BATCHES_PER_TICK)
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
        if (config.syntheticMode())
        {
            return;
        }

        LinkedHashSet<Integer> pendingTextureIds = collectTextureIds(snapshot, objectModels);
        pendingTextureIds.removeAll(sentTextureIds);

        if (pendingTextureIds.isEmpty())
        {
            return;
        }

        var definitions = sceneExtractor.extractTextureDefinitions(pendingTextureIds);

        if (definitions.isEmpty())
        {
            return;
        }

        List<List<TextureDefinitionPayload>> batches = partitionTextureDefinitions(definitions);

        if (batches.isEmpty())
        {
            return;
        }

        List<TextureDefinitionPayload> batch = batches.get(0);
        int estimatedBatchChars = batch.stream()
            .mapToInt(RuneXrPlugin::estimateTextureDefinitionChars)
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
            clearSentState();
            return;
        }

        for (TextureDefinitionPayload definition : batch)
        {
            sentTextureIds.add(definition.id());
        }
    }

    static List<List<TextureDefinitionPayload>> partitionTextureDefinitions(List<TextureDefinitionPayload> definitions)
    {
        List<List<TextureDefinitionPayload>> batches = new ArrayList<>();
        List<TextureDefinitionPayload> currentBatch = new ArrayList<>();
        int currentChars = 0;

        for (TextureDefinitionPayload definition : definitions)
        {
            int estimatedChars = estimateTextureDefinitionChars(definition);

            if (!currentBatch.isEmpty() && currentChars + estimatedChars > MAX_TEXTURE_BATCH_CHARS)
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

    static List<List<ObjectModelDefinitionPayload>> partitionObjectModelDefinitions(Gson gson, List<ObjectModelDefinitionPayload> definitions)
    {
        List<List<ObjectModelDefinitionPayload>> batches = new ArrayList<>();
        List<ObjectModelDefinitionPayload> currentBatch = new ArrayList<>();
        int currentChars = 0;

        for (ObjectModelDefinitionPayload definition : definitions)
        {
            int estimatedChars = estimateObjectModelDefinitionChars(gson, definition);

            if (!currentBatch.isEmpty() && currentChars + estimatedChars > MAX_OBJECT_MODEL_BATCH_CHARS)
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

    private static int estimateTextureDefinitionChars(TextureDefinitionPayload definition)
    {
        return definition.pngBase64().length() + 128;
    }

    private static int estimateObjectModelDefinitionChars(Gson gson, ObjectModelDefinitionPayload definition)
    {
        return gson.toJson(definition).length() + 64;
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

            var model = surface.model();

            if (model == null)
            {
                continue;
            }

            for (var face : model.faces())
            {
                if (face.texture() != null)
                {
                    textureIds.add(face.texture());
                }
            }
        }

        for (var object : snapshot.objects())
        {
            var model = object.model();

            if (model == null)
            {
                continue;
            }

            for (var face : model.faces())
            {
                if (face.texture() != null)
                {
                    textureIds.add(face.texture());
                }
            }
        }

        return textureIds;
    }

    static LinkedHashSet<Integer> collectTextureIds(SceneSnapshotPayload snapshot, List<ObjectModelDefinitionPayload> objectModels)
    {
        LinkedHashSet<Integer> textureIds = collectTextureIds(snapshot);

        for (ObjectModelDefinitionPayload definition : objectModels)
        {
            addModelTextureIds(textureIds, definition.model());
        }

        return textureIds;
    }

    static SnapshotTransportBundle splitObjectModels(SceneSnapshotPayload snapshot)
    {
        LinkedHashMap<String, ObjectModelDefinitionPayload> modelDefinitions = new LinkedHashMap<>();
        List<SceneObjectPayload> objects = new ArrayList<>(snapshot.objects().size());

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

            modelDefinitions.putIfAbsent(modelKey, new ObjectModelDefinitionPayload(modelKey, model));
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

        return new SnapshotTransportBundle(
            new SceneSnapshotPayload(
                snapshot.version(),
                snapshot.timestamp(),
                snapshot.baseX(),
                snapshot.baseY(),
                snapshot.plane(),
                snapshot.tiles(),
                snapshot.actors(),
                List.copyOf(objects)
            ),
            List.copyOf(modelDefinitions.values())
        );
    }

    static String modelKeyForModel(TileSurfaceModelPayload model)
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

            return "object-model:" + toHex(digest.digest());
        }
        catch (NoSuchAlgorithmException exception)
        {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
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
        for (var face : model.faces())
        {
            if (face.texture() != null)
            {
                textureIds.add(face.texture());
            }
        }
    }

    private void clearSentState()
    {
        lastSnapshotState = null;
        sentObjectModelKeys.clear();
        sentTextureIds.clear();
    }

    @Provides
    RuneXrConfig provideConfig(ConfigManager configManager)
    {
        return configManager.getConfig(RuneXrConfig.class);
    }

    record SnapshotTransportBundle(
        SceneSnapshotPayload snapshot,
        List<ObjectModelDefinitionPayload> modelDefinitions
    )
    {
    }
}
