/**
 * GET /api/ask/starters[?refresh=1]
 *
 * The four starter questions for the caller's active workspace, generated
 * from what the company does and what its knowledge base holds. Any verified
 * member may ask; the set is company-scoped and cached server-side, so the
 * page-load cost is one round trip.
 *
 * `refresh=1` asks for a different set (the Shuffle button). It always costs
 * a model call, so it sits behind the burst limiter rather than the standard
 * one.
 */

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { handleRouteError, ok } from "~/server/api/responses";
import { getAskStarters } from "~/server/ask-starters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const limit = refresh ? RateLimitPresets.burst : RateLimitPresets.standard;

    return withRateLimit(request, limit, async () => {
        try {
            const ctx = await requireWorkspaceContext();
            if (!ctx.success) return ctx.response;

            const payload = await getAskStarters({ companyId: ctx.data.companyId, refresh });
            return ok(payload);
        } catch (error) {
            return handleRouteError("ask-starters", error);
        }
    });
}
