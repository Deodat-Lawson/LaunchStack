import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { category, document, users } from "@launchstack/core/db/schema";
import { validateRequestBody } from "~/lib/validation";

const AUTHORIZED_ROLES = new Set(["employer", "owner"]);

const PatchCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name cannot be empty")
    .max(256, "Name is too long (max 256 characters)"),
});

function parseId(raw: string):
  | { ok: true; id: number }
  | { ok: false; response: NextResponse } {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid category id" }, { status: 400 }),
    };
  }
  return { ok: true, id };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await context.params;
    const parsed = parseId(rawId);
    if (!parsed.ok) return parsed.response;

    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [userInfo] = await db
      .select()
      .from(users)
      .where(eq(users.userId, userId));

    if (!userInfo) {
      return NextResponse.json({ error: "Unknown user" }, { status: 401 });
    }
    if (!AUTHORIZED_ROLES.has(userInfo.role)) {
      return NextResponse.json(
        { error: "Forbidden: employer or owner role required" },
        { status: 403 },
      );
    }

    const validation = await validateRequestBody(request, PatchCategorySchema);
    if (!validation.success) {
      return validation.response;
    }
    const { name } = validation.data;

    // Verify the category belongs to the caller's company before letting them
    // rename it.
    const [existing] = await db
      .select()
      .from(category)
      .where(
        and(eq(category.id, parsed.id), eq(category.companyId, userInfo.companyId)),
      );

    if (!existing) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    if (existing.name === name) {
      return NextResponse.json({ success: true, id: parsed.id, name }, { status: 200 });
    }

    // Rename + cascade the new name onto any documents that referenced the old
    // name via the `category` text column. Kept in a transaction so the two
    // writes can't drift.
    await db.transaction(async (tx) => {
      await tx
        .update(category)
        .set({ name })
        .where(eq(category.id, parsed.id));
      await tx
        .update(document)
        .set({ category: name })
        .where(
          and(
            eq(document.companyId, userInfo.companyId),
            eq(document.category, existing.name),
          ),
        );
    });

    return NextResponse.json(
      { success: true, id: parsed.id, name },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Categories PATCH] failed:", error);
    return NextResponse.json(
      { error: "Failed to rename category" },
      { status: 500 },
    );
  }
}
