/**
 * Shared auth + error mapping for the Drive-link routes. Same conventions as
 * the adeu routes: documentId in, company and read scope enforced
 * server-side, 404 for "missing", "someone else's" and "not in your folders"
 * alike so real ids don't leak.
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { GoogleAuthError, GoogleDriveError } from "@launchstack/google-drive";
import { document } from "@launchstack/store/schema";

import type { Locale } from "~/i18n/locales";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor, wordOr } from "~/i18n/translate";
import { db } from "~/server/db";
import {
    requireWorkspaceContext,
    requireWorkspacePermission,
} from "~/lib/require-workspace-context";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import {
    GoogleDriveConfigError,
    isDriveLinkingEnabled,
} from "~/server/services/google-drive/config";
import { GoogleNotConnectedError } from "~/server/services/google-drive/connections";
import { DriveLinkError } from "~/server/services/google-drive/links";

export function fail(status: number, error: string, message?: string): NextResponse {
    return NextResponse.json({ success: false, error, message }, { status });
}

/** English without a request (a test, a script). */
function localeOf(request: Request | undefined): Locale {
    return request ? localeOfRequest(request) : "en";
}

export interface DriveRouteContext {
    documentId: number;
    companyId: bigint;
    authUserId: string;
    userPk: bigint | null;
    doc: {
        id: number;
        title: string;
        fileType: string | null;
        mimeType: string | null;
        ocrMetadata: unknown;
    };
}

/**
 * Linking, syncing and unlinking move the document's bytes between the
 * workspace and its Google account, so they take `connectors.manage`. The
 * status line is readable by anyone who can read the document — pass
 * `{ requirePermission: false }`.
 */
export async function authorizeDriveRoute(
    rawId: string,
    /** `request` words the refusals in its reader's language. */
    options?: { requirePermission?: boolean; request?: Request }
): Promise<{ ok: true; data: DriveRouteContext } | { ok: false; response: NextResponse }> {
    const locale = localeOf(options?.request);
    if (!isDriveLinkingEnabled()) {
        return {
            ok: false,
            response: fail(
                404,
                "feature_disabled",
                translatorFor(locale, "sources.server.drive")("notEnabled")
            ),
        };
    }

    const documentId = Number(rawId);
    if (!Number.isInteger(documentId) || documentId <= 0) {
        return {
            ok: false,
            response: fail(
                400,
                "invalid_id",
                translatorFor(locale, "sources.server.errors")("invalidDocumentId")
            ),
        };
    }

    const ctx =
        options?.requirePermission === false
            ? await requireWorkspaceContext()
            : await requireWorkspacePermission("connectors.manage");
    if (!ctx.success) return { ok: false, response: ctx.response };

    const companyId = BigInt(ctx.data.companyId);
    const [doc] = await db
        .select({
            id: document.id,
            title: document.title,
            fileType: document.fileType,
            mimeType: document.mimeType,
            ocrMetadata: document.ocrMetadata,
        })
        .from(document)
        .where(
            and(
                eq(document.id, documentId),
                scopedDocumentWhere(companyId, await ctx.data.documentScope())
            )
        );

    if (!doc) {
        return {
            ok: false,
            response: fail(
                404,
                "not_found",
                translatorFor(locale, "errors.api")("documentNotFound")
            ),
        };
    }

    return {
        ok: true,
        data: {
            documentId,
            companyId,
            authUserId: ctx.data.authUserId,
            userPk: ctx.data.userPk,
            doc,
        },
    };
}

/**
 * Map service-layer errors onto responses the UI can act on — in the
 * language of the person behind `request`. Provider details pass through.
 */
export function driveErrorResponse(err: unknown, request?: Request): NextResponse {
    const locale = localeOf(request);
    const t = translatorFor(locale, "sources.server.drive");
    if (err instanceof GoogleNotConnectedError) {
        return NextResponse.json(
            {
                success: false,
                error: "not_connected",
                message: t("connectFirst"),
                connectUrl: "/api/connectors/google/oauth/start",
            },
            { status: 409 }
        );
    }
    if (err instanceof DriveLinkError) {
        return fail(err.status, err.code, wordOr(err.copy, err.message, locale));
    }
    if (err instanceof GoogleDriveConfigError) {
        return fail(503, "not_configured", wordOr(err.copy, err.message, locale));
    }
    if (err instanceof GoogleAuthError && err.invalidGrant) {
        return NextResponse.json(
            {
                success: false,
                error: "reconnect_required",
                message: t("accessRevoked"),
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
    return fail(
        500,
        "internal_error",
        err instanceof Error ? err.message : translatorFor(locale, "errors.api")("unknownError")
    );
}
