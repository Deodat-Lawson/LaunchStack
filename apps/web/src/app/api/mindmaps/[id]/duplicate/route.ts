/** Copy a mindmap into a new document in the same workspace. */

import { NextResponse } from "next/server";

import { db } from "~/server/db";
import { mindmaps } from "~/server/db/schema";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { serverError } from "~/lib/validation";
import { getMindmap, toDetail } from "~/server/mindmap/repository";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const id = Number.parseInt((await params).id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        }

        const source = await getMindmap(id, ctx.data.companyId);
        if (!source) return NextResponse.json({ error: "Mindmap not found" }, { status: 404 });

        const [row] = await db
            .insert(mindmaps)
            .values({
                companyId: ctx.data.companyId,
                createdByUserId: ctx.data.authUserId,
                updatedByUserId: ctx.data.authUserId,
                title: `${source.title} copy`.slice(0, 300),
                description: source.description,
                templateId: source.templateId,
                folder: source.folder,
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

        if (!row) return serverError("Failed to duplicate mindmap");
        return NextResponse.json({ mindmap: toDetail(row) }, { status: 201 });
    } catch (error) {
        console.error("[mindmaps] duplicate failed:", error);
        return serverError("Failed to duplicate mindmap");
    }
}
