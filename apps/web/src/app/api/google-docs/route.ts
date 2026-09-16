/**
 * POST /api/google-docs — Create → Google Doc.
 *
 * A collection route rather than a sibling of the other google-docs routes,
 * because there is no document id yet: this is the path that makes one. It
 * creates a native Google Doc in the workspace's Drive, registers the exported
 * .docx as a source, and hands back the URL for the client to open.
 *
 * Gated on `documents.upload`, not `connectors.manage`: creating a document is
 * authoring, and this mirrors /api/uploadDocument. Establishing the workspace's
 * Google connection still takes `connectors.manage`, so an admin decides
 * whether there is an account to author against at all.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { FOLDER_EDIT_DENIED, canEditFolder } from "~/server/services/folder-access";
import { createGoogleDocDocument } from "~/server/services/google-drive/create";

import { driveErrorResponse } from "../documents/[id]/google-docs/_shared";

export const runtime = "nodejs";
// Create + export + storage upload is three Drive round trips plus ingestion.
export const maxDuration = 60;

const BodySchema = z.object({
    title: z.string().trim().max(200).optional(),
    folder: z.string().trim().max(200).optional(),
});

export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        const ctx = await requireWorkspacePermission("documents.upload");
        if (!ctx.success) return ctx.response;

        const body: unknown = await request.json().catch(() => ({}));
        const parsed = BodySchema.safeParse(body ?? {});
        if (!parsed.success) {
            return NextResponse.json(
                { success: false, error: "invalid_body", message: "Invalid title or folder." },
                { status: 400 }
            );
        }

        // Zod trimmed it, so a whitespace-only folder arrives as "" — present
        // but meaningless. Only a non-empty name overrides the default.
        const category = parsed.data.folder?.length ? parsed.data.folder : "Unfiled";

        // A restricted folder takes edit access to it, not just the permission
        // to create somewhere.
        if (!(await canEditFolder(ctx.data, category))) {
            return NextResponse.json(
                { success: false, error: "folder_denied", message: FOLDER_EDIT_DENIED },
                { status: 403 }
            );
        }

        try {
            const result = await createGoogleDocDocument({
                companyId: BigInt(ctx.data.companyId),
                authUserId: ctx.data.authUserId,
                userPk: ctx.data.userPk,
                // A blank title falls back inside the service, which owns the
                // default so the Drive file and the document row cannot drift.
                title: parsed.data.title ?? "",
                category,
                requestUrl: request.url,
            });

            return NextResponse.json({ success: true, ...result }, { status: 201 });
        } catch (err) {
            console.error("[google-docs] create failed:", err);
            return driveErrorResponse(err);
        }
    });
}
