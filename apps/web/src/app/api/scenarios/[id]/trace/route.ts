// GET /api/scenarios/[id]/trace?afterSeq=<n>&limit=<n> — a v2 run's units in
// order: stage, committed boundary, heartbeat age, attempts and classified
// errors (never provider text).
import type { NextRequest } from "next/server";

import { getScenarioTrace } from "~/server/scenarios/v2/service";

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
        const afterSeq = Number.parseInt(url.searchParams.get("afterSeq") ?? "", 10);
        const limit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
        return json(
            await getScenarioTrace(auth.ctx, id, {
                afterSeq: Number.isFinite(afterSeq) ? afterSeq : null,
                limit: Number.isFinite(limit) ? limit : null,
            })
        );
    } catch (err) {
        return handleScenarioError("GET trace", err, request);
    }
}
