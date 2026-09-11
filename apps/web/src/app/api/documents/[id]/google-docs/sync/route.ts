/**
 * POST /api/documents/[id]/google-docs/sync — manual "Sync now".
 *
 * Pulls immediately (force: skips the settle window, never the revision
 * gates). Returns the pull outcome so the UI can say what actually happened —
 * "already up to date" and "synced v7" are different messages.
 */
import { NextResponse } from "next/server";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { getDriveLinkForDocument } from "~/server/services/google-drive/links";
import { pullDriveLink } from "~/server/services/google-drive/sync";

import { authorizeDriveRoute, driveErrorResponse, fail } from "../_shared";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        const { id: rawId } = await context.params;
        const auth = await authorizeDriveRoute(rawId);
        if (!auth.ok) return auth.response;

        const link = await getDriveLinkForDocument(auth.data.documentId);
        if (!link || link.status === "unlinked") {
            return fail(404, "not_linked", "This document is not linked to Google Drive.");
        }

        try {
            const outcome = await pullDriveLink(link, { force: true, requestUrl: request.url });
            const status = outcome.kind === "error" ? 502 : 200;
            return NextResponse.json({ success: outcome.kind !== "error", outcome }, { status });
        } catch (err) {
            console.error("[google-docs/sync] failed:", err);
            return driveErrorResponse(err);
        }
    });
}
