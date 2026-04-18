package dev.rune.xr.runelite.service;

import net.runelite.api.DynamicObject;
import net.runelite.api.Model;
import net.runelite.api.Renderable;

final class RenderableModelResolver
{
    private RenderableModelResolver()
    {
    }

    static Model resolveRenderableModel(Renderable renderable)
    {
        if (renderable == null)
        {
            return null;
        }

        if (renderable instanceof DynamicObject dynamicObject)
        {
            Model model = dynamicObject.getModelZbuf();

            if (hasUsableGeometry(model))
            {
                return model;
            }

            return dynamicObject.getModel();
        }

        if (renderable instanceof Model model)
        {
            return model;
        }

        return renderable.getModel();
    }

    static boolean hasRenderable(Renderable... renderables)
    {
        for (Renderable renderable : renderables)
        {
            if (renderable != null)
            {
                return true;
            }
        }

        return false;
    }

    private static boolean hasUsableGeometry(Model model)
    {
        if (model == null)
        {
            return false;
        }

        float[] vertexX = model.getVerticesX();
        float[] vertexY = model.getVerticesY();
        float[] vertexZ = model.getVerticesZ();
        int[] indices1 = model.getFaceIndices1();
        int[] indices2 = model.getFaceIndices2();
        int[] indices3 = model.getFaceIndices3();

        if (vertexX == null || vertexY == null || vertexZ == null || indices1 == null || indices2 == null || indices3 == null)
        {
            return false;
        }

        int vertexCount = Math.min(vertexX.length, Math.min(vertexY.length, vertexZ.length));
        int faceCount = Math.min(indices1.length, Math.min(indices2.length, indices3.length));

        return vertexCount > 0 && faceCount > 0;
    }
}
