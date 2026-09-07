import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db/index";
import { category } from "@launchstack/store/schema";
import { validateRequestBody } from "~/lib/validation";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";

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
        console.error(error);
        return NextResponse.json({ error }, { status: 500 });
    }
}
