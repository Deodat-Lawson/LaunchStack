// POST /api/brand/posts/[id]/publish — publish this post now with the workspace's credentials
import type { NextRequest } from "next/server";

import { publishBrandPost } from "@launchstack/pipelines/marketing/posts";

import { publishForWorkspace } from "~/server/brand/publish";

import { brandContext, handleBrandError, json } from "../../../_http";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await brandContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const post = await publishBrandPost(id, auth.ctx.companyId, {
            publish: publishForWorkspace,
        });
        return json({ post }, post.status === "published" ? 200 : 502);
    } catch (err) {
        return handleBrandError("POST publish", err);
    }
}
