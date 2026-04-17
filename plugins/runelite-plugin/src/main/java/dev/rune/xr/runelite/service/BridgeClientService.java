package dev.rune.xr.runelite.service;

import com.google.gson.Gson;
import dev.rune.xr.runelite.config.RuneXrConfig;
import dev.rune.xr.runelite.model.ProtocolMessages;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.model.TextureBatchPayload;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.util.concurrent.CompletionStage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class BridgeClientService implements AutoCloseable
{
    private static final Logger log = LoggerFactory.getLogger(BridgeClientService.class);

    private final Gson gson;
    private final HttpClient httpClient;
    private WebSocket socket;
    private URI connectedUri;

    public BridgeClientService(Gson gson)
    {
        this.gson = gson;
        this.httpClient = HttpClient.newHttpClient();
    }

    public void ensureConnected(RuneXrConfig config)
    {
        URI targetUri = buildTargetUri(config);

        if (socket != null && targetUri.equals(connectedUri) && !socket.isOutputClosed())
        {
            return;
        }

        close();
        socket = httpClient.newWebSocketBuilder().buildAsync(targetUri, new Listener()).join();
        connectedUri = targetUri;
        socket.sendText(gson.toJson(ProtocolMessages.HelloMessage.plugin("runelite-plugin")), true).join();
    }

    public boolean isConnected(RuneXrConfig config)
    {
        URI targetUri = buildTargetUri(config);
        return socket != null && targetUri.equals(connectedUri) && !socket.isOutputClosed();
    }

    public boolean sendSnapshot(RuneXrConfig config, SceneSnapshotPayload snapshot)
    {
        try
        {
            ensureConnected(config);
            socket.sendText(gson.toJson(ProtocolMessages.SceneSnapshotMessage.fromSnapshot(snapshot)), true).join();
            return true;
        }
        catch (RuntimeException exception)
        {
            log.debug("Unable to send Rune XR snapshot to {}:{}", config.bridgeHost(), config.bridgePort(), exception);
            close();
            return false;
        }
    }

    public boolean sendTextureBatch(RuneXrConfig config, TextureBatchPayload textures)
    {
        if (textures.textures().isEmpty())
        {
            return true;
        }

        try
        {
            ensureConnected(config);
            socket.sendText(gson.toJson(ProtocolMessages.TextureBatchMessage.fromTextures(textures)), true).join();
            return true;
        }
        catch (RuntimeException exception)
        {
            log.debug("Unable to send Rune XR textures to {}:{}", config.bridgeHost(), config.bridgePort(), exception);
            close();
            return false;
        }
    }

    public void resetConnection()
    {
        close();
    }

    private static URI buildTargetUri(RuneXrConfig config)
    {
        return URI.create(String.format("ws://%s:%d/ws", config.bridgeHost(), config.bridgePort()));
    }

    @Override
    public void close()
    {
        if (socket != null)
        {
            try
            {
                socket.sendClose(WebSocket.NORMAL_CLOSURE, "shutdown").join();
            }
            catch (RuntimeException exception)
            {
                socket.abort();
            }
            finally
            {
                socket = null;
                connectedUri = null;
            }
        }
    }

    private static final class Listener implements WebSocket.Listener
    {
        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last)
        {
            webSocket.request(1);
            return null;
        }

        @Override
        public void onOpen(WebSocket webSocket)
        {
            webSocket.request(1);
            WebSocket.Listener.super.onOpen(webSocket);
        }

        @Override
        public void onError(WebSocket webSocket, Throwable error)
        {
            log.debug("Rune XR bridge socket error", error);
            WebSocket.Listener.super.onError(webSocket, error);
        }
    }
}
