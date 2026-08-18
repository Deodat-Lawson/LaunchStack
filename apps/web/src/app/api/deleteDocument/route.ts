/**
 * Single document delete API — B4.
 *
 * Replaces the old DB-only cascade delete (the original P0 bug: files in
 * S3/Blob/database storage were never actually removed, only rows). This
 * route now only ever *requests* a deletion — it writes a durable plan via
 * B2's requestDocumentDeletionAndDispatch and wakes up B3's worker, which
 * does the real, asynchronous work (delete the files, then purge the
 * relational rows once every file is confirmed gone).
 *
 * Because deletion is now asynchronous, this route can never truthfully
 * say "deleted successfully" the moment it returns — see Decision 6/6a in
 * the design doc. It reports whatever status is actually true right now
 * (queued/quarantined/completed), never more than that.
 *
 * The actual flag-gate/dispatch/status-mapping logic lives in
 * ~/server/services/delete-document-api.ts (handleDeleteDocumentRequest),
 * kept separate from this handler specifically so it's testable without
 * needing Clerk auth to be exercised from a script.
 */

import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { users } from "@launchstack/core/db/schema";
import { eq } from "drizzle-orm";
import { validateRequestBody, DeleteDocumentSchema } from "~/lib/validation";
import { auth } from "@clerk/nextjs/server";
import { handleDeleteDocumentRequest } from "~/server/services/delete-document-api";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";

export async function DELETE(request: Request) {
  try {
    const validation = await validateRequestBody(request, DeleteDocumentSchema);
    if (!validation.success) {
      return validation.response;
    }

    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { success: false, message: "Invalid user." },
        { status: 401 },
      );
    }

    const [userInfo] = await db.select().from(users).where(eq(users.userId, userId));

    if (!userInfo) {
      return NextResponse.json(
        { success: false, message: "Invalid user." },
        { status: 401 },
      );
    } else if (userInfo.role !== "employer" && userInfo.role !== "owner") {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const { docId } = validation.data;
    const documentId = Number(docId);

    if (isNaN(documentId) || documentId <= 0) {
      return NextResponse.json(
        { success: false, error: "Invalid document ID format" },
        { status: 400 },
      );
    }

    const { status, body } = await handleDeleteDocumentRequest({
      documentId,
      companyId: Number(
        await resolveActiveCompanyForUser(userInfo.id, userInfo.companyId),
      ),
      actorId: userId,
    });

    return NextResponse.json(body, { status });
  } catch (error) {
    console.error("Error requesting document deletion:", error);
    return NextResponse.json(
      { success: false, error: "Failed to request document deletion." },
      { status: 500 },
    );
  }
}
