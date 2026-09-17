/**
 * The product-side half of a profile edit.
 *
 * Better Auth owns the sign-in identity (`auth_user`) and the browser updates
 * it directly through `/api/auth/update-user`. The workspace shows names
 * from the product `users` row, which was copied at signup and never kept in
 * step. This route keeps it in step: after the auth update, the client asks
 * here to mirror the name so the member list and the audit log agree with
 * the sign-in screen.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { parseJsonBody } from "~/server/workspace/http";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
    name: z.string().trim().min(1).max(256),
});

export async function PATCH(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const body = await parseJsonBody(request, PatchSchema);
    if (!body.success) return body.response;

    const [row] = await db
        .update(users)
        .set({ name: body.data.name })
        .where(eq(users.userId, ctx.data.authUserId))
        .returning({ name: users.name });
    if (!row) return NextResponse.json({ error: "No profile row" }, { status: 404 });
    return NextResponse.json({ name: row.name });
}
