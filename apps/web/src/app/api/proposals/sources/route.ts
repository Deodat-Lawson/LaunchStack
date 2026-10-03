// GET /api/proposals/sources?q= — Sources a request can be read from
import type { NextRequest } from "next/server";

import { proposalsContext, handleProposalsError, json } from "../_http";
import { listSourceOptions } from "~/server/proposals/service";

export async function GET(request: NextRequest) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        const q = request.nextUrl.searchParams.get("q") ?? undefined;
        return json({ sources: await listSourceOptions(auth.ctx, q?.slice(0, 120)) });
    } catch (err) {
        return handleProposalsError("GET sources", err);
    }
}
