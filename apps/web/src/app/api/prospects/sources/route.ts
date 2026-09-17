// GET /api/prospects/sources?segmentId= — what the gather stage has today, with key availability
import type { NextRequest } from "next/server";

import { listSources } from "~/server/prospects/service";

import { error, handleProspectsError, json, prospectsContext } from "../_http";

export async function GET(request: NextRequest) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        const segmentId = request.nextUrl.searchParams.get("segmentId");
        if (!segmentId) return error("segmentId is required", 400);
        return json({ sources: await listSources(auth.ctx, segmentId) });
    } catch (err) {
        return handleProspectsError("GET sources", err);
    }
}
