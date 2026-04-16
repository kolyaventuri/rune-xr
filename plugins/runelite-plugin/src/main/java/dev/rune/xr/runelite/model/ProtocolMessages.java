package dev.rune.xr.runelite.model;

public final class ProtocolMessages
{
    public static final int VERSION = 1;

    private ProtocolMessages()
    {
    }

    public record HelloMessage(String kind, int protocolVersion, String role, String source)
    {
        public static HelloMessage plugin(String source)
        {
            return new HelloMessage("hello", VERSION, "plugin", source);
        }
    }

    public record SceneSnapshotMessage(String kind, SceneSnapshotPayload snapshot)
    {
        public static SceneSnapshotMessage fromSnapshot(SceneSnapshotPayload snapshot)
        {
            return new SceneSnapshotMessage("scene_snapshot", snapshot);
        }
    }
}

