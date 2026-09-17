// GET /api/prospects/home?segmentId=
import type { NextRequest } from "next/server";

import { getHome } from "~/server/prospects/service";

import { error, handleProspectsError, json, prospectsContext } from "../_http";

export async function GET(request: NextRequest) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        const segmentId = request.nextUrl.searchParams.get("segmentId");
        if (!segmentId) return error("segmentId is required", 400);
        return json(await getHome(auth.ctx, segmentId));
    } catch (err) {
        return handleProspectsError("GET home", err);
    }
}
