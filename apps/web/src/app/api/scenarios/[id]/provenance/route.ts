// GET /api/scenarios/[id]/provenance?after=<slotId>&limit=<n> — a v2 run's
// captured evidence, ontology, graph summary and per-person contexts. Readers
// need access to every file the run read; otherwise 404.
import type { NextRequest } from "next/server";

import { localeOfRequest } from "~/i18n/server";

import { getScenarioProvenance } from "~/server/scenarios/v2/service";

import {
    handleScenarioError,
    json,
    runIdFrom,
    scenarioContext,
    scenarioNotFound,
} from "../../_http";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await scenarioContext();
    if (!auth.ok) return auth.response;
    try {
        const id = await runIdFrom(params);
        if (id === null) return scenarioNotFound(request);
        const url = new URL(request.url);
        const limit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
        return json(
            await getScenarioProvenance(
                auth.ctx,
                id,
                {
                    after: url.searchParams.get("after"),
                    limit: Number.isFinite(limit) ? limit : null,
                },
                localeOfRequest(request)
            )
        );
    } catch (err) {
        return handleScenarioError("GET provenance", err, request);
    }
}
