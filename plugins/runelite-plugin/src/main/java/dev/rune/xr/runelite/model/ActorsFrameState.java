package dev.rune.xr.runelite.model;

import java.util.List;

public record ActorsFrameState(
    int version,
    String windowKey,
    List<ActorPayload> actors
)
{
    public static ActorsFrameState fromSnapshot(ActorsFramePayload snapshot)
    {
        return new ActorsFrameState(
            snapshot.version(),
            snapshot.windowKey(),
            snapshot.actors()
        );
    }
}
