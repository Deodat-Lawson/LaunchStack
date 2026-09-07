/**
 * Version history: list the snapshots for a mindmap, or restore one.
 *
 * Restoring is itself a save — it bumps the revision and writes a new snapshot
 * — so "undo the restore" is just restoring the entry before it.
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { mindmaps } from "~/server/db/schema";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { serverError } from "~/lib/validation";
import {
    getMindmap,
    getRevision,
    listRevisions,
    summariseDoc,
    toDetail,
    writeRevision,
} from "~/server/mindmap/repository";

function parseId(raw: string): number | null {
    const id = Number.parseInt(raw, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const id = parseId((await params).id);
        if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

        const row = await getMindmap(id, ctx.data.companyId);
        if (!row) return NextResponse.json({ error: "Mindmap not found" }, { status: 404 });

        return NextResponse.json({ revisions: await listRevisions(id) }, { status: 200 });
    } catch (error) {
        console.error("[mindmaps] revisions list failed:", error);
        return serverError("Failed to load history");
    }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const id = parseId((await params).id);
        if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

        const body = (await request.json().catch(() => null)) as { revisionId?: unknown } | null;
        const revisionId =
            typeof body?.revisionId === "number" ? body.revisionId : Number(body?.revisionId);
        if (!Number.isInteger(revisionId) || revisionId <= 0) {
            return NextResponse.json({ error: "revisionId is required" }, { status: 400 });
        }

        const current = await getMindmap(id, ctx.data.companyId);
        if (!current) return NextResponse.json({ error: "Mindmap not found" }, { status: 404 });

        const snapshot = await getRevision(id, revisionId);
        if (!snapshot) return NextResponse.json({ error: "Revision not found" }, { status: 404 });

        const stats = summariseDoc(snapshot.doc);
        const nextRevision = current.revision + 1;

        const [row] = await db
            .update(mindmaps)
            .set({
                doc: snapshot.doc,
                revision: nextRevision,
                nodeCount: stats.nodeCount,
                edgeCount: stats.edgeCount,
                searchText: stats.searchText,
                updatedByUserId: ctx.data.authUserId,
                updatedAt: new Date(),
            })
            .where(and(eq(mindmaps.id, id), eq(mindmaps.companyId, ctx.data.companyId)))
            .returning();

        if (!row) return serverError("Failed to restore revision");

        try {
            await writeRevision({
                mindmapId: id,
                revision: nextRevision,
                doc: snapshot.doc,
                authorUserId: ctx.data.authUserId,
                label: `Restored from v${snapshot.revision}`,
                nodeCount: stats.nodeCount,
            });
        } catch (err) {
            console.error(`[mindmaps] restore snapshot failed for ${id} (restore applied):`, err);
        }

        return NextResponse.json({ mindmap: toDetail(row) }, { status: 200 });
    } catch (error) {
        console.error("[mindmaps] restore failed:", error);
        return serverError("Failed to restore revision");
    }
}
