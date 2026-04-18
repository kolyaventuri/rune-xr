package dev.rune.xr.runelite.service;

import dev.rune.xr.runelite.model.ActorPayload;
import dev.rune.xr.runelite.model.ProtocolMessages;
import dev.rune.xr.runelite.model.SceneObjectPayload;
import dev.rune.xr.runelite.model.SceneSnapshotPayload;
import dev.rune.xr.runelite.model.TilePayload;
import dev.rune.xr.runelite.model.TileSurfaceFacePayload;
import dev.rune.xr.runelite.model.TileSurfaceModelPayload;
import dev.rune.xr.runelite.model.TileSurfaceVertexPayload;
import java.util.ArrayList;
import java.util.List;

public final class SyntheticSceneFactory
{
    private static final TileSurfaceModelPayload SELF_ACTOR_MODEL = createHumanoidActorModel(0xd7b691, 0x2c9f62, 0x3c4f6b);
    private static final TileSurfaceModelPayload PLAYER_ACTOR_MODEL = createHumanoidActorModel(0xd3b18b, 0x4478c8, 0x6b4b3c);
    private static final TileSurfaceModelPayload NPC_ACTOR_MODEL = mergeModels(
        createCuboidModel(-12, 12, 42, 64, -10, 10, 0x7ea85a),
        createCuboidModel(-16, 16, 18, 42, -7, 11, 0x8d4d38),
        createCuboidModel(-24, -14, 14, 34, -4, 4, 0x7ea85a),
        createCuboidModel(14, 24, 14, 34, -4, 4, 0x7ea85a),
        createCuboidModel(-10, -2, 0, 18, -4, 4, 0x65463b),
        createCuboidModel(2, 10, 0, 18, -4, 4, 0x65463b),
        createCuboidModel(-4, 4, 48, 56, 10, 16, 0x6f934b)
    );

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
            new ActorPayload(
                "self_demo",
                "self",
                "Kolya",
                baseX + radius + (tick % 3) - 1,
                baseY + radius,
                0,
                baseX + radius + (tick % 3) - 0.5,
                baseY + radius + 0.5,
                180,
                1,
                "actor-model:self-demo",
                SELF_ACTOR_MODEL
            ),
            new ActorPayload(
                "player_friend",
                "player",
                "Friend",
                baseX + radius - 2,
                baseY + radius - (tick % 2),
                0,
                baseX + radius - 1.5,
                baseY + radius - (tick % 2) + 0.5,
                90,
                1,
                "actor-model:player-friend",
                PLAYER_ACTOR_MODEL
            ),
            new ActorPayload(
                "npc_guard",
                "npc",
                "Guard",
                baseX + radius + 2,
                baseY + radius + ((tick + 1) % 2),
                0,
                baseX + radius + 2.5,
                baseY + radius + ((tick + 1) % 2) + 0.5,
                270,
                1,
                "actor-model:npc-guard",
                NPC_ACTOR_MODEL
            )
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

    private static TileSurfaceModelPayload createHumanoidActorModel(int skinColor, int tunicColor, int legColor)
    {
        return mergeModels(
            createCuboidModel(-10, 10, 56, 82, -10, 10, skinColor),
            createCuboidModel(-16, 16, 24, 56, -8, 8, tunicColor),
            createCuboidModel(-24, -16, 26, 52, -5, 5, skinColor),
            createCuboidModel(16, 24, 26, 52, -5, 5, skinColor),
            createCuboidModel(-12, -4, 0, 24, -5, 5, legColor),
            createCuboidModel(4, 12, 0, 24, -5, 5, legColor)
        );
    }

    private static TileSurfaceModelPayload createCuboidModel(
        int minX,
        int maxX,
        int minY,
        int maxY,
        int minZ,
        int maxZ,
        int color
    )
    {
        List<TileSurfaceVertexPayload> vertices = List.of(
            new TileSurfaceVertexPayload(minX, minY, minZ),
            new TileSurfaceVertexPayload(maxX, minY, minZ),
            new TileSurfaceVertexPayload(maxX, maxY, minZ),
            new TileSurfaceVertexPayload(minX, maxY, minZ),
            new TileSurfaceVertexPayload(minX, minY, maxZ),
            new TileSurfaceVertexPayload(maxX, minY, maxZ),
            new TileSurfaceVertexPayload(maxX, maxY, maxZ),
            new TileSurfaceVertexPayload(minX, maxY, maxZ)
        );
        List<TileSurfaceFacePayload> faces = List.of(
            new TileSurfaceFacePayload(4, 5, 6, color, null, null, null, null, null, null, null, null, null, null),
            new TileSurfaceFacePayload(4, 6, 7, color, null, null, null, null, null, null, null, null, null, null),
            new TileSurfaceFacePayload(1, 0, 3, color, null, null, null, null, null, null, null, null, null, null),
            new TileSurfaceFacePayload(1, 3, 2, color, null, null, null, null, null, null, null, null, null, null),
            new TileSurfaceFacePayload(0, 4, 7, color, null, null, null, null, null, null, null, null, null, null),
            new TileSurfaceFacePayload(0, 7, 3, color, null, null, null, null, null, null, null, null, null, null),
            new TileSurfaceFacePayload(5, 1, 2, color, null, null, null, null, null, null, null, null, null, null),
            new TileSurfaceFacePayload(5, 2, 6, color, null, null, null, null, null, null, null, null, null, null),
            new TileSurfaceFacePayload(3, 7, 6, color, null, null, null, null, null, null, null, null, null, null),
            new TileSurfaceFacePayload(3, 6, 2, color, null, null, null, null, null, null, null, null, null, null),
            new TileSurfaceFacePayload(0, 1, 5, color, null, null, null, null, null, null, null, null, null, null),
            new TileSurfaceFacePayload(0, 5, 4, color, null, null, null, null, null, null, null, null, null, null)
        );

        return new TileSurfaceModelPayload(vertices, faces);
    }

    private static TileSurfaceModelPayload mergeModels(TileSurfaceModelPayload... models)
    {
        List<TileSurfaceVertexPayload> vertices = new ArrayList<>();
        List<TileSurfaceFacePayload> faces = new ArrayList<>();

        for (TileSurfaceModelPayload model : models)
        {
            int vertexBase = vertices.size();

            vertices.addAll(model.vertices());

            for (TileSurfaceFacePayload face : model.faces())
            {
                faces.add(new TileSurfaceFacePayload(
                    face.a() + vertexBase,
                    face.b() + vertexBase,
                    face.c() + vertexBase,
                    face.rgb(),
                    face.rgbA(),
                    face.rgbB(),
                    face.rgbC(),
                    face.texture(),
                    face.uA(),
                    face.vA(),
                    face.uB(),
                    face.vB(),
                    face.uC(),
                    face.vC()
                ));
            }
        }

        return new TileSurfaceModelPayload(List.copyOf(vertices), List.copyOf(faces));
    }
}
