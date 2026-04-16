package dev.rune.xr.runelite;

import com.google.gson.Gson;
import com.google.inject.Provides;
import dev.rune.xr.runelite.config.RuneXrConfig;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.service.BridgeClientService;
import dev.rune.xr.runelite.service.SceneExtractor;
import dev.rune.xr.runelite.service.SyntheticSceneFactory;
import java.util.Optional;
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

    @Override
    protected void startUp()
    {
        bridgeClient = new BridgeClientService(gson);
        sceneExtractor = new SceneExtractor(client);
        syntheticSceneFactory = new SyntheticSceneFactory();
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

        lastSnapshotPayload = null;
    }

    @Subscribe
    public void onConfigChanged(ConfigChanged event)
    {
        if (!"runexr".equals(event.getGroup()))
        {
            return;
        }

        lastSnapshotPayload = null;

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
        String payload = gson.toJson(snapshot);

        if (payload.equals(lastSnapshotPayload))
        {
            return;
        }

        if (bridgeClient.sendSnapshot(config, snapshot))
        {
            lastSnapshotPayload = payload;
        }
    }

    @Provides
    RuneXrConfig provideConfig(ConfigManager configManager)
    {
        return configManager.getConfig(RuneXrConfig.class);
    }
}
