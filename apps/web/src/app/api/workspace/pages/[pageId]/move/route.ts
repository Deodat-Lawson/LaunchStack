import { NextResponse } from "next/server";
import { z } from "zod";

import { validateRequestBody } from "~/lib/validation";
import { movePage, serializePage } from "~/server/workspace/service";
import { getWorkspaceSession } from "~/server/workspace/session";

const MoveSchema = z.object({
    /** Null re-parents the page to the top level. */
    parentPageId: z.string().uuid().nullable(),
    /** Insertion index among the destination's children; defaults to first. */
    index: z.number().int().min(0).optional(),
});

export async function POST(
    request: Request,
    { params }: { params: Promise<{ pageId: string }> }
) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { pageId } = await params;
        const validation = await validateRequestBody(request, MoveSchema);
        if (!validation.success) return validation.response;

        const page = await movePage(
            session.userId,
            pageId,
            validation.data.parentPageId,
            validation.data.index ?? 0
        );
        if (!page) {
            // Either the page is gone or the destination is inside its own
            // subtree — both are "this move cannot happen".
            return NextResponse.json({ error: "Invalid move" }, { status: 400 });
        }

        return NextResponse.json({ page: serializePage(page) }, { status: 200 });
    } catch (error) {
        console.error("[workspace/pages/:id/move] failed:", error);
        return NextResponse.json({ error: "Failed to move page" }, { status: 500 });
    }
}
