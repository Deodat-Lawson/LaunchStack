/**
 * Shared auth + error mapping for the Drive-link routes. Same conventions as
 * the adeu routes: documentId in, company scope enforced server-side, 404 for
 * both "missing" and "someone else's" so real ids don't leak.
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { GoogleAuthError, GoogleDriveError } from "@launchstack/google-drive";
import { document } from "@launchstack/store/schema";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { isManagementRole, requireWorkspaceContext } from "~/lib/require-workspace-context";
import {
    GoogleDriveConfigError,
    isDriveLinkingEnabled,
} from "~/server/services/google-drive/config";
import { GoogleNotConnectedError } from "~/server/services/google-drive/connections";
import { DriveLinkError } from "~/server/services/google-drive/links";

export function fail(status: number, error: string, message?: string): NextResponse {
    return NextResponse.json({ success: false, error, message }, { status });
}

export interface DriveRouteContext {
    documentId: number;
    companyId: bigint;
    clerkUserId: string;
    userPk: bigint | null;
    doc: { id: number; title: string; fileType: string | null; mimeType: string | null };
}

export async function authorizeDriveRoute(
    rawId: string,
    options?: { requireManagement?: boolean }
): Promise<{ ok: true; data: DriveRouteContext } | { ok: false; response: NextResponse }> {
    if (!isDriveLinkingEnabled()) {
        return {
            ok: false,
            response: fail(
                404,
                "feature_disabled",
                "Google Drive linking is not enabled on this deployment."
            ),
        };
    }

    const documentId = Number(rawId);
    if (!Number.isInteger(documentId) || documentId <= 0) {
        return { ok: false, response: fail(400, "invalid_id", "Invalid document id") };
    }

    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return { ok: false, response: ctx.response };

    if (options?.requireManagement !== false && !isManagementRole(ctx.data.role)) {
        return {
            ok: false,
            response: fail(403, "forbidden", "Owner or admin role required"),
        };
    }

    const companyId = BigInt(ctx.data.companyId);
    const [doc] = await db
        .select({
            id: document.id,
            title: document.title,
            fileType: document.fileType,
            mimeType: document.mimeType,
        })
        .from(document)
        .where(and(eq(document.id, documentId), eq(document.companyId, companyId)));

    if (!doc) {
        return { ok: false, response: fail(404, "not_found", "Document not found") };
    }

    const [userRow] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.userId, ctx.data.clerkUserId))
        .limit(1);

    return {
        ok: true,
        data: {
            documentId,
            companyId,
            clerkUserId: ctx.data.clerkUserId,
            userPk: userRow ? BigInt(userRow.id) : null,
            doc,
        },
    };
}

/** Map service-layer errors onto responses the UI can act on. */
export function driveErrorResponse(err: unknown): NextResponse {
    if (err instanceof GoogleNotConnectedError) {
        return NextResponse.json(
            {
                success: false,
                error: "not_connected",
                message: "Connect a Google account for this workspace first.",
                connectUrl: "/api/connectors/google/oauth/start",
            },
            { status: 409 }
        );
    }
    if (err instanceof DriveLinkError) {
        return fail(err.status, err.code, err.message);
    }
    if (err instanceof GoogleDriveConfigError) {
        return fail(503, "not_configured", err.message);
    }
    if (err instanceof GoogleAuthError && err.invalidGrant) {
        return NextResponse.json(
            {
                success: false,
                error: "reconnect_required",
                message:
                    "Google revoked this workspace's access. Reconnect the Google account to resume syncing.",
                connectUrl: "/api/connectors/google/oauth/start",
            },
            { status: 409 }
        );
    }
    if (err instanceof GoogleDriveError) {
        return fail(
            err.status >= 400 && err.status < 500 ? err.status : 502,
            "drive_error",
            err.detail
        );
    }
    return fail(500, "internal_error", err instanceof Error ? err.message : "Unknown error");
}
