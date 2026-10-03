// GET /api/proposals/runs/[id] — one run, polled while it is live
import type { NextRequest } from "next/server";

import { loadRun } from "~/server/proposals/service";

import { proposalsContext, handleProposalsError, json } from "../../_http";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        return json({ run: await loadRun(auth.ctx, id) });
    } catch (err) {
        return handleProposalsError("GET run", err);
    }
}
