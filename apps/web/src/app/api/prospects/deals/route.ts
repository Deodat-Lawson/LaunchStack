// GET /api/prospects/deals?segmentId=
import type { NextRequest } from "next/server";

import { listDeals } from "~/server/prospects/service";

import { error, handleProspectsError, json, prospectsContext } from "../_http";

export async function GET(request: NextRequest) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        const segmentId = request.nextUrl.searchParams.get("segmentId");
        if (!segmentId) return error("segmentId is required", 400);
        return json({ deals: await listDeals(auth.ctx, segmentId) });
    } catch (err) {
        return handleProspectsError("GET deals", err);
    }
}
