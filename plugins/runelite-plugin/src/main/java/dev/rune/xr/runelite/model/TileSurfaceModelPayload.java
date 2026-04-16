package dev.rune.xr.runelite.model;

import java.util.List;

public record TileSurfaceModelPayload(
    List<TileSurfaceVertexPayload> vertices,
    List<TileSurfaceFacePayload> faces
)
{
}
