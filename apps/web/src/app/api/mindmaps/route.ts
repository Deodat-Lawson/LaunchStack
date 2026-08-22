/**
 * Mindmap collection endpoint — list and create.
 *
 * Documents are workspace-scoped, not user-scoped: anyone in the company can
 * open a map their colleague drew, matching how Sources already behave.
 */

import { NextResponse } from "next/server";

import { db } from "~/server/db";
import { mindmaps } from "~/server/db/schema";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { CreateMindmapSchema, serverError, validateRequestBody } from "~/lib/validation";
import { listFolders, listMindmaps, summariseDoc, toDetail } from "~/server/mindmap/repository";

/** Trimmed value, or `undefined` when missing or blank (`??` can't do blank). */
function nonEmpty(value: string | null | undefined): string | undefined {
    const trimmed = value?.trim();
    if (trimmed === undefined || trimmed === "") return undefined;
    return trimmed;
}

export async function GET(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const { searchParams } = new URL(request.url);
        const scope = searchParams.get("scope") === "trash" ? "trash" : "active";

        const [items, folders] = await Promise.all([
            listMindmaps({
                companyId: ctx.data.companyId,
                scope,
                folder: searchParams.get("folder") ?? undefined,
                search: nonEmpty(searchParams.get("q")),
                starredOnly: searchParams.get("starred") === "1",
                createdByUserId:
                    searchParams.get("mine") === "1" ? ctx.data.clerkUserId : undefined,
                limit: Number(searchParams.get("limit")) || undefined,
            }),
            listFolders(ctx.data.companyId),
        ]);

        return NextResponse.json({ mindmaps: items, folders }, { status: 200 });
    } catch (error) {
        console.error("[mindmaps] list failed:", error);
        return serverError("Failed to load mindmaps");
    }
}

export async function POST(request: Request) {
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

        const [row] = await db
            .insert(mindmaps)
            .values({
                companyId: ctx.data.companyId,
                createdByUserId: ctx.data.clerkUserId,
                updatedByUserId: ctx.data.clerkUserId,
                title: nonEmpty(body.title) ?? "Untitled mindmap",
                description: body.description ?? null,
                templateId: body.templateId ?? null,
                folder: nonEmpty(body.folder) ?? "Unfiled",
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

        if (!row) return serverError("Failed to create mindmap");
        return NextResponse.json({ mindmap: toDetail(row) }, { status: 201 });
    } catch (error) {
        console.error("[mindmaps] create failed:", error);
        return serverError("Failed to create mindmap");
    }
}
