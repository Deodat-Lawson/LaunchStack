/**
 * One feedback report.
 *
 * GET   → `{ report: FeedbackDetail }`, shaped for the reader (see
 *         ~/server/feedback/present). A report the caller may not see is a
 *         404, the same as one that does not exist.
 * PATCH `updateFeedbackSchema` (status and/or severity) → `{ report }`.
 *         Triagers only (403). A status change tells the reporter in their
 *         workspace inbox.
 */

import { NextResponse } from "next/server";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { updateFeedbackSchema } from "~/lib/feedback/contract";
import { requestTranslator } from "~/i18n/server";
import { resolveFeedbackCaller } from "~/server/feedback/caller";
import { getFeedbackReport, updateFeedbackReport } from "~/server/feedback/store";
import {
    invalidIdResponse,
    parseIdParam,
    parseJsonBody,
    workspaceErrorResponse,
} from "~/server/workspace/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        const caller = await resolveFeedbackCaller(request);
        if (!caller.success) return caller.response;
        const id = parseIdParam((await params).id);
        if (id === null) return invalidIdResponse(request);
        try {
            return NextResponse.json({ report: await getFeedbackReport(caller.data, id) });
        } catch (error) {
            return workspaceErrorResponse(error, "[feedback/:id GET]", request);
        }
    });
}

export async function PATCH(request: Request, { params }: Params) {
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        const caller = await resolveFeedbackCaller(request);
        if (!caller.success) return caller.response;
        if (!caller.data.triager) {
            return NextResponse.json(
                { error: requestTranslator(request, "errors.feedback")("triagersOnly") },
                { status: 403 }
            );
        }
        const id = parseIdParam((await params).id);
        if (id === null) return invalidIdResponse(request);
        const body = await parseJsonBody(request, updateFeedbackSchema);
        if (!body.success) return body.response;
        try {
            const report = await updateFeedbackReport(caller.data, id, body.data);
            return NextResponse.json({ report });
        } catch (error) {
            return workspaceErrorResponse(error, "[feedback/:id PATCH]", request);
        }
    });
}
