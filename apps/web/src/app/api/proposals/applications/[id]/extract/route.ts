// POST /api/proposals/applications/[id]/extract — queue a extract run for this application
import type { NextRequest } from "next/server";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { extractRun } from "~/server/proposals/service";

import { proposalsContext, handleProposalsError, json } from "../../../_http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    return withRateLimit(
        request,
        {
            maxRequests: 20,
            windowMs: 15 * 60 * 1000,
            keyGenerator: () => `proposals-extract:${ctx.userId}`,
        },
        async () => {
            try {
                const { id } = await params;
                return json({ run: await extractRun(ctx, id) }, 202);
            } catch (err) {
                return handleProposalsError("POST extract", err);
            }
        }
    );
}
