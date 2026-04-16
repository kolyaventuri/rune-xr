package dev.rune.xr.runelite.model;

public record TextureDefinitionPayload(
    int id,
    int width,
    int height,
    String pngBase64,
    Integer animationDirection,
    Integer animationSpeed
)
{
}
