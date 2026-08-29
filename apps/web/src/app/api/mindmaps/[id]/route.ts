/**
 * Single mindmap — read, save, trash.
 *
 * Saves carry `baseRevision`. When it does not match the row's current
 * revision, another tab (or another person) saved in between and the write is
 * refused with 409 plus the winning document, so the editor can offer to
 * reload rather than silently discarding someone's work.
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { mindmaps } from "~/server/db/schema";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { serverError, UpdateMindmapSchema, validateRequestBody } from "~/lib/validation";
import {
    getMindmap,
    summariseDoc,
    toDetail,
    writeRevision,
    type MindmapDetail,
} from "~/server/mindmap/repository";

function parseId(raw: string): number | null {
    const id = Number.parseInt(raw, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function notFound() {
    return NextResponse.json({ error: "Mindmap not found" }, { status: 404 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const id = parseId((await params).id);
        if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

        const row = await getMindmap(id, ctx.data.companyId);
        if (!row) return notFound();

        // Best-effort recency stamp for the "Recent" rail — a failure here must
        // never stop the document from opening.
        void db
            .update(mindmaps)
            .set({ openedAt: new Date() })
            .where(eq(mindmaps.id, id))
            .catch((err: unknown) => console.error("[mindmaps] openedAt stamp failed:", err));

        return NextResponse.json({ mindmap: toDetail(row) }, { status: 200 });
    } catch (error) {
        console.error("[mindmaps] fetch failed:", error);
        return serverError("Failed to load mindmap");
    }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const id = parseId((await params).id);
        if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

        const validation = await validateRequestBody(request, UpdateMindmapSchema);
        if (!validation.success) return validation.response;
        const body = validation.data;

        const current = await getMindmap(id, ctx.data.companyId);
        if (!current) return notFound();

        const savingDoc = body.doc !== undefined;
        if (
            savingDoc &&
            body.baseRevision !== undefined &&
            body.baseRevision !== current.revision
        ) {
            return NextResponse.json(
                {
                    error: "Conflict",
                    message:
                        "This mindmap was changed elsewhere. Reload to get the latest version.",
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
        if (body.folder !== undefined) patch.folder = body.folder.trim();
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

        const [row] = await db
            .update(mindmaps)
            .set(patch)
            .where(and(eq(mindmaps.id, id), eq(mindmaps.companyId, ctx.data.companyId)))
            .returning();

        if (!row) return notFound();

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

        const detail: MindmapDetail = toDetail(row);
        return NextResponse.json({ mindmap: detail }, { status: 200 });
    } catch (error) {
        console.error("[mindmaps] update failed:", error);
        return serverError("Failed to save mindmap");
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
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const id = parseId((await params).id);
        if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

        const scope = and(eq(mindmaps.id, id), eq(mindmaps.companyId, ctx.data.companyId));
        const purge = new URL(request.url).searchParams.get("purge") === "1";

        if (purge) {
            // Revisions cascade with the row.
            const [row] = await db.delete(mindmaps).where(scope).returning({ id: mindmaps.id });
            if (!row) return notFound();
            return NextResponse.json({ deleted: true, purged: true }, { status: 200 });
        }

        const [row] = await db
            .update(mindmaps)
            .set({ deletedAt: new Date(), updatedByUserId: ctx.data.authUserId })
            .where(scope)
            .returning({ id: mindmaps.id });
        if (!row) return notFound();

        return NextResponse.json({ deleted: true, purged: false }, { status: 200 });
    } catch (error) {
        console.error("[mindmaps] delete failed:", error);
        return serverError("Failed to delete mindmap");
    }
}
