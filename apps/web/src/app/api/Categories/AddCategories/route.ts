import { NextResponse } from "next/server";
import { db } from "~/server/db/index";
import { category } from "@launchstack/store/schema";
import { z } from "zod";
import { validateRequestBody } from "~/lib/validation";
import { isManagementRole, requireWorkspaceContext } from "~/lib/require-workspace-context";

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

        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        if (!isManagementRole(ctx.data.role)) {
            return NextResponse.json({ error: "Invalid user role." }, { status: 403 });
        }

        const newCategoryId = await db
            .insert(category)
            .values({
                name: validation.data.CategoryName,
                companyId: ctx.data.companyId,
            })
            .returning({ id: category.id });

        return NextResponse.json({
            success: true,
            id: newCategoryId[0],
            name: validation.data.CategoryName,
        });
    } catch (error: unknown) {
        console.error(error);
        return NextResponse.json({ error }, { status: 500 });
    }
}
