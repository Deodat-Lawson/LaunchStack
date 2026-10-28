/**
 * GET — whether to show the feedback reporter at all, and whether the caller
 * triages: `FeedbackAccess`. Session only (works on the workspace picker).
 * `enabled` is false while the instance names no triager.
 */

import { NextResponse } from "next/server";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import type { FeedbackAccess } from "~/lib/feedback/contract";
import { feedbackAccessFor } from "~/server/feedback/access";
import { resolveFeedbackCaller } from "~/server/feedback/caller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    return withRateLimit(request, RateLimitPresets.permissive, async () => {
        const caller = await resolveFeedbackCaller(request);
        if (!caller.success) return caller.response;
        const access: FeedbackAccess = feedbackAccessFor(caller.data.email);
        return NextResponse.json(access);
    });
}
