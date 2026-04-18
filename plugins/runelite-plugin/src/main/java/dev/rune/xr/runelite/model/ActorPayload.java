package dev.rune.xr.runelite.model;

public record ActorPayload(
    String id,
    String type,
    String name,
    int x,
    int y,
    int plane,
    Double preciseX,
    Double preciseY,
    Integer rotationDegrees,
    Integer size,
    String modelKey,
    TileSurfaceModelPayload model
)
{
}
