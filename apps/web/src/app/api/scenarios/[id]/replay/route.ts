// POST /api/scenarios/[id]/replay { mode: "recorded" } — rebuild a finished v2
// run from its frozen world and recorded turns, with zero model calls, and
// check every round's state hash.
import type { NextRequest } from "next/server";

import { ScenarioError, scenarioErrorCopy } from "~/server/scenarios/service";
import { replayScenario } from "~/server/scenarios/v2/service";

import {
    handleScenarioError,
    json,
    readBody,
    runIdFrom,
    scenarioContext,
    scenarioNotFound,
} from "../../_http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await scenarioContext();
    if (!auth.ok) return auth.response;
    try {
        const id = await runIdFrom(params);
        if (id === null) return scenarioNotFound(request);
        const body = await readBody(request);
        if (body.mode !== undefined && body.mode !== "recorded") {
            throw new ScenarioError(scenarioErrorCopy("replayModeUnsupported"), 400, "invalid");
        }
        return json(await replayScenario(auth.ctx, id));
    } catch (err) {
        return handleScenarioError("POST replay", err, request);
    }
}
