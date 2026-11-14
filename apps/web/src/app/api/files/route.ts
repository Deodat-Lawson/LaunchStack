/**
 * POST /api/files — Create › File › Write it here: a blank Markdown file,
 * ready for the in-app editor. The collection beside `/api/files/[id]`
 * (which serves stored bytes): this is the path that makes a file.
 *
 * Gated like Create → Google Doc (`/api/google-docs`): `documents.upload`,
 * edit access to the folder it lands in, and the creator's ADR-014 defaults
 * on what it made. Middleware lets `/api/files*` through for the signed-token
 * reads of its sibling, so this handler authenticates the caller itself.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { requestTranslator } from "~/i18n/server";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { createMarkdownFile } from "~/server/services/file-editing/create";
import { canEditFolder } from "~/server/services/folder-access";
import { recordUpload } from "~/server/workspace/added-documents";

export const runtime = "nodejs";
export const maxDuration = 30;

const BodySchema = z.object({
    title: z.string().trim().max(200).optional(),
    folder: z.string().trim().max(200).optional(),
});

export async function POST(request: Request) {
    const t = requestTranslator(request, "fileEditing");
    return withRateLimit(request, RateLimitPresets.strict, async () => {
        const ctx = await requireWorkspacePermission("documents.upload");
        if (!ctx.success) return ctx.response;

        const body: unknown = await request.json().catch(() => ({}));
        const parsed = BodySchema.safeParse(body ?? {});
        if (!parsed.success) {
            return NextResponse.json(
                { error: "invalid_body", message: t("server.invalidTitleOrFolder") },
                { status: 400 }
            );
        }

        // A blank folder is the default one, as everywhere else.
        const category = parsed.data.folder?.length ? parsed.data.folder : "Unfiled";
        if (!(await canEditFolder(ctx.data, category))) {
            return NextResponse.json(
                { error: "folder_denied", message: t("server.folderDenied") },
                { status: 403 }
            );
        }

        try {
            const { upload, ...result } = await createMarkdownFile({
                companyId: BigInt(ctx.data.companyId),
                authUserId: ctx.data.authUserId,
                // The default is the creator's language: it is their file.
                title: parsed.data.title?.length ? parsed.data.title : t("server.untitled"),
                category,
                requestUrl: request.url,
            });
            // Unfiled means private to its creator until they share it.
            await recordUpload(ctx.data, upload);
            return NextResponse.json(result, { status: 201 });
        } catch (err) {
            console.error("[files] create failed:", err);
            return NextResponse.json(
                { error: "create_failed", message: t("server.createFailed") },
                { status: 500 }
            );
        }
    });
}
