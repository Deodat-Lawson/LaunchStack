// POST /api/proposals/funders/search — { keywords?, geography?, applicantType?, includeWeb? } → a run
import type { NextRequest } from "next/server";

import { FunderSearchInputSchema } from "@launchstack/pipelines/proposals/types";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { findFundersRun } from "~/server/proposals/service";

import { error, proposalsContext, handleProposalsError, json, readBody } from "../../_http";

export async function POST(request: NextRequest) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    return withRateLimit(
        request,
        {
            maxRequests: 10,
            windowMs: 15 * 60 * 1000,
            keyGenerator: () => `proposals-funders:${ctx.userId}`,
        },
        async () => {
            try {
                const parsed = FunderSearchInputSchema.safeParse(await readBody(request));
                if (!parsed.success) return error("Check the search and try again", 400);
                return json({ run: await findFundersRun(ctx, parsed.data) }, 202);
            } catch (err) {
                return handleProposalsError("POST funders/search", err);
            }
        }
    );
}
