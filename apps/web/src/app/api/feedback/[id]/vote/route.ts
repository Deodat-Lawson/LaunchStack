/**
 * The caller's vote on an idea.
 *
 * PUT    → `{ votes, voted: true }`  (voting twice is a no-op)
 * DELETE → `{ votes, voted: false }` (so is withdrawing a vote never cast)
 *
 * Ideas only: a bug is a 400. A report the caller cannot see is a 404.
 */

import { NextResponse } from "next/server";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { resolveFeedbackCaller } from "~/server/feedback/caller";
import { setFeedbackVote } from "~/server/feedback/store";
import { invalidIdResponse, parseIdParam, workspaceErrorResponse } from "~/server/workspace/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function vote(request: Request, params: Params["params"], on: boolean) {
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        const caller = await resolveFeedbackCaller(request);
        if (!caller.success) return caller.response;
        const id = parseIdParam((await params).id);
        if (id === null) return invalidIdResponse(request);
        try {
            return NextResponse.json(await setFeedbackVote(caller.data, id, on));
        } catch (error) {
            return workspaceErrorResponse(
                error,
                `[feedback/:id/vote ${on ? "PUT" : "DELETE"}]`,
                request
            );
        }
    });
}

export async function PUT(request: Request, { params }: Params) {
    return vote(request, params, true);
}

export async function DELETE(request: Request, { params }: Params) {
    return vote(request, params, false);
}
