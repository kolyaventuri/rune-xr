package dev.rune.xr.runelite;

import com.google.gson.Gson;
import com.google.inject.Provides;
import dev.rune.xr.runelite.config.RuneXrConfig;
import dev.rune.xr.runelite.model.ActorModelBatchPayload;
import dev.rune.xr.runelite.model.ActorModelDefinitionPayload;
import dev.rune.xr.runelite.model.ActorPayload;
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
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
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
import net.runelite.api.AABB;
import net.runelite.api.Client;
import net.runelite.api.Model;
import net.runelite.client.callback.ClientThread;
import net.runelite.client.config.ConfigManager;
import net.runelite.client.eventbus.Subscribe;
import net.runelite.client.events.ConfigChanged;
import net.runelite.client.plugins.Plugin;
import net.runelite.client.plugins.PluginDescriptor;
import net.runelite.api.coords.LocalPoint;
import net.runelite.api.coords.WorldPoint;
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
    private static final int COORDINATE_DUMP_TILE_RADIUS = 1;

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
    private final Set<String> sentActorModelKeys = new LinkedHashSet<>();
    private final Set<String> sentObjectModelKeys = new LinkedHashSet<>();
    private final Set<Integer> sentTextureIds = new LinkedHashSet<>();
    private final AtomicBoolean snapshotScheduled = new AtomicBoolean();

    @Override
    protected void startUp()
    {
        bridgeClient = new BridgeClientService(gson);
        sceneExtractor = new SceneExtractor(client);
        syntheticSceneFactory = new SyntheticSceneFactory();
        initializeCoordinateDump();
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
            case "coordinateDumpEnabled", "coordinateDumpPath" -> initializeCoordinateDump();
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
        SnapshotTransportBundle transportBundle = splitModels(snapshot);
        SceneSnapshotState snapshotState = SceneSnapshotState.fromSnapshot(transportBundle.snapshot());
        boolean shouldSendSnapshot = !snapshotState.equals(lastSnapshotState) || !bridgeClient.isConnected(config);

        if (shouldSendSnapshot)
        {
            maybeDumpCoordinates(snapshot);
        }

        if (!sendPendingActorModels(transportBundle.actorModelDefinitions()))
        {
            clearSentState();
            return;
        }

        if (!sendPendingObjectModels(transportBundle.objectModelDefinitions()))
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

        sendPendingTextures(transportBundle.snapshot(), transportBundle.objectModelDefinitions());
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

        List<List<ActorModelDefinitionPayload>> batches = partitionActorModelDefinitions(
            gson,
            new ArrayList<>(pendingDefinitions.values())
        );

        int sentBatches = 0;

        for (List<ActorModelDefinitionPayload> batch : batches)
        {
            if (sentBatches >= MAX_OBJECT_MODEL_BATCHES_PER_TICK)
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

    private void initializeCoordinateDump()
    {
        Path path = coordinateDumpPath();

        if (path == null)
        {
            return;
        }

        try
        {
            Path parent = path.getParent();

            if (parent != null)
            {
                Files.createDirectories(parent);
            }

            if (config.coordinateDumpEnabled())
            {
                Files.writeString(path, "", StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
                log.info("Rune XR coordinate dump enabled: {}", path);
            }
        }
        catch (IOException exception)
        {
            log.warn("Unable to initialize Rune XR coordinate dump at {}", path, exception);
        }
    }

    private void maybeDumpCoordinates(SceneSnapshotPayload snapshot)
    {
        if (!config.coordinateDumpEnabled())
        {
            return;
        }

        Path path = coordinateDumpPath();

        if (path == null)
        {
            return;
        }

        ActorPayload self = snapshot.actors().stream()
            .filter(actor -> "self".equals(actor.type()))
            .findFirst()
            .orElse(null);

        if (self == null)
        {
            return;
        }

        var localPlayer = client.getLocalPlayer();
        LocalPoint localPoint = localPlayer == null ? null : localPlayer.getLocalLocation();
        WorldPoint renderedWorldPoint = localPoint == null ? null : WorldPoint.fromLocalInstance(client, localPoint, client.getPlane());
        WorldPoint serverWorldPoint = localPlayer == null ? null : localPlayer.getWorldLocation();
        Model liveModel = localPlayer == null ? null : localPlayer.getModel();
        AABB liveModelBounds = liveModel == null ? null : liveModel.getAABB(localPlayer.getCurrentOrientation());
        CoordinateDumpRecord record = new CoordinateDumpRecord(
            System.currentTimeMillis(),
            snapshot.baseX(),
            snapshot.baseY(),
            snapshot.plane(),
            new DumpActor(
                self.id(),
                self.name(),
                self.x(),
                self.y(),
                self.preciseX(),
                self.preciseY(),
                self.rotationDegrees(),
                self.size(),
                self.modelKey(),
                boundsForModel(self.model())
            ),
            localPoint == null ? null : new DumpLocalPoint(
                localPoint.getX(),
                localPoint.getY(),
                localPoint.getSceneX(),
                localPoint.getSceneY()
            ),
            pointDump(renderedWorldPoint),
            pointDump(serverWorldPoint),
            liveModelBounds == null ? null : new DumpAabb(
                liveModelBounds.getCenterX(),
                liveModelBounds.getCenterY(),
                liveModelBounds.getCenterZ(),
                liveModelBounds.getExtremeX(),
                liveModelBounds.getExtremeY(),
                liveModelBounds.getExtremeZ()
            ),
            nearbyTiles(snapshot, self.x(), self.y(), COORDINATE_DUMP_TILE_RADIUS)
        );

        try
        {
            Files.writeString(
                path,
                gson.toJson(record) + System.lineSeparator(),
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.APPEND
            );
        }
        catch (IOException exception)
        {
            log.warn("Unable to append Rune XR coordinate dump to {}", path, exception);
        }
    }

    private Path coordinateDumpPath()
    {
        String configuredPath = config.coordinateDumpPath();

        if (configuredPath == null || configuredPath.isBlank())
        {
            return null;
        }

        return Path.of(configuredPath.trim());
    }

    private static DumpPoint pointDump(WorldPoint point)
    {
        if (point == null)
        {
            return null;
        }

        return new DumpPoint(point.getX(), point.getY(), point.getPlane());
    }

    private static DumpModelBounds boundsForModel(TileSurfaceModelPayload model)
    {
        if (model == null || model.vertices().isEmpty())
        {
            return null;
        }

        int minX = Integer.MAX_VALUE;
        int maxX = Integer.MIN_VALUE;
        int minY = Integer.MAX_VALUE;
        int maxY = Integer.MIN_VALUE;
        int minZ = Integer.MAX_VALUE;
        int maxZ = Integer.MIN_VALUE;

        for (var vertex : model.vertices())
        {
            minX = Math.min(minX, vertex.x());
            maxX = Math.max(maxX, vertex.x());
            minY = Math.min(minY, vertex.y());
            maxY = Math.max(maxY, vertex.y());
            minZ = Math.min(minZ, vertex.z());
            maxZ = Math.max(maxZ, vertex.z());
        }

        return new DumpModelBounds(
            minX,
            maxX,
            (minX + maxX) / 2.0d,
            minY,
            maxY,
            minZ,
            maxZ,
            (minZ + maxZ) / 2.0d,
            model.vertices().size()
        );
    }

    private static List<DumpTile> nearbyTiles(SceneSnapshotPayload snapshot, int centerX, int centerY, int radius)
    {
        return snapshot.tiles().stream()
            .filter(tile -> Math.abs(tile.x() - centerX) <= radius && Math.abs(tile.y() - centerY) <= radius)
            .sorted((left, right) ->
            {
                int byY = Integer.compare(right.y(), left.y());

                if (byY != 0)
                {
                    return byY;
                }

                return Integer.compare(left.x(), right.x());
            })
            .map(tile -> new DumpTile(
                tile.x(),
                tile.y(),
                tile.height(),
                tile.surface() != null && tile.surface().hasBridge(),
                tile.surface() == null ? null : tile.surface().bridgeHeight(),
                tile.surface() == null ? null : tile.surface().renderLevel()
            ))
            .toList();
    }

    private record CoordinateDumpRecord(
        long capturedAt,
        int baseX,
        int baseY,
        int plane,
        DumpActor self,
        DumpLocalPoint localPoint,
        DumpPoint renderedWorldPoint,
        DumpPoint serverWorldPoint,
        DumpAabb liveModelAabb,
        List<DumpTile> nearbyTiles
    )
    {
    }

    private record DumpActor(
        String id,
        String name,
        int x,
        int y,
        Double preciseX,
        Double preciseY,
        Integer rotationDegrees,
        Integer size,
        String modelKey,
        DumpModelBounds extractedModelBounds
    )
    {
    }

    private record DumpLocalPoint(int x, int y, int sceneX, int sceneY)
    {
    }

    private record DumpPoint(int x, int y, int plane)
    {
    }

    private record DumpAabb(int centerX, int centerY, int centerZ, int extremeX, int extremeY, int extremeZ)
    {
    }

    private record DumpModelBounds(
        int minX,
        int maxX,
        double centerX,
        int minY,
        int maxY,
        int minZ,
        int maxZ,
        double centerZ,
        int vertexCount
    )
    {
    }

    private record DumpTile(int x, int y, int height, boolean hasBridge, Integer bridgeHeight, Integer renderLevel)
    {
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

    static List<List<ActorModelDefinitionPayload>> partitionActorModelDefinitions(Gson gson, List<ActorModelDefinitionPayload> definitions)
    {
        List<List<ActorModelDefinitionPayload>> batches = new ArrayList<>();
        List<ActorModelDefinitionPayload> currentBatch = new ArrayList<>();
        int currentChars = 0;

        for (ActorModelDefinitionPayload definition : definitions)
        {
            int estimatedChars = estimateActorModelDefinitionChars(gson, definition);

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

    private static int estimateActorModelDefinitionChars(Gson gson, ActorModelDefinitionPayload definition)
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

    static SnapshotTransportBundle splitModels(SceneSnapshotPayload snapshot)
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

        return new SnapshotTransportBundle(
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
        sentActorModelKeys.clear();
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
        List<ActorModelDefinitionPayload> actorModelDefinitions,
        List<ObjectModelDefinitionPayload> objectModelDefinitions
    )
    {
    }
}
