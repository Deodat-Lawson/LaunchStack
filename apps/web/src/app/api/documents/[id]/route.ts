/**
 * Document mutation API — per-document lightweight operations.
 *
 * PATCH /api/documents/[id]
 *   Update mutable document fields. Currently supports renaming (`title`).
 *   Employer/owner role required and the document must belong to the user's
 *   company. Returns the updated document row.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { document, users } from "@launchstack/core/db/schema";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";

const AUTHORIZED_ROLES = new Set(["employer", "owner"]);

// `title` column is varchar(256) — match the schema constraint.
const PatchDocumentSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title cannot be empty")
    .max(256, "Title is too long (max 256 characters)")
    .optional(),
});

function parseDocumentId(rawId: string):
  | { ok: true; documentId: number }
  | { ok: false; response: NextResponse } {
  const documentId = Number(rawId);
  if (!Number.isInteger(documentId) || documentId <= 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid document id" },
        { status: 400 }
      ),
    };
  }
  return { ok: true, documentId };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return withRateLimit(request, RateLimitPresets.strict, async () => {
    try {
      const { id: rawId } = await context.params;
      const parsed = parseDocumentId(rawId);
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
          { status: 403 }
        );
      }

      const [doc] = await db
        .select()
        .from(document)
        .where(eq(document.id, parsed.documentId));

      if (!doc || doc.companyId !== userInfo.companyId) {
        // Don't leak existence to cross-company requests.
        return NextResponse.json(
          { error: "Document not found" },
          { status: 404 }
        );
      }

      const validation = await validateRequestBody(request, PatchDocumentSchema);
      if (!validation.success) return validation.response;

      const { title } = validation.data;

      const patch: Record<string, string> = {};
      if (title !== undefined) patch.title = title;

      if (Object.keys(patch).length === 0) {
        return NextResponse.json(
          { error: "No mutable fields provided" },
          { status: 400 }
        );
      }

      const [updated] = await db
        .update(document)
        .set(patch)
        .where(eq(document.id, parsed.documentId))
        .returning();

      return NextResponse.json({
        success: true,
        document: updated,
      });
    } catch (error) {
      console.error("[PATCH /api/documents/[id]] error:", error);
      return NextResponse.json(
        { error: "Failed to update document" },
        { status: 500 }
      );
    }
  });
}
