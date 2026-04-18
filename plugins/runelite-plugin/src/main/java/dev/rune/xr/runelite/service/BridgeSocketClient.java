package dev.rune.xr.runelite.service;

import com.google.gson.Gson;
import dev.rune.xr.runelite.config.RuneXrConfig;
import dev.rune.xr.runelite.model.ProtocolMessages;
import java.net.URI;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

final class BridgeSocketClient implements AutoCloseable
{
    private static final Logger log = LoggerFactory.getLogger(BridgeSocketClient.class);
    private static final long CONNECT_TIMEOUT_SECONDS = 5L;

    private final Gson gson;
    private final OkHttpClient httpClient;
    private WebSocket socket;
    private URI connectedUri;
    private SocketListener listener;
    private long nextConnectionId = 1L;

    BridgeSocketClient(Gson gson)
    {
        this.gson = gson;
        this.httpClient = new OkHttpClient();
    }

    synchronized void ensureConnected(RuneXrConfig config)
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

    synchronized boolean isConnected(RuneXrConfig config)
    {
        return isSocketOpen(buildTargetUri(config));
    }

    synchronized void sendMessage(String kind, String payload)
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

    synchronized void resetConnection()
    {
        closeCurrentSocket();
    }

    @Override
    public synchronized void close()
    {
        closeCurrentSocket();
    }

    private static URI buildTargetUri(RuneXrConfig config)
    {
        return URI.create(String.format("ws://%s:%d/ws", config.bridgeHost(), config.bridgePort()));
    }

    private boolean isSocketOpen(URI targetUri)
    {
        return socket != null
            && targetUri.equals(connectedUri)
            && listener != null
            && listener.isOpen();
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
                || "texture_batch".equals(kind)
                || "actor_model_batch".equals(kind);
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
