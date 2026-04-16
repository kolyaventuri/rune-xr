package dev.rune.xr.runelite;

import com.google.gson.Gson;
import com.google.inject.Provides;
import dev.rune.xr.runelite.config.RuneXrConfig;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.model.TextureBatchPayload;
import dev.rune.xr.runelite.model.TextureDefinitionPayload;
import dev.rune.xr.runelite.service.BridgeClientService;
import dev.rune.xr.runelite.service.SceneExtractor;
import dev.rune.xr.runelite.service.SyntheticSceneFactory;
import java.util.LinkedHashSet;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
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
    private String lastSnapshotPayload;
    private final Set<Integer> sentTextureIds = new LinkedHashSet<>();

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
            () -> clientThread.invoke(this::publishSnapshot),
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
    }

    private void publishSnapshot()
    {
        Optional<SceneSnapshotPayload> snapshot = config.syntheticMode()
            ? Optional.of(syntheticSceneFactory.nextSnapshot(config.tileRadius()))
            : sceneExtractor.extract(config.tileRadius());

        snapshot.ifPresent(this::sendIfChanged);
    }

    private void sendIfChanged(SceneSnapshotPayload snapshot)
    {
        sendPendingTextures(snapshot);

        String payload = gson.toJson(snapshot);

        if (payload.equals(lastSnapshotPayload))
        {
            return;
        }

        if (bridgeClient.sendSnapshot(config, snapshot))
        {
            lastSnapshotPayload = payload;
            return;
        }

        clearSentState();
    }

    private void sendPendingTextures(SceneSnapshotPayload snapshot)
    {
        if (config.syntheticMode())
        {
            return;
        }

        LinkedHashSet<Integer> pendingTextureIds = collectTextureIds(snapshot);
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

        if (!bridgeClient.sendTextureBatch(config, new TextureBatchPayload(definitions)))
        {
            clearSentState();
            return;
        }

        for (TextureDefinitionPayload definition : definitions)
        {
            sentTextureIds.add(definition.id());
        }
    }

    private LinkedHashSet<Integer> collectTextureIds(SceneSnapshotPayload snapshot)
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

        return textureIds;
    }

    private void clearSentState()
    {
        lastSnapshotPayload = null;
        sentTextureIds.clear();
    }

    @Provides
    RuneXrConfig provideConfig(ConfigManager configManager)
    {
        return configManager.getConfig(RuneXrConfig.class);
    }
}
