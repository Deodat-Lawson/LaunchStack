// GET /api/proposals/runs?applicationId= — recent runs, newest first
import type { NextRequest } from "next/server";

import { loadRuns } from "~/server/proposals/service";

import { proposalsContext, handleProposalsError, json } from "../_http";

export async function GET(request: NextRequest) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        const applicationId = request.nextUrl.searchParams.get("applicationId") ?? undefined;
        return json({ runs: await loadRuns(auth.ctx, applicationId) });
    } catch (err) {
        return handleProposalsError("GET runs", err);
    }
}
