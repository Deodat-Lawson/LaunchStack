/**
 * GET /api/documents/[id]/deletion-status — B7 status read API.
 *
 * Same answer as /api/storage/deletion-requests/[id], reached by the id
 * callers usually have: the document's. Read-only.
 *
 * Three distinct answers, all 200:
 *   - a deletion is in progress  -> full status + per-item detail
 *   - the deletion has finished  -> the tombstone's outcome, purged: true
 *   - no deletion was requested  -> deletionRequested: false
 * A document that doesn't exist, or belongs to another company, is 404.
 *
 * The status/per-item logic lives in
 * ~/server/services/deletion-status-api.ts so it's testable without Clerk.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { users } from "@launchstack/core/db/schema";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";
import {
  getDeletionStatusByDocumentId,
  toHttpResponse,
} from "~/server/services/deletion-status-api";

const AUTHORIZED_ROLES = new Set(["employer", "owner"]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const [userInfo] = await db.select().from(users).where(eq(users.userId, userId));
    if (!userInfo) {
      return NextResponse.json({ success: false, error: "Unknown user" }, { status: 401 });
    }
    if (!AUTHORIZED_ROLES.has(userInfo.role)) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const { id } = await context.params;
    const documentId = Number(id);
    if (!Number.isInteger(documentId) || documentId <= 0) {
      return NextResponse.json(
        { success: false, error: "Invalid document ID" },
        { status: 400 }
      );
    }

    const companyId = await resolveActiveCompanyForUser(userInfo.id, userInfo.companyId);

    const result = await getDeletionStatusByDocumentId({
      documentId,
      companyId: Number(companyId),
    });

    const { status, body } = toHttpResponse(result);
    return NextResponse.json(body, { status });
  } catch (error) {
    console.error("[GET /api/documents/[id]/deletion-status] error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to read deletion status" },
      { status: 500 }
    );
  }
}
