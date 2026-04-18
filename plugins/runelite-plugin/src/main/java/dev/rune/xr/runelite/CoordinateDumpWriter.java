package dev.rune.xr.runelite;

import com.google.gson.Gson;
import dev.rune.xr.runelite.config.RuneXrConfig;
import dev.rune.xr.runelite.model.ActorPayload;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.model.TileSurfaceModelPayload;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.List;
import net.runelite.api.AABB;
import net.runelite.api.Client;
import net.runelite.api.Model;
import net.runelite.api.coords.LocalPoint;
import net.runelite.api.coords.WorldPoint;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

final class CoordinateDumpWriter
{
    private static final Logger log = LoggerFactory.getLogger(CoordinateDumpWriter.class);
    private static final int COORDINATE_DUMP_TILE_RADIUS = 1;

    private final Client client;
    private final RuneXrConfig config;
    private final Gson gson;

    CoordinateDumpWriter(Client client, RuneXrConfig config, Gson gson)
    {
        this.client = client;
        this.config = config;
        this.gson = gson;
    }

    void initialize()
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

    void maybeDump(SceneSnapshotPayload snapshot)
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
}
