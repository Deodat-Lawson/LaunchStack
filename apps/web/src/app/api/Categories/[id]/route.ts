import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { category } from "@launchstack/store/schema";
import { validateRequestBody } from "~/lib/validation";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { FolderError } from "~/server/folders";
import { renameFolderAs } from "~/server/workspace/folder-actions";

const PatchCategorySchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Name cannot be empty")
        .max(256, "Name is too long (max 256 characters)"),
});

function parseId(raw: string): { ok: true; id: number } | { ok: false; response: NextResponse } {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
        return {
            ok: false,
            response: NextResponse.json({ error: "Invalid category id" }, { status: 400 }),
        };
    }
    return { ok: true, id };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
    try {
        const { id: rawId } = await context.params;
        const parsed = parseId(rawId);
        if (!parsed.ok) return parsed.response;

        const ctx = await requireWorkspacePermission("documents.upload");
        if (!ctx.success) return ctx.response;

        const validation = await validateRequestBody(request, PatchCategorySchema);
        if (!validation.success) {
            return validation.response;
        }
        const { name } = validation.data;

        const [existing] = await db
            .select({ name: category.name })
            .from(category)
            .where(and(eq(category.id, parsed.id), eq(category.companyId, ctx.data.companyId)));
        if (!existing) {
            return NextResponse.json({ error: "Category not found" }, { status: 404 });
        }
        if (existing.name === name) {
            return NextResponse.json({ success: true, id: parsed.id, name }, { status: 200 });
        }

        // The same rename as `PATCH /api/folders`: visible, managed by the
        // caller, its subtree follows, and a move never publishes (ADR-014).
        await renameFolderAs(ctx.data, existing.name, name);
        return NextResponse.json({ success: true, id: parsed.id, name }, { status: 200 });
    } catch (error) {
        if (error instanceof FolderError) {
            return NextResponse.json(
                { error: error.status === 404 ? "Category not found" : error.message },
                { status: error.status }
            );
        }
        console.error("[Categories PATCH] failed:", error);
        return NextResponse.json({ error: "Failed to rename category" }, { status: 500 });
    }
}
