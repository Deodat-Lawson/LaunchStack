/**
 * GET /api/storage/deletion-requests/[id] — B7 status read API.
 *
 * Answers "how is this deletion going?" for one deletion request, by id.
 * Read-only: nothing here changes any state.
 *
 * Works both while the request is live and long after it finished — once a
 * deletion completes, the request and item rows are cascaded away with the
 * document, and the answer comes from the tombstone instead. That fallback
 * only became possible with migration 0022, which stopped the tombstone's
 * request_id from being nulled by that same cascade.
 *
 * Authorization matches the delete APIs (employer/owner): being able to read
 * which files a deletion is stuck on is roughly the same privilege as being
 * able to request the deletion in the first place. A cross-company id answers
 * 404, not 403, so this can't be used to probe ids in other companies.
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
  getDeletionStatusByRequestId,
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
    const requestId = Number(id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json(
        { success: false, error: "Invalid deletion request ID" },
        { status: 400 }
      );
    }

    const companyId = await resolveActiveCompanyForUser(userInfo.id, userInfo.companyId);

    const result = await getDeletionStatusByRequestId({
      requestId,
      companyId: Number(companyId),
    });

    const { status, body } = toHttpResponse(result);
    return NextResponse.json(body, { status });
  } catch (error) {
    console.error("[GET /api/storage/deletion-requests/[id]] error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to read deletion status" },
      { status: 500 }
    );
  }
}
