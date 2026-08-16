/**
 * Batch document delete API — B5.
 *
 * DELETE /api/documents/batchDelete
 *   Body: { docIds: number[] }
 *
 * Replaces the old DB-only cascade delete (same P0 bug the single-document
 * route had: rows were removed, the actual files in S3/Blob/database storage
 * were not). This route now only ever *requests* deletion — it writes a
 * durable plan for every document in one transaction and wakes the B3 worker,
 * which does the real asynchronous work.
 *
 * What's preserved from the old route, unchanged: Clerk auth, the
 * employer/owner role check, the <=100 document cap, and the "reject the
 * whole batch if any id isn't in the caller's company" rule (answered as 404
 * rather than 403 so it can't be used to probe which ids exist elsewhere).
 *
 * What's new: one transaction accepts durable intent for all ids; files
 * referenced by more than one document in the batch are deduped so exactly
 * one delete call is made per physical file; the response carries a
 * per-document status plus an overall batch status using Decision 6a's rule
 * (partial when >=1 document completed and >=1 did not).
 *
 * What is deliberately NOT promised: cross-provider atomic rollback. The
 * plan is atomic; the provider deletes are not, and a file already removed
 * from S3 can't be put back if a later one fails.
 *
 * The flag-gate/dispatch/status-mapping logic lives in
 * ~/server/services/batch-delete-documents-api.ts, kept out of this handler
 * so it's testable without needing Clerk auth exercised from a script.
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
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";
import { handleBatchDeleteDocumentsRequest } from "~/server/services/batch-delete-documents-api";

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

      // Resolved once, outside the loop — the old route called this per row.
      const activeCompanyId = await resolveActiveCompanyForUser(
        userInfo.id,
        userInfo.companyId
      );

      // Verify every doc belongs to the caller's company. A mismatch means
      // either a cross-company request or a stale client — reject the whole
      // batch rather than silently partial-deleting. (The coordinator
      // re-checks this per document under a row lock; this pre-check is the
      // cheap early-out that keeps the old route's exact response shape.)
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
        if (row.companyId !== activeCompanyId) {
          return NextResponse.json(
            { success: false, error: "One or more documents not found" },
            { status: 404 }
          );
        }
      }

      const { status, body } = await handleBatchDeleteDocumentsRequest({
        documentIds: uniqueIds,
        companyId: Number(activeCompanyId),
        actorId: userId,
      });

      return NextResponse.json(body, { status });
    } catch (error) {
      console.error("[DELETE /api/documents/batchDelete] error:", error);
      return NextResponse.json(
        { success: false, error: "Failed to delete documents" },
        { status: 500 }
      );
    }
  });
}
