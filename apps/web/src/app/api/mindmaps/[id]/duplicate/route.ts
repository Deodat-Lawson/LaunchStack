/**
 * Copy a mindmap into a new document in the same workspace.
 *
 * Anyone who can open a draft may copy it; the copy is theirs. It lands
 * beside the original when they can add to that folder, and in their own
 * Unfiled otherwise — a copy never files itself somewhere its maker could not
 * (ADR-014).
 */

import { NextResponse } from "next/server";

import { requestTranslator } from "~/i18n/server";

import { db } from "~/server/db";
import { mindmaps } from "~/server/db/schema";
import { UNFILED_FOLDER, isUnfiledFolder, normalizeFolderPath } from "~/lib/folders/path";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { serverError } from "~/lib/validation";
import { describeDraftAccess, draftReader } from "~/server/mindmap/access";
import { getMindmap, toDetail } from "~/server/mindmap/repository";
import { canEditFolderPath } from "~/server/workspace/item-access";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const t = requestTranslator(request, "mindmap.server.errors");
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const id = Number.parseInt((await params).id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return NextResponse.json(
                { error: requestTranslator(request, "errors.api")("invalidId") },
                { status: 400 }
            );
        }

        const source = await getMindmap(id, await draftReader(ctx.data));
        if (!source) return NextResponse.json({ error: t("notFound") }, { status: 404 });
        const sourceFolder = normalizeFolderPath(source.folder);
        const folder =
            isUnfiledFolder(sourceFolder) || (await canEditFolderPath(ctx.data, sourceFolder))
                ? sourceFolder
                : UNFILED_FOLDER;

        const [row] = await db
            .insert(mindmaps)
            .values({
                companyId: ctx.data.companyId,
                createdByUserId: ctx.data.authUserId,
                updatedByUserId: ctx.data.authUserId,
                title: `${source.title} copy`.slice(0, 300),
                description: source.description,
                templateId: source.templateId,
                folder,
                doc: source.doc,
                docVersion: source.docVersion,
                revision: 1,
                thumbnail: source.thumbnail,
                searchText: source.searchText,
                nodeCount: source.nodeCount,
                edgeCount: source.edgeCount,
                openedAt: new Date(),
            })
            .returning();

        if (!row) return serverError(t("duplicateFailed"));
        const [access] = (await describeDraftAccess(ctx.data, [row])).values();
        return NextResponse.json({ mindmap: { ...toDetail(row), access } }, { status: 201 });
    } catch (error) {
        console.error("[mindmaps] duplicate failed:", error);
        return serverError(t("duplicateFailed"));
    }
}
