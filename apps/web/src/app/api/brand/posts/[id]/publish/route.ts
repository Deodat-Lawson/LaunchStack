// POST /api/brand/posts/[id]/publish — publish this post now
import type { NextRequest } from "next/server";

import { publishBrandPost } from "@launchstack/pipelines/marketing/posts";

import { brandContext, handleBrandError, json } from "../../../_http";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await brandContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const post = await publishBrandPost(id, auth.ctx.companyId);
        return json({ post }, post.status === "published" ? 200 : 502);
    } catch (err) {
        return handleBrandError("POST publish", err);
    }
}
