// POST /api/brand/comments/[id]/reply — { text }: answer as the channel the post went out on
import type { NextRequest } from "next/server";
import { z } from "zod";

import { replyToComment } from "~/server/brand/comments";

import { brandContext, error, handleBrandError, json, readBody } from "../../../_http";

const ReplySchema = z.object({ text: z.string().min(1).max(5000) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await brandContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const parsed = ReplySchema.safeParse(await readBody(request));
        if (!parsed.success) return error("Write a reply first", 400);
        const comment = await replyToComment({
            companyId: auth.ctx.companyId,
            userId: auth.ctx.userId,
            commentId: id,
            text: parsed.data.text,
        });
        return json({ comment }, 201);
    } catch (err) {
        return handleBrandError("POST reply", err);
    }
}
