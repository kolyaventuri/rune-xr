package dev.rune.xr.runelite.model;

public record TileSurfacePayload(
    Integer rgb,
    Integer texture,
    Integer overlayId,
    Integer underlayId,
    Integer shape,
    Integer renderLevel,
    Boolean hasBridge,
    Integer bridgeHeight,
    TileSurfaceModelPayload model
)
{
}
