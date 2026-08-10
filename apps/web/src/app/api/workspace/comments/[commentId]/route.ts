import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";

import { validateRequestBody } from "~/lib/validation";
import { db } from "~/server/db";
import { workspaceComments } from "~/server/db/schema/workspace";
import { serializeComment } from "~/server/workspace/service";
import { getWorkspaceSession } from "~/server/workspace/session";

const UpdateCommentSchema = z.object({
    body: z.string().min(1).max(10000).optional(),
    resolved: z.boolean().optional(),
});

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ commentId: string }> }
) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { commentId } = await params;
        const id = Number.parseInt(commentId, 10);
        if (Number.isNaN(id)) {
            return NextResponse.json({ error: "Invalid comment id" }, { status: 400 });
        }

        const validation = await validateRequestBody(request, UpdateCommentSchema);
        if (!validation.success) return validation.response;
        const { body, resolved } = validation.data;

        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if (body !== undefined) patch.body = body;
        if (resolved !== undefined) {
            patch.resolved = resolved;
            patch.resolvedAt = resolved ? new Date() : null;
            patch.resolvedBy = resolved ? session.userId : null;
        }

        const [comment] = await db
            .update(workspaceComments)
            .set(patch)
            .where(
                and(
                    eq(workspaceComments.id, id),
                    eq(workspaceComments.userId, session.userId)
                )
            )
            .returning();

        if (!comment) {
            return NextResponse.json({ error: "Comment not found" }, { status: 404 });
        }

        // Resolving a thread root resolves its replies — Notion collapses the
        // whole thread, so leaving replies unresolved would be a lie.
        if (resolved !== undefined && comment.parentCommentId === null) {
            await db
                .update(workspaceComments)
                .set({ resolved, resolvedAt: resolved ? new Date() : null })
                .where(
                    and(
                        eq(workspaceComments.parentCommentId, id),
                        eq(workspaceComments.userId, session.userId)
                    )
                );
        }

        return NextResponse.json({ comment: serializeComment(comment) }, { status: 200 });
    } catch (error) {
        console.error("[workspace/comments/:id] PATCH failed:", error);
        return NextResponse.json({ error: "Failed to update comment" }, { status: 500 });
    }
}

/** Deleting a thread root deletes its replies with it. */
export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ commentId: string }> }
) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { commentId } = await params;
        const id = Number.parseInt(commentId, 10);
        if (Number.isNaN(id)) {
            return NextResponse.json({ error: "Invalid comment id" }, { status: 400 });
        }

        const deleted = await db
            .delete(workspaceComments)
            .where(
                and(
                    eq(workspaceComments.userId, session.userId),
                    or(
                        eq(workspaceComments.id, id),
                        eq(workspaceComments.parentCommentId, id)
                    )
                )
            )
            .returning({ id: workspaceComments.id });

        if (deleted.length === 0) {
            return NextResponse.json({ error: "Comment not found" }, { status: 404 });
        }

        return NextResponse.json({ deleted: deleted.map((d) => d.id) }, { status: 200 });
    } catch (error) {
        console.error("[workspace/comments/:id] DELETE failed:", error);
        return NextResponse.json({ error: "Failed to delete comment" }, { status: 500 });
    }
}
