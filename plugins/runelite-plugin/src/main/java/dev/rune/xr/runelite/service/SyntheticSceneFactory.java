package dev.rune.xr.runelite.service;

import dev.rune.xr.runelite.model.ActorPayload;
import dev.rune.xr.runelite.model.ProtocolMessages;
import dev.rune.xr.runelite.model.SceneObjectPayload;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.model.TilePayload;
import java.util.ArrayList;
import java.util.List;

public final class SyntheticSceneFactory
{
    private int tick;

    public SceneSnapshotPayload nextSnapshot(int radius)
    {
        int baseX = 3200 - radius;
        int baseY = 3200 - radius;
        int size = radius * 2 + 1;
        List<TilePayload> tiles = new ArrayList<>();

        for (int x = 0; x < size; x++)
        {
            for (int y = 0; y < size; y++)
            {
                int height = 10 + (int) Math.round(Math.sin((x + tick) * 0.45) * 3 + Math.cos((y + tick) * 0.3) * 2);
                tiles.add(new TilePayload(baseX + x, baseY + y, 0, height, null));
            }
        }

        List<ActorPayload> actors = List.of(
            new ActorPayload("self_demo", "self", "Kolya", baseX + radius + (tick % 3) - 1, baseY + radius, 0),
            new ActorPayload("player_friend", "player", "Friend", baseX + radius - 2, baseY + radius - (tick % 2), 0),
            new ActorPayload("npc_guard", "npc", "Guard", baseX + radius + 2, baseY + radius + ((tick + 1) % 2), 0)
        );

        List<SceneObjectPayload> objects = List.of(
            new SceneObjectPayload(
                "game_tree_" + (baseX + 3) + "_" + (baseY + radius + 1),
                "game",
                "Tree",
                baseX + 3,
                baseY + radius + 1,
                0,
                1,
                1,
                null,
                null,
                null,
                null,
                null
            ),
            new SceneObjectPayload(
                "wall_house_sw",
                "wall",
                "Stone wall",
                baseX + radius - 1,
                baseY + radius - 1,
                0,
                null,
                null,
                null,
                1,
                8,
                null,
                null
            ),
            new SceneObjectPayload(
                "wall_house_nw",
                "wall",
                "Stone wall",
                baseX + radius - 1,
                baseY + radius,
                0,
                null,
                null,
                null,
                1,
                2,
                null,
                null
            ),
            new SceneObjectPayload(
                "wall_house_se",
                "wall",
                "Stone wall",
                baseX + radius,
                baseY + radius - 1,
                0,
                null,
                null,
                null,
                4,
                8,
                null,
                null
            ),
            new SceneObjectPayload(
                "wall_house_ne",
                "wall",
                "Stone wall",
                baseX + radius,
                baseY + radius,
                0,
                null,
                null,
                null,
                4,
                2,
                null,
                null
            ),
            new SceneObjectPayload(
                "decor_banner",
                "decor",
                "Banner",
                baseX + size - 3,
                baseY + radius - 2,
                0,
                null,
                null,
                180,
                null,
                null,
                null,
                null
            )
        );

        tick += 1;
        return new SceneSnapshotPayload(
            ProtocolMessages.VERSION,
            System.currentTimeMillis(),
            baseX,
            baseY,
            0,
            tiles,
            actors,
            objects
        );
    }
}
