/**
 * Single mindmap — read, save, trash.
 *
 * Saves carry `baseRevision`. When it does not match the row's current
 * revision, another tab (or another person) saved in between and the write is
 * refused with 409 plus the winning document, so the editor can offer to
 * reload rather than silently discarding someone's work.
 *
 * Access follows the draft's folder (ADR-014, `~/server/mindmap/access`): a
 * draft the caller cannot see is a 404 on every verb; view opens it; edit
 * saves, renames, stars, restores and moves it; trashing takes manage (its
 * creator) or edit plus `documents.delete`. A move also needs edit access to
 * the destination, sends it to Unfiled only for its creator, and never shows
 * it to someone new unless only its mover could see it (Drive's rule). The
 * response says what a move did to its audience, as a file move does.
 */

import { NextResponse } from "next/server";
import { requestTranslator } from "~/i18n/server";
import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { mindmaps } from "~/server/db/schema";
import { isUnfiledFolder, normalizeFolderPath } from "~/lib/folders/path";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { serverError, UpdateMindmapSchema, validateRequestBody } from "~/lib/validation";
import { describeFolderPathProblem } from "~/server/folders/words";
import {
    canEditDraftAt,
    draftAccess,
    draftAccessView,
    draftMoveWidens,
    draftReader,
} from "~/server/mindmap/access";
import {
    getMindmap,
    summariseDoc,
    toDetail,
    writeRevision,
    type MindmapDetail,
} from "~/server/mindmap/repository";
import { activeMemberPrincipals } from "~/server/workspace/grants";
import { canDeleteAtLevel, canEditFolderPath } from "~/server/workspace/item-access";
import { claimFolderPathForDraft } from "~/server/workspace/ownership";

function parseId(raw: string): number | null {
    const id = Number.parseInt(raw, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}

type Words = ReturnType<typeof requestTranslator<"mindmap.server.errors">>;

function notFound(t: Words) {
    return NextResponse.json({ error: t("notFound") }, { status: 404 });
}

function forbidden(error: string) {
    return NextResponse.json({ error }, { status: 403 });
}

function invalidId(request: Request) {
    return NextResponse.json(
        { error: requestTranslator(request, "errors.api")("invalidId") },
        { status: 400 }
    );
}

/** A move refused inside its transaction, so the folder it claimed is rolled back too. */
class MoveRefused extends Error {}

/** What a move did to who can see the draft — the file move's vocabulary. */
type DraftMoveAccess = "inherits_folder" | "made_private";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const t = requestTranslator(request, "mindmap.server.errors");
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const id = parseId((await params).id);
        if (id === null) return invalidId(request);

        const row = await getMindmap(id, await draftReader(ctx.data));
        if (!row) return notFound(t);
        const access = draftAccessView(await draftAccess(ctx.data, row), ctx.data);

        // Best-effort recency stamp for the "Recent" rail — a failure here must
        // never stop the document from opening.
        void db
            .update(mindmaps)
            .set({ openedAt: new Date() })
            .where(eq(mindmaps.id, id))
            .catch((err: unknown) => console.error("[mindmaps] openedAt stamp failed:", err));

        return NextResponse.json({ mindmap: { ...toDetail(row), access } }, { status: 200 });
    } catch (error) {
        console.error("[mindmaps] fetch failed:", error);
        return serverError(t("loadFailed"));
    }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const t = requestTranslator(request, "mindmap.server.errors");
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const id = parseId((await params).id);
        if (id === null) return invalidId(request);

        const validation = await validateRequestBody(request, UpdateMindmapSchema);
        if (!validation.success) return validation.response;
        const body = validation.data;

        const current = await getMindmap(id, await draftReader(ctx.data));
        if (!current) return notFound(t);
        const level = (await draftAccess(ctx.data, current)).level;
        if (!canEditDraftAt(level)) return forbidden(t("editDenied"));

        const fromFolder = normalizeFolderPath(current.folder);
        const toFolder = body.folder === undefined ? fromFolder : normalizeFolderPath(body.folder);
        const moving = toFolder !== fromFolder;
        if (moving) {
            if (isUnfiledFolder(toFolder)) {
                if (current.createdByUserId !== ctx.data.authUserId) {
                    return forbidden(t("unfiledDenied"));
                }
            } else {
                const invalid = describeFolderPathProblem(toFolder, request);
                if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
                if (!(await canEditFolderPath(ctx.data, toFolder))) {
                    return forbidden(
                        requestTranslator(request, "sources.server.errors")("folderEditDenied")
                    );
                }
            }
        }

        const savingDoc = body.doc !== undefined;
        if (
            savingDoc &&
            body.baseRevision !== undefined &&
            body.baseRevision !== current.revision
        ) {
            return NextResponse.json(
                {
                    error: "Conflict",
                    message: t("changedElsewhere"),
                    mindmap: toDetail(current),
                },
                { status: 409 }
            );
        }

        const stats = savingDoc ? summariseDoc(body.doc) : null;
        const nextRevision = savingDoc ? current.revision + 1 : current.revision;

        const patch: Partial<typeof mindmaps.$inferInsert> = {
            updatedByUserId: ctx.data.authUserId,
            updatedAt: new Date(),
        };
        if (body.title !== undefined) patch.title = body.title.trim();
        if (body.description !== undefined) patch.description = body.description;
        if (moving) patch.folder = toFolder;
        if (body.starred !== undefined) patch.starred = body.starred;
        if (body.thumbnail !== undefined) patch.thumbnail = body.thumbnail;
        if (body.restore) patch.deletedAt = null;
        if (savingDoc && stats) {
            patch.doc = body.doc;
            patch.revision = nextRevision;
            patch.nodeCount = stats.nodeCount;
            patch.edgeCount = stats.edgeCount;
            patch.searchText = stats.searchText;
            const version = (body.doc as { schemaVersion?: unknown }).schemaVersion;
            if (typeof version === "number") patch.docVersion = version;
            // A doc save renames the row too when the title travelled inside
            // the document (the editor's title field lives in the doc).
            const docTitle = (body.doc as { title?: unknown }).title;
            if (body.title === undefined && typeof docTitle === "string" && docTitle.trim()) {
                patch.title = docTitle.trim().slice(0, 300);
            }
        }

        // Read before the transaction opens: it holds its connection throughout.
        const members = moving ? await activeMemberPrincipals(ctx.data.companyId) : [];
        let row: typeof current | undefined;
        try {
            row = await db.transaction(async tx => {
                if (moving) {
                    // A path that did not exist comes into being private to
                    // the mover, so filing there widens nothing.
                    const claimed = await claimFolderPathForDraft(tx, ctx.data, toFolder);
                    if (
                        !claimed &&
                        (await draftMoveWidens(ctx.data, current, toFolder, members, tx))
                    ) {
                        throw new MoveRefused();
                    }
                }
                const [updated] = await tx
                    .update(mindmaps)
                    .set(patch)
                    .where(and(eq(mindmaps.id, id), eq(mindmaps.companyId, ctx.data.companyId)))
                    .returning();
                return updated;
            });
        } catch (error) {
            if (error instanceof MoveRefused) {
                return NextResponse.json({ error: t("moveWidens") }, { status: 409 });
            }
            throw error;
        }

        if (!row) return notFound(t);

        if (savingDoc && stats && body.snapshot) {
            // Post-commit and non-fatal: the document is already saved, and a
            // missing history entry is far cheaper than a failed save.
            try {
                await writeRevision({
                    mindmapId: id,
                    revision: nextRevision,
                    doc: body.doc,
                    authorUserId: ctx.data.authUserId,
                    label: body.snapshotLabel,
                    nodeCount: stats.nodeCount,
                });
            } catch (err) {
                console.error(`[mindmaps] snapshot failed for ${id} (document saved):`, err);
            }
        }

        const detail: MindmapDetail = {
            ...toDetail(row),
            access: draftAccessView(await draftAccess(ctx.data, row), ctx.data),
        };
        const moveAccess: DraftMoveAccess | null = moving
            ? isUnfiledFolder(toFolder)
                ? "made_private"
                : "inherits_folder"
            : null;
        return NextResponse.json(
            {
                mindmap: detail,
                // Present only for a move, as for a file: `inherits_folder` —
                // now visible to whoever can open the new folder; `made_private`
                // — filed loose, so only its creator.
                ...(moveAccess
                    ? { move: { from: fromFolder, to: toFolder, access: moveAccess } }
                    : {}),
            },
            { status: 200 }
        );
    } catch (error) {
        console.error("[mindmaps] update failed:", error);
        return serverError(t("saveFailed"));
    }
}

/**
 * Alias of PATCH for `navigator.sendBeacon`, which can only issue POST. The
 * editor uses it to flush an unsaved document as the tab closes — a normal
 * fetch is aborted during teardown, a beacon is not.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    return PATCH(request, context);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const t = requestTranslator(request, "mindmap.server.errors");
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const id = parseId((await params).id);
        if (id === null) return invalidId(request);

        const current = await getMindmap(id, await draftReader(ctx.data));
        if (!current) return notFound(t);
        const level = (await draftAccess(ctx.data, current)).level;
        if (!canEditDraftAt(level)) return forbidden(t("editDenied"));
        if (!canDeleteAtLevel(level, ctx.data.permissions)) return forbidden(t("deleteDenied"));

        const scope = and(eq(mindmaps.id, id), eq(mindmaps.companyId, ctx.data.companyId));
        const purge = new URL(request.url).searchParams.get("purge") === "1";

        if (purge) {
            // Revisions cascade with the row.
            const [row] = await db.delete(mindmaps).where(scope).returning({ id: mindmaps.id });
            if (!row) return notFound(t);
            return NextResponse.json({ deleted: true, purged: true }, { status: 200 });
        }

        const [row] = await db
            .update(mindmaps)
            .set({ deletedAt: new Date(), updatedByUserId: ctx.data.authUserId })
            .where(scope)
            .returning({ id: mindmaps.id });
        if (!row) return notFound(t);

        return NextResponse.json({ deleted: true, purged: false }, { status: 200 });
    } catch (error) {
        console.error("[mindmaps] delete failed:", error);
        return serverError(t("deleteFailed"));
    }
}
