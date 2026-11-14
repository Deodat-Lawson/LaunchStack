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

import { isUnfiledFolder, normalizeFolderPath } from "~/lib/folders/path";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { CreateMindmapSchema, serverError, validateRequestBody } from "~/lib/validation";
import { describeFolderPathProblem } from "~/server/folders/words";
import { describeDraftAccess, draftReader } from "~/server/mindmap/access";
import { createMindmapDraft, DraftFolderError } from "~/server/mindmap/create";
import { listFolders, listMindmaps, toDetail } from "~/server/mindmap/repository";

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
        const folder = normalizeFolderPath(body.folder);
        if (!isUnfiledFolder(folder)) {
            const invalid = describeFolderPathProblem(folder, request);
            if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
        }

        let row;
        try {
            row = await createMindmapDraft(ctx.data, {
                title: nonEmpty(body.title),
                description: body.description,
                templateId: body.templateId,
                folder,
                doc: body.doc,
            });
        } catch (error) {
            if (error instanceof DraftFolderError) {
                return error.reason === "denied"
                    ? NextResponse.json(
                          {
                              error: requestTranslator(
                                  request,
                                  "sources.server.errors"
                              )("folderEditDenied"),
                          },
                          { status: 403 }
                      )
                    : NextResponse.json({ error: error.message }, { status: 400 });
            }
            throw error;
        }

        const [access] = (await describeDraftAccess(ctx.data, [row])).values();
        return NextResponse.json({ mindmap: { ...toDetail(row), access } }, { status: 201 });
    } catch (error) {
        console.error("[mindmaps] create failed:", error);
        return serverError(t("createFailed"));
    }
}
