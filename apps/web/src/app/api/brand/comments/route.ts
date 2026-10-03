// GET /api/brand/comments?status=open|all — the Engagement inbox
import type { NextRequest } from "next/server";

import { listChannelRows } from "~/server/brand/channels";
import { listBrandComments } from "~/server/brand/comments";

import { brandContext, handleBrandError, json } from "../_http";

export async function GET(request: NextRequest) {
    const auth = await brandContext();
    if (!auth.ok) return auth.response;
    try {
        const status = request.nextUrl.searchParams.get("status") === "all" ? "all" : "open";
        const comments = await listBrandComments(auth.ctx.companyId, status);
        const synced = (await listChannelRows(auth.ctx.companyId))
            .map(r => r.syncedAt?.getTime() ?? 0)
            .filter(t => t > 0);
        return json({
            comments,
            syncedAt: synced.length > 0 ? new Date(Math.max(...synced)) : null,
        });
    } catch (err) {
        return handleBrandError("GET comments", err);
    }
}
