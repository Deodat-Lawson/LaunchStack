// PATCH /api/brand/comments/[id] — { handled }: mark a comment done, or open it again
import type { NextRequest } from "next/server";
import { z } from "zod";

import { setCommentHandled } from "~/server/brand/comments";

import { brandContext, error, handleBrandError, json, readBody } from "../../_http";

const PatchSchema = z.object({ handled: z.boolean() });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await brandContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const parsed = PatchSchema.safeParse(await readBody(request));
        if (!parsed.success) return error("Say whether the comment is done", 400);
        const comment = await setCommentHandled(
            auth.ctx.companyId,
            id,
            parsed.data.handled,
            auth.ctx.userId
        );
        if (!comment) return error("Comment not found", 404);
        return json({ comment });
    } catch (err) {
        return handleBrandError("PATCH comment", err);
    }
}
