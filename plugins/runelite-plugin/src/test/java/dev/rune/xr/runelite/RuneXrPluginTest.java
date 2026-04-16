package dev.rune.xr.runelite;

import net.runelite.client.RuneLite;
import net.runelite.client.externalplugins.ExternalPluginManager;

public final class RuneXrPluginTest
{
    private RuneXrPluginTest()
    {
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws Exception
    {
        ExternalPluginManager.loadBuiltin(RuneXrPlugin.class);
        RuneLite.main(args);
    }
}
