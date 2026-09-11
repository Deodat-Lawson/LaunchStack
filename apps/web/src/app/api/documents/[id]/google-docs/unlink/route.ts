/**
 * POST /api/documents/[id]/google-docs/unlink — Leg 5.
 *
 * Final blocking pull, then park the link. Refuses to complete when the final
 * pull fails retryably — unlinking while edits may be stranded in Drive is
 * the silent-loss scenario the design forbids.
 *
 * Omitting `keepDriveFile` lets the service decide from the link's origin: an
 * uploaded document's Drive *copy* is trashed, a document created in Google
 * Docs keeps its Drive *original*. Send the field explicitly to force either.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { unlinkDocument } from "~/server/services/google-drive/sync";

import { authorizeDriveRoute, driveErrorResponse } from "../_shared";

const BodySchema = z.object({ keepDriveFile: z.boolean().optional() }).optional();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        const { id: rawId } = await context.params;
        const auth = await authorizeDriveRoute(rawId);
        if (!auth.ok) return auth.response;

        let keepDriveFile: boolean | undefined;
        try {
            const body: unknown = await request.json().catch(() => undefined);
            keepDriveFile = BodySchema.parse(body)?.keepDriveFile;
        } catch {
            // An empty or malformed body leaves the choice to the origin rule.
        }

        try {
            const result = await unlinkDocument({
                documentId: auth.data.documentId,
                keepDriveFile,
                requestUrl: request.url,
            });

            if (result.finalPull.kind === "error" && result.finalPull.retryable) {
                return NextResponse.json(
                    {
                        success: false,
                        error: "final_sync_failed",
                        message:
                            "Could not pull the latest Google Drive edits, so the link was kept. " +
                            "Try again, or resolve the error first.",
                        outcome: result.finalPull,
                    },
                    { status: 409 }
                );
            }

            return NextResponse.json({ success: true, ...result });
        } catch (err) {
            console.error("[google-docs/unlink] failed:", err);
            return driveErrorResponse(err);
        }
    });
}
