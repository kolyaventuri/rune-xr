package dev.rune.xr.runelite.service;

import com.google.gson.Gson;
import dev.rune.xr.runelite.config.RuneXrConfig;
import dev.rune.xr.runelite.model.ActorModelBatchPayload;
import dev.rune.xr.runelite.model.ActorModelDefinitionPayload;
import dev.rune.xr.runelite.model.ActorsFramePayload;
import dev.rune.xr.runelite.model.ObjectModelBatchPayload;
import dev.rune.xr.runelite.model.ObjectModelDefinitionPayload;
import dev.rune.xr.runelite.model.ObjectsSnapshotPayload;
import dev.rune.xr.runelite.model.ProtocolMessages;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.model.TerrainSnapshotPayload;
import dev.rune.xr.runelite.model.TextureBatchPayload;
import dev.rune.xr.runelite.model.TextureDefinitionPayload;
import java.nio.charset.StandardCharsets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class BridgeClientService implements AutoCloseable
{
    private static final Logger log = LoggerFactory.getLogger(BridgeClientService.class);
    private static final long MAX_WEBSOCKET_QUEUE_BYTES = 16L * 1024L * 1024L;
    private static final long MAX_SNAPSHOT_PAYLOAD_BYTES = MAX_WEBSOCKET_QUEUE_BYTES / 2L;

    private final Gson gson;
    private final BridgeSocketClient socketClient;

    public BridgeClientService(Gson gson)
    {
        this.gson = gson;
        this.socketClient = new BridgeSocketClient(gson);
    }

    public synchronized void ensureConnected(RuneXrConfig config)
    {
        socketClient.ensureConnected(config);
    }

    public synchronized boolean isConnected(RuneXrConfig config)
    {
        return socketClient.isConnected(config);
    }

    public synchronized SceneSnapshotPayload sendSnapshot(RuneXrConfig config, SceneSnapshotPayload snapshot)
    {
        try
        {
            ensureConnected(config);
            PreparedSnapshot preparedSnapshot = prepareSnapshotPayload(gson, snapshot, MAX_SNAPSHOT_PAYLOAD_BYTES);
            logSnapshotSend(preparedSnapshot);
            socketClient.sendMessage("scene_snapshot", preparedSnapshot.payload());
            return preparedSnapshot.snapshot();
        }
        catch (RuntimeException exception)
        {
            log.debug("Unable to send Rune XR snapshot to {}:{}", config.bridgeHost(), config.bridgePort(), exception);
            socketClient.resetConnection();
            return null;
        }
    }

    public synchronized TerrainSnapshotPayload sendTerrainSnapshot(RuneXrConfig config, TerrainSnapshotPayload snapshot)
    {
        try
        {
            ensureConnected(config);
            String payload = gson.toJson(ProtocolMessages.TerrainSnapshotMessage.fromSnapshot(snapshot));
            logTerrainSnapshotSend(snapshot, payload);
            socketClient.sendMessage("terrain_snapshot", payload);
            return snapshot;
        }
        catch (RuntimeException exception)
        {
            log.debug("Unable to send Rune XR terrain snapshot to {}:{}", config.bridgeHost(), config.bridgePort(), exception);
            socketClient.resetConnection();
            return null;
        }
    }

    public synchronized boolean sendObjectsSnapshot(RuneXrConfig config, ObjectsSnapshotPayload snapshot)
    {
        try
        {
            ensureConnected(config);
            String payload = gson.toJson(ProtocolMessages.ObjectsSnapshotMessage.fromSnapshot(snapshot));
            logObjectsSnapshotSend(snapshot, payload);
            socketClient.sendMessage("objects_snapshot", payload);
            return true;
        }
        catch (RuntimeException exception)
        {
            log.debug("Unable to send Rune XR objects snapshot to {}:{}", config.bridgeHost(), config.bridgePort(), exception);
            socketClient.resetConnection();
            return false;
        }
    }

    public synchronized boolean sendActorsFrame(RuneXrConfig config, ActorsFramePayload frame)
    {
        try
        {
            ensureConnected(config);
            String payload = gson.toJson(ProtocolMessages.ActorsFrameMessage.fromFrame(frame));
            logActorsFrameSend(frame, payload);
            socketClient.sendMessage("actors_frame", payload);
            return true;
        }
        catch (RuntimeException exception)
        {
            log.debug("Unable to send Rune XR actors frame to {}:{}", config.bridgeHost(), config.bridgePort(), exception);
            socketClient.resetConnection();
            return false;
        }
    }

    public synchronized boolean sendTextureBatch(RuneXrConfig config, TextureBatchPayload textures)
    {
        if (textures.textures().isEmpty())
        {
            return true;
        }

        try
        {
            ensureConnected(config);
            String payload = gson.toJson(ProtocolMessages.TextureBatchMessage.fromTextures(textures));
            logTextureBatchSend(textures, payload);
            socketClient.sendMessage("texture_batch", payload);
            return true;
        }
        catch (RuntimeException exception)
        {
            log.debug("Unable to send Rune XR textures to {}:{}", config.bridgeHost(), config.bridgePort(), exception);
            socketClient.resetConnection();
            return false;
        }
    }

    public synchronized boolean sendObjectModelBatch(RuneXrConfig config, ObjectModelBatchPayload models)
    {
        if (models.models().isEmpty())
        {
            return true;
        }

        try
        {
            ensureConnected(config);
            String payload = gson.toJson(ProtocolMessages.ObjectModelBatchMessage.fromModels(models));
            logObjectModelBatchSend(models, payload);
            socketClient.sendMessage("object_model_batch", payload);
            return true;
        }
        catch (RuntimeException exception)
        {
            log.debug("Unable to send Rune XR object models to {}:{}", config.bridgeHost(), config.bridgePort(), exception);
            socketClient.resetConnection();
            return false;
        }
    }

    public synchronized boolean sendActorModelBatch(RuneXrConfig config, ActorModelBatchPayload models)
    {
        if (models.models().isEmpty())
        {
            return true;
        }

        try
        {
            ensureConnected(config);
            String payload = gson.toJson(ProtocolMessages.ActorModelBatchMessage.fromModels(models));
            logActorModelBatchSend(models, payload);
            socketClient.sendMessage("actor_model_batch", payload);
            return true;
        }
        catch (RuntimeException exception)
        {
            log.debug("Unable to send Rune XR actor models to {}:{}", config.bridgeHost(), config.bridgePort(), exception);
            socketClient.resetConnection();
            return false;
        }
    }

    public synchronized void resetConnection()
    {
        socketClient.resetConnection();
    }

    @Override
    public synchronized void close()
    {
        socketClient.close();
    }

    private void logSnapshotSend(PreparedSnapshot preparedSnapshot)
    {
        long payloadBytes = preparedSnapshot.payloadBytes();
        SnapshotStats stats = preparedSnapshot.stats();

        if (preparedSnapshot.variant() != SnapshotVariant.FULL)
        {
            SnapshotStats originalStats = preparedSnapshot.originalStats();
            log.debug(
                "Rune XR snapshot reduced for transport (variant={}, bytes={} -> {}, tileModels={} -> {}, objectModels={} -> {}, vertices={} -> {}, faces={} -> {})",
                preparedSnapshot.variant().logLabel(),
                preparedSnapshot.originalPayloadBytes(),
                payloadBytes,
                originalStats.tileModelCount(),
                stats.tileModelCount(),
                originalStats.objectModelCount(),
                stats.objectModelCount(),
                originalStats.vertexCount(),
                stats.vertexCount(),
                originalStats.faceCount(),
                stats.faceCount()
            );
        }

        if (payloadBytes > MAX_SNAPSHOT_PAYLOAD_BYTES)
        {
            log.warn(
                "Rune XR snapshot payload still exceeds preferred transport budget (bytes={}, budget={}, queueLimit={}, tiles={}, actors={}, objects={}, tileModels={}, objectModels={}, vertices={}, faces={}, variant={})",
                payloadBytes,
                MAX_SNAPSHOT_PAYLOAD_BYTES,
                MAX_WEBSOCKET_QUEUE_BYTES,
                stats.tileCount(),
                stats.actorCount(),
                stats.objectCount(),
                stats.tileModelCount(),
                stats.objectModelCount(),
                stats.vertexCount(),
                stats.faceCount(),
                preparedSnapshot.variant().logLabel()
            );
        }
        else if (payloadBytes > MAX_SNAPSHOT_PAYLOAD_BYTES / 2L)
        {
            log.debug(
                "Rune XR snapshot payload is large (bytes={}, queueLimit={}, tiles={}, actors={}, objects={}, tileModels={}, objectModels={}, vertices={}, faces={})",
                payloadBytes,
                MAX_SNAPSHOT_PAYLOAD_BYTES,
                stats.tileCount(),
                stats.actorCount(),
                stats.objectCount(),
                stats.tileModelCount(),
                stats.objectModelCount(),
                stats.vertexCount(),
                stats.faceCount()
            );
        }

        if (payloadBytes > MAX_WEBSOCKET_QUEUE_BYTES)
        {
            log.warn(
                "Rune XR snapshot payload exceeds OkHttp websocket queue limit (bytes={}, queueLimit={}, tiles={}, actors={}, objects={}, tileModels={}, objectModels={}, vertices={}, faces={})",
                payloadBytes,
                MAX_WEBSOCKET_QUEUE_BYTES,
                stats.tileCount(),
                stats.actorCount(),
                stats.objectCount(),
                stats.tileModelCount(),
                stats.objectModelCount(),
                stats.vertexCount(),
                stats.faceCount()
            );
        }
    }

    private void logTextureBatchSend(TextureBatchPayload textures, String payload)
    {
        long payloadBytes = utf8Bytes(payload);
        int pngChars = textures.textures().stream()
            .map(TextureDefinitionPayload::pngBase64)
            .mapToInt(String::length)
            .sum();

        if (payloadBytes > MAX_WEBSOCKET_QUEUE_BYTES / 2)
        {
            log.debug(
                "Rune XR texture batch payload is large (bytes={}, queueLimit={}, textures={}, pngChars={})",
                payloadBytes,
                MAX_WEBSOCKET_QUEUE_BYTES,
                textures.textures().size(),
                pngChars
            );
        }

        if (payloadBytes > MAX_WEBSOCKET_QUEUE_BYTES)
        {
            log.warn(
                "Rune XR texture batch payload exceeds OkHttp websocket queue limit (bytes={}, queueLimit={}, textures={}, pngChars={})",
                payloadBytes,
                MAX_WEBSOCKET_QUEUE_BYTES,
                textures.textures().size(),
                pngChars
            );
        }
    }

    private void logTerrainSnapshotSend(TerrainSnapshotPayload snapshot, String payload)
    {
        long payloadBytes = utf8Bytes(payload);

        if (payloadBytes > MAX_SNAPSHOT_PAYLOAD_BYTES / 2L)
        {
            log.debug(
                "Rune XR terrain snapshot payload is large (bytes={}, queueLimit={}, tiles={}, windowKey={})",
                payloadBytes,
                MAX_WEBSOCKET_QUEUE_BYTES,
                snapshot.tiles().size(),
                snapshot.windowKey()
            );
        }

        if (payloadBytes > MAX_WEBSOCKET_QUEUE_BYTES)
        {
            log.warn(
                "Rune XR terrain snapshot payload exceeds OkHttp websocket queue limit (bytes={}, queueLimit={}, tiles={}, windowKey={})",
                payloadBytes,
                MAX_WEBSOCKET_QUEUE_BYTES,
                snapshot.tiles().size(),
                snapshot.windowKey()
            );
        }
    }

    private void logObjectsSnapshotSend(ObjectsSnapshotPayload snapshot, String payload)
    {
        long payloadBytes = utf8Bytes(payload);

        if (payloadBytes > MAX_SNAPSHOT_PAYLOAD_BYTES / 2L)
        {
            log.debug(
                "Rune XR objects snapshot payload is large (bytes={}, queueLimit={}, objects={}, windowKey={})",
                payloadBytes,
                MAX_WEBSOCKET_QUEUE_BYTES,
                snapshot.objects().size(),
                snapshot.windowKey()
            );
        }

        if (payloadBytes > MAX_WEBSOCKET_QUEUE_BYTES)
        {
            log.warn(
                "Rune XR objects snapshot payload exceeds OkHttp websocket queue limit (bytes={}, queueLimit={}, objects={}, windowKey={})",
                payloadBytes,
                MAX_WEBSOCKET_QUEUE_BYTES,
                snapshot.objects().size(),
                snapshot.windowKey()
            );
        }
    }

    private void logActorsFrameSend(ActorsFramePayload frame, String payload)
    {
        long payloadBytes = utf8Bytes(payload);

        if (payloadBytes > MAX_SNAPSHOT_PAYLOAD_BYTES / 2L)
        {
            log.debug(
                "Rune XR actors frame payload is large (bytes={}, queueLimit={}, actors={}, windowKey={})",
                payloadBytes,
                MAX_WEBSOCKET_QUEUE_BYTES,
                frame.actors().size(),
                frame.windowKey()
            );
        }

        if (payloadBytes > MAX_WEBSOCKET_QUEUE_BYTES)
        {
            log.warn(
                "Rune XR actors frame payload exceeds OkHttp websocket queue limit (bytes={}, queueLimit={}, actors={}, windowKey={})",
                payloadBytes,
                MAX_WEBSOCKET_QUEUE_BYTES,
                frame.actors().size(),
                frame.windowKey()
            );
        }
    }

    private void logObjectModelBatchSend(ObjectModelBatchPayload models, String payload)
    {
        long payloadBytes = utf8Bytes(payload);
        long vertexCount = 0;
        long faceCount = 0;

        for (ObjectModelDefinitionPayload definition : models.models())
        {
            vertexCount += definition.model().vertices().size();
            faceCount += definition.model().faces().size();
        }

        if (payloadBytes > MAX_WEBSOCKET_QUEUE_BYTES / 2)
        {
            log.debug(
                "Rune XR object model batch payload is large (bytes={}, queueLimit={}, models={}, vertices={}, faces={})",
                payloadBytes,
                MAX_WEBSOCKET_QUEUE_BYTES,
                models.models().size(),
                vertexCount,
                faceCount
            );
        }

        if (payloadBytes > MAX_WEBSOCKET_QUEUE_BYTES)
        {
            log.warn(
                "Rune XR object model batch payload exceeds OkHttp websocket queue limit (bytes={}, queueLimit={}, models={}, vertices={}, faces={})",
                payloadBytes,
                MAX_WEBSOCKET_QUEUE_BYTES,
                models.models().size(),
                vertexCount,
                faceCount
            );
        }
    }

    private void logActorModelBatchSend(ActorModelBatchPayload models, String payload)
    {
        long payloadBytes = utf8Bytes(payload);
        long vertexCount = 0;
        long faceCount = 0;

        for (ActorModelDefinitionPayload definition : models.models())
        {
            vertexCount += definition.model().vertices().size();
            faceCount += definition.model().faces().size();
        }

        if (payloadBytes > MAX_WEBSOCKET_QUEUE_BYTES / 2)
        {
            log.debug(
                "Rune XR actor model batch payload is large (bytes={}, queueLimit={}, models={}, vertices={}, faces={})",
                payloadBytes,
                MAX_WEBSOCKET_QUEUE_BYTES,
                models.models().size(),
                vertexCount,
                faceCount
            );
        }

        if (payloadBytes > MAX_WEBSOCKET_QUEUE_BYTES)
        {
            log.warn(
                "Rune XR actor model batch payload exceeds OkHttp websocket queue limit (bytes={}, queueLimit={}, models={}, vertices={}, faces={})",
                payloadBytes,
                MAX_WEBSOCKET_QUEUE_BYTES,
                models.models().size(),
                vertexCount,
                faceCount
            );
        }
    }

    private static long utf8Bytes(String payload)
    {
        return payload.getBytes(StandardCharsets.UTF_8).length;
    }

    static PreparedSnapshot prepareSnapshotPayload(Gson gson, SceneSnapshotPayload snapshot, long targetPayloadBytes)
    {
        return BridgeSnapshotPayloadPreparer.prepareSnapshotPayload(gson, snapshot, targetPayloadBytes);
    }

    enum SnapshotVariant
    {
        FULL("full"),
        WITHOUT_OBJECT_MODELS("without-object-models"),
        WITHOUT_TILE_AND_OBJECT_MODELS("without-tile-and-object-models");

        private final String logLabel;

        SnapshotVariant(String logLabel)
        {
            this.logLabel = logLabel;
        }

        private String logLabel()
        {
            return logLabel;
        }
    }

    record PreparedSnapshot(
        SceneSnapshotPayload snapshot,
        String payload,
        long payloadBytes,
        SnapshotVariant variant,
        SnapshotStats stats,
        long originalPayloadBytes,
        SnapshotStats originalStats
    )
    {
    }

    record SnapshotStats(
        int tileCount,
        int actorCount,
        int objectCount,
        int tileModelCount,
        int objectModelCount,
        long vertexCount,
        long faceCount
    )
    {
    }
}
