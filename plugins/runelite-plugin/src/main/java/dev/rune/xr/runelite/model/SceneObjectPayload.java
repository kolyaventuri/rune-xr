package dev.rune.xr.runelite.model;

public record SceneObjectPayload(
    String id,
    String kind,
    String name,
    int x,
    int y,
    int plane,
    Integer sizeX,
    Integer sizeY,
    Integer rotationDegrees,
    Integer wallOrientationA,
    Integer wallOrientationB,
    TileSurfaceModelPayload model
)
{
}
