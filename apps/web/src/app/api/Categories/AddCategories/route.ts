import { NextResponse } from "next/server";
import { db } from "~/server/db/index";
import { category } from "@launchstack/store/schema";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { validateRequestBody } from "~/lib/validation";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { FolderError } from "~/server/folders";
import { createFolderAs } from "~/server/workspace/folder-actions";

const AddCategorySchema = z.object({
    CategoryName: z
        .string()
        .min(1, "Category name is required")
        .max(256, "Category name is too long"),
});

export async function POST(request: Request) {
    try {
        const validation = await validateRequestBody(request, AddCategorySchema);
        if (!validation.success) {
            return validation.response;
        }

        const ctx = await requireWorkspacePermission("documents.upload");
        if (!ctx.success) return ctx.response;

        // The same create as `POST /api/folders`, with ADR-014's defaults.
        const created = await createFolderAs(ctx.data, validation.data.CategoryName);
        const [row] = await db
            .select({ id: category.id })
            .from(category)
            .where(and(eq(category.companyId, ctx.data.companyId), eq(category.name, created.path)))
            .limit(1);

        return NextResponse.json({
            success: true,
            id: row ? { id: Number(row.id) } : null,
            name: created.path,
        });
    } catch (error: unknown) {
        if (error instanceof FolderError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("[Categories POST] failed:", error);
        return NextResponse.json({ error: "Failed to create category" }, { status: 500 });
    }
}
