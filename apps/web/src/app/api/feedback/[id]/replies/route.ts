/**
 * POST `replyFeedbackSchema` → 201 `{ reply: FeedbackReply }`.
 *
 * The reporter or a triager; a triager's reply is the team's (`fromTeam`) and
 * tells the reporter in their workspace inbox. Someone reading another
 * person's idea on the board gets a 403; a report they cannot see, a 404.
 */

import { NextResponse } from "next/server";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { replyFeedbackSchema } from "~/lib/feedback/contract";
import { resolveFeedbackCaller } from "~/server/feedback/caller";
import { FEEDBACK_REPLY_LIMIT } from "~/server/feedback/limits";
import { replyToFeedback } from "~/server/feedback/store";
import {
    invalidIdResponse,
    parseIdParam,
    parseJsonBody,
    workspaceErrorResponse,
} from "~/server/workspace/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    return withRateLimit(request, FEEDBACK_REPLY_LIMIT, async () => {
        const caller = await resolveFeedbackCaller(request);
        if (!caller.success) return caller.response;
        const id = parseIdParam((await params).id);
        if (id === null) return invalidIdResponse(request);
        const body = await parseJsonBody(request, replyFeedbackSchema);
        if (!body.success) return body.response;
        try {
            const reply = await replyToFeedback(caller.data, id, body.data.body);
            return NextResponse.json({ reply }, { status: 201 });
        } catch (error) {
            return workspaceErrorResponse(error, "[feedback/:id/replies POST]", request);
        }
    });
}
