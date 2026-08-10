import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { z } from "zod";

import { validateRequestBody } from "~/lib/validation";
import { db } from "~/server/db";
import { workspaceComments } from "~/server/db/schema/workspace";
import { getPage, listComments, serializeComment } from "~/server/workspace/service";
import { getWorkspaceSession } from "~/server/workspace/session";

const CreateCommentSchema = z.object({
    /** Omit for a page-level comment. */
    blockId: z.string().max(36).nullish(),
    anchorText: z.string().max(2000).nullish(),
    parentCommentId: z.number().int().nullish(),
    body: z.string().min(1).max(10000),
});

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ pageId: string }> }
) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { pageId } = await params;
        const comments = await listComments(session.userId, pageId);

        return NextResponse.json({ comments }, { status: 200 });
    } catch (error) {
        console.error("[workspace/comments] GET failed:", error);
        return NextResponse.json({ error: "Failed to load comments" }, { status: 500 });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ pageId: string }> }
) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { pageId } = await params;
        const validation = await validateRequestBody(request, CreateCommentSchema);
        if (!validation.success) return validation.response;
        const body = validation.data;

        const page = await getPage(session.userId, pageId);
        if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

        const user = await currentUser();
        const [comment] = await db
            .insert(workspaceComments)
            .values({
                pageId,
                userId: session.userId,
                authorName:
                    user?.fullName ??
                    user?.username ??
                    user?.emailAddresses[0]?.emailAddress ??
                    null,
                authorAvatar: user?.imageUrl ?? null,
                blockId: body.blockId ?? null,
                anchorText: body.anchorText ?? null,
                parentCommentId: body.parentCommentId ?? null,
                body: body.body,
            })
            .returning();

        if (!comment) {
            return NextResponse.json({ error: "Failed to comment" }, { status: 500 });
        }

        return NextResponse.json({ comment: serializeComment(comment) }, { status: 201 });
    } catch (error) {
        console.error("[workspace/comments] POST failed:", error);
        return NextResponse.json({ error: "Failed to create comment" }, { status: 500 });
    }
}
