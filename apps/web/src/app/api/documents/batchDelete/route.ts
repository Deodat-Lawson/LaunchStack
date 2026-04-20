/**
 * Batch document delete API.
 *
 * DELETE /api/documents/batchDelete
 *   Body: { docIds: number[] }
 *
 * Deletes N documents and all their related data in a single transaction.
 * Atomic across the entire batch — if any doc fails to delete, nothing is
 * removed. Enforces the same employer/owner authorization as the single-doc
 * delete, and rejects the request if any docId isn't in the caller's company.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { document, users } from "@launchstack/core/db/schema";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { deleteDocumentCore } from "~/server/services/document-delete";

const AUTHORIZED_ROLES = new Set(["employer", "owner"]);

const BatchDeleteSchema = z.object({
  docIds: z
    .array(z.number().int().positive())
    .min(1, "docIds cannot be empty")
    .max(100, "Cannot delete more than 100 documents at a time"),
});

export async function DELETE(request: Request) {
  return withRateLimit(request, RateLimitPresets.strict, async () => {
    try {
      const validation = await validateRequestBody(request, BatchDeleteSchema);
      if (!validation.success) return validation.response;

      const { userId } = await auth();
      if (!userId) {
        return NextResponse.json(
          { success: false, error: "Unauthorized" },
          { status: 401 }
        );
      }

      const [userInfo] = await db
        .select()
        .from(users)
        .where(eq(users.userId, userId));

      if (!userInfo) {
        return NextResponse.json(
          { success: false, error: "Unknown user" },
          { status: 401 }
        );
      }

      if (!AUTHORIZED_ROLES.has(userInfo.role)) {
        return NextResponse.json(
          { success: false, error: "Forbidden" },
          { status: 403 }
        );
      }

      const { docIds } = validation.data;
      const uniqueIds = Array.from(new Set(docIds));

      // Verify every doc belongs to the caller's company. A mismatch means
      // either a cross-company request or a stale client — reject the whole
      // batch rather than silently partial-deleting.
      const rows = await db
        .select({ id: document.id, companyId: document.companyId })
        .from(document)
        .where(inArray(document.id, uniqueIds));

      if (rows.length !== uniqueIds.length) {
        return NextResponse.json(
          { success: false, error: "One or more documents not found" },
          { status: 404 }
        );
      }

      for (const row of rows) {
        if (row.companyId !== userInfo.companyId) {
          return NextResponse.json(
            { success: false, error: "One or more documents not found" },
            { status: 404 }
          );
        }
      }

      await db.transaction(async (tx) => {
        for (const id of uniqueIds) {
          await deleteDocumentCore(tx, id);
        }
      });

      return NextResponse.json({
        success: true,
        deleted: uniqueIds.length,
        message: `Deleted ${uniqueIds.length} document${uniqueIds.length === 1 ? "" : "s"}`,
      });
    } catch (error) {
      console.error("[DELETE /api/documents/batchDelete] error:", error);
      return NextResponse.json(
        { success: false, error: "Failed to delete documents" },
        { status: 500 }
      );
    }
  });
}
