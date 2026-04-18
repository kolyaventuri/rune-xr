package dev.rune.xr.runelite;

import com.google.gson.Gson;
import com.google.inject.Provides;
import dev.rune.xr.runelite.config.RuneXrConfig;
import dev.rune.xr.runelite.model.ActorModelDefinitionPayload;
import dev.rune.xr.runelite.model.ObjectModelDefinitionPayload;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.model.TextureDefinitionPayload;
import dev.rune.xr.runelite.model.TileSurfaceModelPayload;
import dev.rune.xr.runelite.service.BridgeClientService;
import dev.rune.xr.runelite.service.SceneExtractor;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.inject.Inject;
import net.runelite.api.Client;
import net.runelite.client.callback.ClientThread;
import net.runelite.client.config.ConfigManager;
import net.runelite.client.eventbus.Subscribe;
import net.runelite.client.events.ConfigChanged;
import net.runelite.client.plugins.Plugin;
import net.runelite.client.plugins.PluginDescriptor;

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
    private SnapshotPublisher snapshotPublisher;
    private CoordinateDumpWriter coordinateDumpWriter;
    private final AtomicBoolean snapshotScheduled = new AtomicBoolean();

    @Override
    protected void startUp()
    {
        bridgeClient = new BridgeClientService(gson);
        sceneExtractor = new SceneExtractor(client);
        coordinateDumpWriter = new CoordinateDumpWriter(client, config, gson);
        snapshotPublisher = new SnapshotPublisher(gson, config, bridgeClient, sceneExtractor, coordinateDumpWriter);
        coordinateDumpWriter.initialize();
        clearSentState();
        startSnapshotLoop();
    }

    @Override
    protected void shutDown()
    {
        stopSnapshotLoop();
        clearSentState();

        if (bridgeClient != null)
        {
            bridgeClient.close();
            bridgeClient = null;
        }

        snapshotPublisher = null;
        coordinateDumpWriter = null;
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
            case "coordinateDumpEnabled", "coordinateDumpPath" ->
            {
                if (coordinateDumpWriter != null)
                {
                    coordinateDumpWriter.initialize();
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
            sceneExtractor.extract(config.tileRadius()).ifPresent(this::sendIfChanged);
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
        if (snapshotPublisher != null)
        {
            snapshotPublisher.publish(snapshot);
        }
    }

    static List<List<TextureDefinitionPayload>> partitionTextureDefinitions(List<TextureDefinitionPayload> definitions)
    {
        return SnapshotTransportPlanner.partitionTextureDefinitions(definitions);
    }

    static List<List<ObjectModelDefinitionPayload>> partitionObjectModelDefinitions(
        Gson gson,
        List<ObjectModelDefinitionPayload> definitions
    )
    {
        return SnapshotTransportPlanner.partitionObjectModelDefinitions(gson, definitions);
    }

    static List<List<ActorModelDefinitionPayload>> partitionActorModelDefinitions(
        Gson gson,
        List<ActorModelDefinitionPayload> definitions
    )
    {
        return SnapshotTransportPlanner.partitionActorModelDefinitions(gson, definitions);
    }

    static LinkedHashSet<Integer> collectTextureIds(SceneSnapshotPayload snapshot)
    {
        return SnapshotTransportPlanner.collectTextureIds(snapshot);
    }

    static LinkedHashSet<Integer> collectTextureIds(
        SceneSnapshotPayload snapshot,
        List<ObjectModelDefinitionPayload> objectModels
    )
    {
        return SnapshotTransportPlanner.collectTextureIds(snapshot, objectModels);
    }

    static SnapshotTransportBundle splitModels(SceneSnapshotPayload snapshot)
    {
        return SnapshotTransportPlanner.splitModels(snapshot);
    }

    static String modelKeyForModel(TileSurfaceModelPayload model)
    {
        return SnapshotTransportPlanner.modelKeyForModel(model);
    }

    static String modelKeyForModel(TileSurfaceModelPayload model, String prefix)
    {
        return SnapshotTransportPlanner.modelKeyForModel(model, prefix);
    }

    private void clearSentState()
    {
        if (snapshotPublisher != null)
        {
            snapshotPublisher.clearState();
        }
    }

    @Provides
    RuneXrConfig provideConfig(ConfigManager configManager)
    {
        return configManager.getConfig(RuneXrConfig.class);
    }

    record SnapshotTransportBundle(
        SceneSnapshotPayload snapshot,
        List<ActorModelDefinitionPayload> actorModelDefinitions,
        List<ObjectModelDefinitionPayload> objectModelDefinitions
    )
    {
    }
}
