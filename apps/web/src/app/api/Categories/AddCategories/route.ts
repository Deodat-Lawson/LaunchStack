import { NextResponse } from "next/server";
import { db } from "~/server/db/index";
import { category } from "@launchstack/store/schema";
import { z } from "zod";
import { validateRequestBody } from "~/lib/validation";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { recordAuditEvent } from "~/lib/authz/audit";

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

        const ctx = await requireWorkspacePermission("folders.manage");
        if (!ctx.success) return ctx.response;

        const created = await db.transaction(async tx => {
            const [row] = await tx
                .insert(category)
                .values({
                    name: validation.data.CategoryName,
                    companyId: ctx.data.companyId,
                })
                .returning({ id: category.id });
            await recordAuditEvent(tx, {
                companyId: ctx.data.companyId,
                actorUserId: ctx.data.authUserId,
                action: "folder.created",
                targetType: "folder",
                targetId: row?.id,
                detail: { name: validation.data.CategoryName },
            });
            return row;
        });

        return NextResponse.json({
            success: true,
            id: created,
            name: validation.data.CategoryName,
        });
    } catch (error: unknown) {
        console.error(error);
        return NextResponse.json({ error }, { status: 500 });
    }
}
