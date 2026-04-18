package dev.rune.xr.runelite.service;

import com.google.gson.Gson;
import dev.rune.xr.runelite.model.ProtocolMessages;
import dev.rune.xr.runelite.model.SceneObjectPayload;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.model.TilePayload;
import dev.rune.xr.runelite.model.TileSurfaceModelPayload;
import dev.rune.xr.runelite.model.TileSurfacePayload;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

final class BridgeSnapshotPayloadPreparer
{
    private BridgeSnapshotPayloadPreparer()
    {
    }

    static BridgeClientService.PreparedSnapshot prepareSnapshotPayload(
        Gson gson,
        SceneSnapshotPayload snapshot,
        long targetPayloadBytes
    )
    {
        SnapshotCandidate fullSnapshot = snapshotCandidate(gson, snapshot, BridgeClientService.SnapshotVariant.FULL);

        if (fullSnapshot.payloadBytes() <= targetPayloadBytes)
        {
            return preparedSnapshot(fullSnapshot, fullSnapshot);
        }

        SnapshotCandidate withoutObjectModels = snapshotCandidate(
            gson,
            stripObjectModels(snapshot),
            BridgeClientService.SnapshotVariant.WITHOUT_OBJECT_MODELS
        );

        if (withoutObjectModels.payloadBytes() <= targetPayloadBytes)
        {
            return preparedSnapshot(withoutObjectModels, fullSnapshot);
        }

        SnapshotCandidate withoutTileAndObjectModels = snapshotCandidate(
            gson,
            stripTileSurfaceModels(withoutObjectModels.snapshot()),
            BridgeClientService.SnapshotVariant.WITHOUT_TILE_AND_OBJECT_MODELS
        );

        return preparedSnapshot(withoutTileAndObjectModels, fullSnapshot);
    }

    private static BridgeClientService.PreparedSnapshot preparedSnapshot(
        SnapshotCandidate selected,
        SnapshotCandidate original
    )
    {
        return new BridgeClientService.PreparedSnapshot(
            selected.snapshot(),
            selected.payload(),
            selected.payloadBytes(),
            selected.variant(),
            selected.stats(),
            original.payloadBytes(),
            original.stats()
        );
    }

    private static SnapshotCandidate snapshotCandidate(
        Gson gson,
        SceneSnapshotPayload snapshot,
        BridgeClientService.SnapshotVariant variant
    )
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

    private static BridgeClientService.SnapshotStats snapshotStats(SceneSnapshotPayload snapshot)
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

        return new BridgeClientService.SnapshotStats(
            snapshot.tiles().size(),
            snapshot.actors().size(),
            snapshot.objects().size(),
            tileModelCount,
            objectModelCount,
            vertexCount,
            faceCount
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

    static long utf8Bytes(String payload)
    {
        return payload.getBytes(StandardCharsets.UTF_8).length;
    }

    private record SnapshotCandidate(
        SceneSnapshotPayload snapshot,
        String payload,
        long payloadBytes,
        BridgeClientService.SnapshotVariant variant,
        BridgeClientService.SnapshotStats stats
    )
    {
    }
}
