package dev.rune.xr.runelite.service;

import com.google.gson.Gson;
import dev.rune.xr.runelite.config.RuneXrConfig;
import dev.rune.xr.runelite.model.ObjectModelBatchPayload;
import dev.rune.xr.runelite.model.ObjectModelDefinitionPayload;
import dev.rune.xr.runelite.model.ProtocolMessages;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.model.SceneObjectPayload;
import dev.rune.xr.runelite.model.TextureBatchPayload;
import dev.rune.xr.runelite.model.TextureDefinitionPayload;
import dev.rune.xr.runelite.model.TilePayload;
import dev.rune.xr.runelite.model.TileSurfacePayload;
import dev.rune.xr.runelite.model.TileSurfaceModelPayload;
import java.nio.charset.StandardCharsets;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class BridgeClientService implements AutoCloseable
{
    private static final Logger log = LoggerFactory.getLogger(BridgeClientService.class);
    private static final long CONNECT_TIMEOUT_SECONDS = 5L;
    private static final long MAX_WEBSOCKET_QUEUE_BYTES = 16L * 1024L * 1024L;
    private static final long MAX_SNAPSHOT_PAYLOAD_BYTES = MAX_WEBSOCKET_QUEUE_BYTES / 2L;

    private final Gson gson;
    private final OkHttpClient httpClient;
    private WebSocket socket;
    private URI connectedUri;
    private SocketListener listener;
    private long nextConnectionId = 1L;

    public BridgeClientService(Gson gson)
    {
        this.gson = gson;
        this.httpClient = new OkHttpClient();
    }

    public synchronized void ensureConnected(RuneXrConfig config)
    {
        URI targetUri = buildTargetUri(config);

        if (isSocketOpen(targetUri))
        {
            return;
        }

        closeCurrentSocket();

        long connectionId = nextConnectionId++;
        SocketListener nextListener = new SocketListener(
            connectionId,
            targetUri,
            gson.toJson(ProtocolMessages.HelloMessage.plugin("runelite-plugin"))
        );
        Request request = new Request.Builder()
            .url(targetUri.toString())
            .build();

        log.debug("Opening Rune XR bridge socket #{} to {}", connectionId, targetUri);
        socket = httpClient.newWebSocket(request, nextListener);
        connectedUri = targetUri;
        listener = nextListener;
        nextListener.awaitOpen();
    }

    public synchronized boolean isConnected(RuneXrConfig config)
    {
        return isSocketOpen(buildTargetUri(config));
    }

    public synchronized SceneSnapshotPayload sendSnapshot(RuneXrConfig config, SceneSnapshotPayload snapshot)
    {
        try
        {
            ensureConnected(config);
            PreparedSnapshot preparedSnapshot = prepareSnapshotPayload(gson, snapshot, MAX_SNAPSHOT_PAYLOAD_BYTES);
            logSnapshotSend(preparedSnapshot);
            sendMessage("scene_snapshot", preparedSnapshot.payload());
            return preparedSnapshot.snapshot();
        }
        catch (RuntimeException exception)
        {
            log.debug("Unable to send Rune XR snapshot to {}:{}", config.bridgeHost(), config.bridgePort(), exception);
            closeCurrentSocket();
            return null;
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
            sendMessage("texture_batch", payload);
            return true;
        }
        catch (RuntimeException exception)
        {
            log.debug("Unable to send Rune XR textures to {}:{}", config.bridgeHost(), config.bridgePort(), exception);
            closeCurrentSocket();
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
            sendMessage("object_model_batch", payload);
            return true;
        }
        catch (RuntimeException exception)
        {
            log.debug("Unable to send Rune XR object models to {}:{}", config.bridgeHost(), config.bridgePort(), exception);
            closeCurrentSocket();
            return false;
        }
    }

    public synchronized void resetConnection()
    {
        closeCurrentSocket();
    }

    private static URI buildTargetUri(RuneXrConfig config)
    {
        return URI.create(String.format("ws://%s:%d/ws", config.bridgeHost(), config.bridgePort()));
    }

    @Override
    public synchronized void close()
    {
        closeCurrentSocket();
    }

    private boolean isSocketOpen(URI targetUri)
    {
        return socket != null
            && targetUri.equals(connectedUri)
            && listener != null
            && listener.isOpen();
    }

    private void sendMessage(String kind, String payload)
    {
        if (socket == null || listener == null || !listener.isOpen())
        {
            throw new IllegalStateException("Rune XR bridge socket is not open");
        }

        long queueSizeBefore = socket.queueSize();

        if (listener.shouldLogSend(kind, queueSizeBefore))
        {
            log.debug(
                "Sending Rune XR {} on connection #{} (chars={}, queueSizeBefore={}, sentMessages={})",
                kind,
                listener.connectionId(),
                payload.length(),
                queueSizeBefore,
                listener.sentMessageCount()
            );
        }

        if (!socket.send(payload))
        {
            log.debug(
                "Rune XR {} send rejected on connection #{} (chars={}, queueSizeBefore={}, sentMessages={}, lastAcceptedKind={}, lastAcceptedChars={})",
                kind,
                listener.connectionId(),
                payload.length(),
                queueSizeBefore,
                listener.sentMessageCount(),
                listener.lastAcceptedKind(),
                listener.lastAcceptedChars()
            );
            throw new IllegalStateException("Rune XR bridge socket rejected the outbound message");
        }

        listener.recordAcceptedSend(kind, payload.length());
    }

    private synchronized void closeCurrentSocket()
    {
        WebSocket currentSocket = socket;
        SocketListener currentListener = listener;

        socket = null;
        connectedUri = null;
        listener = null;

        if (currentListener != null)
        {
            currentListener.markClosing();
        }

        if (currentSocket == null)
        {
            return;
        }

        if (!currentSocket.close(1000, "shutdown"))
        {
            currentSocket.cancel();
        }
    }

    private synchronized void clearSocket(WebSocket candidate)
    {
        if (socket != candidate)
        {
            return;
        }

        socket = null;
        connectedUri = null;
        listener = null;
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

    private static long utf8Bytes(String payload)
    {
        return payload.getBytes(StandardCharsets.UTF_8).length;
    }

    private static SnapshotStats snapshotStats(SceneSnapshotPayload snapshot)
    {
        int tileModelCount = 0;
        int objectModelCount = 0;
        long vertexCount = 0;
        long faceCount = 0;

        for (TilePayload tile : snapshot.tiles())
        {
            TileSurfaceModelPayload model = tile.surface() == null ? null : tile.surface().model();

            if (model == null)
            {
                continue;
            }

            tileModelCount += 1;
            vertexCount += model.vertices().size();
            faceCount += model.faces().size();
        }

        for (SceneObjectPayload object : snapshot.objects())
        {
            TileSurfaceModelPayload model = object.model();

            if (model == null)
            {
                continue;
            }

            objectModelCount += 1;
            vertexCount += model.vertices().size();
            faceCount += model.faces().size();
        }

        return new SnapshotStats(
            snapshot.tiles().size(),
            snapshot.actors().size(),
            snapshot.objects().size(),
            tileModelCount,
            objectModelCount,
            vertexCount,
            faceCount
        );
    }

    static PreparedSnapshot prepareSnapshotPayload(Gson gson, SceneSnapshotPayload snapshot, long targetPayloadBytes)
    {
        SnapshotCandidate fullSnapshot = snapshotCandidate(gson, snapshot, SnapshotVariant.FULL);

        if (fullSnapshot.payloadBytes() <= targetPayloadBytes)
        {
            return PreparedSnapshot.from(fullSnapshot, fullSnapshot);
        }

        SnapshotCandidate withoutObjectModels = snapshotCandidate(
            gson,
            stripObjectModels(snapshot),
            SnapshotVariant.WITHOUT_OBJECT_MODELS
        );

        if (withoutObjectModels.payloadBytes() <= targetPayloadBytes)
        {
            return PreparedSnapshot.from(withoutObjectModels, fullSnapshot);
        }

        SnapshotCandidate withoutTileAndObjectModels = snapshotCandidate(
            gson,
            stripTileSurfaceModels(withoutObjectModels.snapshot()),
            SnapshotVariant.WITHOUT_TILE_AND_OBJECT_MODELS
        );

        return PreparedSnapshot.from(withoutTileAndObjectModels, fullSnapshot);
    }

    private static SnapshotCandidate snapshotCandidate(Gson gson, SceneSnapshotPayload snapshot, SnapshotVariant variant)
    {
        String payload = gson.toJson(ProtocolMessages.SceneSnapshotMessage.fromSnapshot(snapshot));
        return new SnapshotCandidate(
            snapshot,
            payload,
            utf8Bytes(payload),
            variant,
            snapshotStats(snapshot)
        );
    }

    private static SceneSnapshotPayload stripObjectModels(SceneSnapshotPayload snapshot)
    {
        boolean changed = false;
        List<SceneObjectPayload> objects = new ArrayList<>(snapshot.objects().size());

        for (SceneObjectPayload object : snapshot.objects())
        {
            if (object.model() == null)
            {
                objects.add(object);
                continue;
            }

            changed = true;
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
                object.modelKey(),
                null
            ));
        }

        if (!changed)
        {
            return snapshot;
        }

        return new SceneSnapshotPayload(
            snapshot.version(),
            snapshot.timestamp(),
            snapshot.baseX(),
            snapshot.baseY(),
            snapshot.plane(),
            snapshot.tiles(),
            snapshot.actors(),
            List.copyOf(objects)
        );
    }

    private static SceneSnapshotPayload stripTileSurfaceModels(SceneSnapshotPayload snapshot)
    {
        boolean changed = false;
        List<TilePayload> tiles = new ArrayList<>(snapshot.tiles().size());

        for (TilePayload tile : snapshot.tiles())
        {
            TileSurfacePayload surface = tile.surface();

            if (surface == null || surface.model() == null)
            {
                tiles.add(tile);
                continue;
            }

            changed = true;
            tiles.add(new TilePayload(
                tile.x(),
                tile.y(),
                tile.plane(),
                tile.height(),
                new TileSurfacePayload(
                    surface.rgb(),
                    surface.texture(),
                    surface.overlayId(),
                    surface.underlayId(),
                    surface.shape(),
                    surface.renderLevel(),
                    surface.hasBridge(),
                    surface.bridgeHeight(),
                    null
                )
            ));
        }

        if (!changed)
        {
            return snapshot;
        }

        return new SceneSnapshotPayload(
            snapshot.version(),
            snapshot.timestamp(),
            snapshot.baseX(),
            snapshot.baseY(),
            snapshot.plane(),
            List.copyOf(tiles),
            snapshot.actors(),
            snapshot.objects()
        );
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
        private static PreparedSnapshot from(SnapshotCandidate selected, SnapshotCandidate original)
        {
            return new PreparedSnapshot(
                selected.snapshot(),
                selected.payload(),
                selected.payloadBytes(),
                selected.variant(),
                selected.stats(),
                original.payloadBytes(),
                original.stats()
            );
        }
    }

    private record SnapshotCandidate(
        SceneSnapshotPayload snapshot,
        String payload,
        long payloadBytes,
        SnapshotVariant variant,
        SnapshotStats stats
    )
    {
    }

    private record SnapshotStats(
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

    private final class SocketListener extends WebSocketListener
    {
        private final long connectionId;
        private final URI targetUri;
        private final String helloPayload;
        private final CompletableFuture<Void> openFuture = new CompletableFuture<>();
        private volatile boolean open;
        private volatile boolean closing;
        private volatile long sentMessageCount;
        private volatile String lastAcceptedKind = "none";
        private volatile int lastAcceptedChars;

        private SocketListener(long connectionId, URI targetUri, String helloPayload)
        {
            this.connectionId = connectionId;
            this.targetUri = targetUri;
            this.helloPayload = helloPayload;
        }

        private long connectionId()
        {
            return connectionId;
        }

        private boolean isOpen()
        {
            return open && !closing;
        }

        private boolean isClosing()
        {
            return closing;
        }

        private long sentMessageCount()
        {
            return sentMessageCount;
        }

        private String lastAcceptedKind()
        {
            return lastAcceptedKind;
        }

        private int lastAcceptedChars()
        {
            return lastAcceptedChars;
        }

        private void recordAcceptedSend(String kind, int chars)
        {
            lastAcceptedKind = kind;
            lastAcceptedChars = chars;
            sentMessageCount += 1;
        }

        private boolean shouldLogSend(String kind, long queueSizeBefore)
        {
            return sentMessageCount < 5
                || queueSizeBefore > 0
                || "texture_batch".equals(kind);
        }

        private void markClosing()
        {
            closing = true;
            open = false;

            if (!openFuture.isDone())
            {
                openFuture.completeExceptionally(new IllegalStateException("Rune XR bridge socket closed before opening"));
            }
        }

        private void awaitOpen()
        {
            openFuture.orTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS).join();
        }

        @Override
        public void onOpen(WebSocket webSocket, Response response)
        {
            log.debug("Rune XR bridge socket #{} opened for {}", connectionId, targetUri);

            if (!webSocket.send(helloPayload))
            {
                log.debug("Rune XR bridge socket #{} failed to send hello payload", connectionId);
                openFuture.completeExceptionally(new IllegalStateException("Unable to send Rune XR bridge hello message"));
                webSocket.cancel();
                return;
            }

            open = true;
            log.debug("Rune XR bridge socket #{} sent hello payload (chars={})", connectionId, helloPayload.length());
            openFuture.complete(null);
        }

        @Override
        public void onClosing(WebSocket webSocket, int code, String reason)
        {
            closing = true;
            open = false;
            log.debug(
                "Rune XR bridge socket #{} closing for {} (code={}, reason={}, sentMessages={}, lastAcceptedKind={}, lastAcceptedChars={}, queueSize={})",
                connectionId,
                targetUri,
                code,
                reason,
                sentMessageCount,
                lastAcceptedKind,
                lastAcceptedChars,
                webSocket.queueSize()
            );
            clearSocket(webSocket);
            webSocket.close(code, reason);

            if (!openFuture.isDone())
            {
                openFuture.completeExceptionally(new IllegalStateException(
                    String.format("Rune XR bridge socket closing during connect (%d: %s)", code, reason)
                ));
            }
        }

        @Override
        public void onClosed(WebSocket webSocket, int code, String reason)
        {
            closing = true;
            open = false;
            log.debug(
                "Rune XR bridge socket #{} closed for {} (code={}, reason={}, sentMessages={}, lastAcceptedKind={}, lastAcceptedChars={}, queueSize={})",
                connectionId,
                targetUri,
                code,
                reason,
                sentMessageCount,
                lastAcceptedKind,
                lastAcceptedChars,
                webSocket.queueSize()
            );
            clearSocket(webSocket);

            if (!openFuture.isDone())
            {
                openFuture.completeExceptionally(new IllegalStateException(
                    String.format("Rune XR bridge socket closed during connect (%d: %s)", code, reason)
                ));
            }
        }

        @Override
        public void onFailure(WebSocket webSocket, Throwable throwable, Response response)
        {
            closing = true;
            open = false;
            clearSocket(webSocket);

            if (!openFuture.isDone())
            {
                openFuture.completeExceptionally(throwable);
            }

            if (response == null)
            {
                log.debug(
                    "Rune XR bridge socket #{} failure for {} (sentMessages={}, lastAcceptedKind={}, lastAcceptedChars={}, queueSize={}, open={}, closing={})",
                    connectionId,
                    targetUri,
                    sentMessageCount,
                    lastAcceptedKind,
                    lastAcceptedChars,
                    webSocket.queueSize(),
                    open,
                    closing,
                    throwable
                );
                return;
            }

            log.debug(
                "Rune XR bridge socket #{} failure for {} (HTTP {}, sentMessages={}, lastAcceptedKind={}, lastAcceptedChars={}, queueSize={}, open={}, closing={})",
                connectionId,
                targetUri,
                response.code(),
                sentMessageCount,
                lastAcceptedKind,
                lastAcceptedChars,
                webSocket.queueSize(),
                open,
                closing,
                throwable
            );
        }
    }
}
