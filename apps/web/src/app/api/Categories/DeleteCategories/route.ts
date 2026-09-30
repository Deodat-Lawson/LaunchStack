import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db/index";
import { category } from "@launchstack/store/schema";
import { validateRequestBody } from "~/lib/validation";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";
import { normalizeFolderPath } from "~/lib/folders/path";
import { conflict, isWorkspaceError } from "~/server/workspace/errors";

const DeleteCategorySchema = z.object({
    id: z.number().int().positive("Category ID must be a positive integer"),
});

export async function DELETE(request: Request) {
    try {
        const validation = await validateRequestBody(request, DeleteCategorySchema);
        if (!validation.success) {
            return validation.response;
        }

        const ctx = await requireWorkspacePermission("folders.manage");
        if (!ctx.success) return ctx.response;

        const deleted = await db.transaction(async tx => {
            const [existing] = await tx
                .select({ id: category.id, name: category.name })
                .from(category)
                .where(
                    and(
                        eq(category.id, Number(validation.data.id)),
                        eq(category.companyId, ctx.data.companyId)
                    )
                )
                .for("update");
            if (!existing) return [];
            if (normalizeFolderPath(existing.name) === "Calls") {
                throw conflict("Calls is managed by Call Notes");
            }

            const rows = await tx
                .delete(category)
                .where(
                    and(
                        eq(category.id, Number(validation.data.id)),
                        eq(category.companyId, ctx.data.companyId)
                    )
                )
                .returning({ id: category.id, name: category.name });
            for (const row of rows) {
                await recordAuditEvent(tx, {
                    companyId: ctx.data.companyId,
                    actorUserId: ctx.data.authUserId,
                    action: "folder.deleted",
                    targetType: "folder",
                    targetId: row.id,
                    detail: { name: row.name },
                });
            }
            return rows;
        });

        if (deleted.length === 0) {
            return NextResponse.json({ error: "Category not found." }, { status: 404 });
        }

        return NextResponse.json({ success: true }, { status: 200 });
    } catch (error: unknown) {
        if (isWorkspaceError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error(error);
        return NextResponse.json({ error }, { status: 500 });
    }
}
