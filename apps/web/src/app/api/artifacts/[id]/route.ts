/**
 * Single artifact — read, update, trash.
 *
 * Updating `content` re-derives the size, hash, and search text, and re-runs
 * type detection unless the request pins `artifactType` explicitly — an edit
 * that turns a Markdown note into an HTML page should follow it.
 */

import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { artifactSearchText, detectArtifactType } from "~/lib/artifact-content";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { serverError, UpdateArtifactSchema, validateRequestBody } from "~/lib/validation";
import { db } from "~/server/db";
import { claudeArtifacts } from "~/server/db/schema";
import { getArtifact, toDetail } from "~/server/artifacts/repository";

function parseId(raw: string): number | null {
    const id = Number.parseInt(raw, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function notFound() {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const id = parseId((await params).id);
        if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

        const row = await getArtifact(id, ctx.data.companyId);
        if (!row) return notFound();

        // Best-effort recency stamp — a failure here must never stop the
        // artifact from opening.
        void db
            .update(claudeArtifacts)
            .set({ openedAt: new Date() })
            .where(eq(claudeArtifacts.id, id))
            .catch((err: unknown) => console.error("[artifacts] openedAt stamp failed:", err));

        return NextResponse.json({ artifact: toDetail(row) }, { status: 200 });
    } catch (error) {
        console.error("[artifacts] fetch failed:", error);
        return serverError("Failed to load artifact");
    }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const id = parseId((await params).id);
        if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

        const validation = await validateRequestBody(request, UpdateArtifactSchema);
        if (!validation.success) return validation.response;
        const body = validation.data;

        const current = await getArtifact(id, ctx.data.companyId);
        if (!current) return notFound();

        const patch: Partial<typeof claudeArtifacts.$inferInsert> = {
            updatedByUserId: ctx.data.authUserId,
            updatedAt: new Date(),
        };
        if (body.title !== undefined) patch.title = body.title.trim();
        if (body.description !== undefined) patch.description = body.description;
        if (body.folder !== undefined) patch.folder = body.folder.trim();
        if (body.starred !== undefined) patch.starred = body.starred;
        if (body.sourceUrl !== undefined) patch.sourceUrl = body.sourceUrl;
        if (body.artifactType !== undefined) patch.artifactType = body.artifactType;
        if (body.restore) patch.deletedAt = null;
        if (body.content !== undefined) {
            patch.content = body.content;
            patch.sizeBytes = Buffer.byteLength(body.content, "utf-8");
            patch.contentHash = createHash("sha256").update(body.content).digest("hex");
            patch.searchText = artifactSearchText(body.content);
            if (body.artifactType === undefined) {
                patch.artifactType = detectArtifactType(body.content);
            }
        }

        const [row] = await db
            .update(claudeArtifacts)
            .set(patch)
            .where(
                and(eq(claudeArtifacts.id, id), eq(claudeArtifacts.companyId, ctx.data.companyId))
            )
            .returning();

        if (!row) return notFound();
        return NextResponse.json({ artifact: toDetail(row) }, { status: 200 });
    } catch (error) {
        console.error("[artifacts] update failed:", error);
        return serverError("Failed to update artifact");
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const id = parseId((await params).id);
        if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

        const scope = and(
            eq(claudeArtifacts.id, id),
            eq(claudeArtifacts.companyId, ctx.data.companyId)
        );
        const purge = new URL(request.url).searchParams.get("purge") === "1";

        if (purge) {
            const [row] = await db
                .delete(claudeArtifacts)
                .where(scope)
                .returning({ id: claudeArtifacts.id });
            if (!row) return notFound();
            return NextResponse.json({ deleted: true, purged: true }, { status: 200 });
        }

        const [row] = await db
            .update(claudeArtifacts)
            .set({ deletedAt: new Date(), updatedByUserId: ctx.data.authUserId })
            .where(scope)
            .returning({ id: claudeArtifacts.id });
        if (!row) return notFound();

        return NextResponse.json({ deleted: true, purged: false }, { status: 200 });
    } catch (error) {
        console.error("[artifacts] delete failed:", error);
        return serverError("Failed to delete artifact");
    }
}
