// GET  /api/company/profile — the company profile: facts, evidence, and what each source counted for
// POST /api/company/profile — rebuild it from the workspace's sources (any member; after the response)
import type { NextRequest } from "next/server";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { loadCompanyProfile, startRebuild } from "~/server/company-profile/service";
import { handleRouteError, json } from "~/server/distribution/http";

export async function GET() {
    const auth = await requireWorkspaceContext();
    if (!auth.success) return auth.response;
    try {
        return json({ profile: await loadCompanyProfile(auth.data) });
    } catch (err) {
        return handleRouteError("GET company profile", err);
    }
}

export async function POST(request: NextRequest) {
    const auth = await requireWorkspaceContext();
    if (!auth.success) return auth.response;
    const ctx = auth.data;
    return withRateLimit(
        request,
        {
            maxRequests: 6,
            windowMs: 15 * 60 * 1000,
            keyGenerator: () => `company-profile:${ctx.authUserId}`,
        },
        async () => {
            try {
                return json({ profile: await startRebuild(ctx) }, 202);
            } catch (err) {
                return handleRouteError("POST company profile", err);
            }
        }
    );
}
