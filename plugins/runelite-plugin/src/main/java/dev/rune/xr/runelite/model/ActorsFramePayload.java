package dev.rune.xr.runelite.model;

import java.util.List;

public record ActorsFramePayload(
    int version,
    long timestamp,
    String windowKey,
    List<ActorPayload> actors
)
{
}
