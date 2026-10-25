/**
 * Mindmap collection endpoint — list and create.
 *
 * A draft is seen by whoever can open its folder, and an Unfiled draft only
 * by whoever made it (ADR-014, `~/server/mindmap/access`). Creating one in a
 * folder takes edit access to that folder, as adding a file does; a folder
 * path that does not exist yet comes into being private to its creator.
 */

import { NextResponse } from "next/server";

import { requestTranslator } from "~/i18n/server";

import { db } from "~/server/db";
import { mindmaps } from "~/server/db/schema";
import { isUnfiledFolder, normalizeFolderPath } from "~/lib/folders/path";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { CreateMindmapSchema, serverError, validateRequestBody } from "~/lib/validation";
import { describeFolderPathProblem } from "~/server/folders/words";
import { describeDraftAccess, draftReader } from "~/server/mindmap/access";
import { listFolders, listMindmaps, summariseDoc, toDetail } from "~/server/mindmap/repository";
import { canEditFolderPath } from "~/server/workspace/item-access";
import { claimFolderPathForDraft } from "~/server/workspace/ownership";

/** Trimmed value, or `undefined` when missing or blank (`??` can't do blank). */
function nonEmpty(value: string | null | undefined): string | undefined {
    const trimmed = value?.trim();
    if (trimmed === undefined || trimmed === "") return undefined;
    return trimmed;
}

export async function GET(request: Request) {
    const t = requestTranslator(request, "mindmap.server.errors");
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const { searchParams } = new URL(request.url);
        const scope = searchParams.get("scope") === "trash" ? "trash" : "active";
        // Thumbnails are data URIs that can run to megabytes each; a list is
        // not the place for them. `hasThumbnail` says whether the image route
        // will answer.
        const includeThumbnails = searchParams.get("thumbnails") === "1";

        const reader = await draftReader(ctx.data);
        const [rows, folders] = await Promise.all([
            listMindmaps(reader, {
                scope,
                folder: searchParams.get("folder") ?? undefined,
                search: nonEmpty(searchParams.get("q")),
                starredOnly: searchParams.get("starred") === "1",
                createdByUserId: searchParams.get("mine") === "1" ? ctx.data.authUserId : undefined,
                limit: Number(searchParams.get("limit")) || undefined,
            }),
            listFolders(reader),
        ]);
        const access = await describeDraftAccess(ctx.data, rows);
        const items = rows.map(row => ({
            ...row,
            thumbnail: includeThumbnails ? row.thumbnail : null,
            access: access.get(row.id),
        }));

        return NextResponse.json({ mindmaps: items, folders }, { status: 200 });
    } catch (error) {
        console.error("[mindmaps] list failed:", error);
        return serverError(t("listFailed"));
    }
}

export async function POST(request: Request) {
    const t = requestTranslator(request, "mindmap.server.errors");
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const validation = await validateRequestBody(request, CreateMindmapSchema);
        if (!validation.success) return validation.response;
        const body = validation.data;

        // A create with no `doc` is the "blank map" path; the editor fills it
        // in on first save. Templates arrive already built by the client so the
        // template registry stays in one place.
        const doc = body.doc ?? {
            schemaVersion: 1,
            title: body.title ?? "Untitled mindmap",
            pages: [],
            activePageId: "",
            comments: [],
            settings: {},
        };
        const stats = summariseDoc(doc);

        const folder = normalizeFolderPath(body.folder);
        if (!isUnfiledFolder(folder)) {
            const invalid = describeFolderPathProblem(folder, request);
            if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
            if (!(await canEditFolderPath(ctx.data, folder))) {
                return NextResponse.json(
                    {
                        error: requestTranslator(
                            request,
                            "sources.server.errors"
                        )("folderEditDenied"),
                    },
                    { status: 403 }
                );
            }
        }

        const row = await db.transaction(async tx => {
            await claimFolderPathForDraft(tx, ctx.data, folder);
            const [inserted] = await tx
                .insert(mindmaps)
                .values({
                    companyId: ctx.data.companyId,
                    createdByUserId: ctx.data.authUserId,
                    updatedByUserId: ctx.data.authUserId,
                    title: nonEmpty(body.title) ?? "Untitled mindmap",
                    description: body.description ?? null,
                    templateId: body.templateId ?? null,
                    folder,
                    doc,
                    docVersion:
                        typeof (doc as { schemaVersion?: unknown }).schemaVersion === "number"
                            ? (doc as { schemaVersion: number }).schemaVersion
                            : 1,
                    revision: 1,
                    nodeCount: stats.nodeCount,
                    edgeCount: stats.edgeCount,
                    searchText: stats.searchText,
                    openedAt: new Date(),
                })
                .returning();
            return inserted;
        });

        if (!row) return serverError(t("createFailed"));
        const [access] = (await describeDraftAccess(ctx.data, [row])).values();
        return NextResponse.json({ mindmap: { ...toDetail(row), access } }, { status: 201 });
    } catch (error) {
        console.error("[mindmaps] create failed:", error);
        return serverError(t("createFailed"));
    }
}
