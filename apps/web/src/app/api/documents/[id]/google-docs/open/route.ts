/**
 * POST /api/documents/[id]/google-docs/open — Leg 1.
 *
 * Idempotent: the first call uploads the bytes to the workspace's Google
 * Drive and records the durable link; every later call returns the same
 * file's URL. The client opens the returned URL in a new tab.
 */
import { NextResponse } from "next/server";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { linkDocumentToDrive } from "~/server/services/google-drive/links";

import { authorizeDriveRoute, driveErrorResponse } from "../_shared";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        const { id: rawId } = await context.params;
        const auth = await authorizeDriveRoute(rawId);
        if (!auth.ok) return auth.response;

        try {
            const { link, created } = await linkDocumentToDrive({
                documentId: auth.data.documentId,
                companyId: auth.data.companyId,
                linkedByUserId: auth.data.userPk,
            });

            return NextResponse.json({
                success: true,
                created,
                url: link.driveWebViewLink,
                driveFileId: link.driveFileId,
                status: link.status,
            });
        } catch (err) {
            console.error("[google-docs/open] failed:", err);
            return driveErrorResponse(err);
        }
    });
}
