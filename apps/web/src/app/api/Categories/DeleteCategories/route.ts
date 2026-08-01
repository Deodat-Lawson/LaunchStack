import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../../../server/db/index";
import { category } from "@launchstack/core/db/schema";
import { validateRequestBody } from "~/lib/validation";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

const DeleteCategorySchema = z.object({
  id: z.number().int().positive("Category ID must be a positive integer"),
});

export async function DELETE(request: Request) {
  try {
    const validation = await validateRequestBody(request, DeleteCategorySchema);
    if (!validation.success) {
      return validation.response;
    }

    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    if (ctx.data.role !== "employer" && ctx.data.role !== "owner") {
      return NextResponse.json(
        { error: "Invalid user role." },
        { status: 400 },
      );
    }

    const deleted = await db
      .delete(category)
      .where(
        and(
          eq(category.id, Number(validation.data.id)),
          eq(category.companyId, ctx.data.companyId),
        ),
      )
      .returning({ id: category.id });

    if (deleted.length === 0) {
      return NextResponse.json(
        { error: "Category not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    console.error(error);
    return NextResponse.json({ error }, { status: 500 });
  }
}
