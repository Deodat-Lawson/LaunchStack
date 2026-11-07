// GET  /api/scenarios/[id]/interviews — the viewer's own questions and answers
// POST /api/scenarios/[id]/interviews — { agentId | "analyst", question }
import type { NextRequest } from "next/server";

import { askScenario, listScenarioInterviews } from "~/server/scenarios/service";

import {
    handleScenarioError,
    json,
    readBody,
    runIdFrom,
    scenarioContext,
    scenarioNotFound,
} from "../../_http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
    const auth = await scenarioContext();
    if (!auth.ok) return auth.response;
    try {
        const id = await runIdFrom(params);
        if (id === null) return scenarioNotFound(request);
        return json({ interviews: await listScenarioInterviews(auth.ctx, id) });
    } catch (err) {
        return handleScenarioError("GET interviews", err, request);
    }
}

export async function POST(request: NextRequest, { params }: Params) {
    const auth = await scenarioContext();
    if (!auth.ok) return auth.response;
    try {
        const id = await runIdFrom(params);
        if (id === null) return scenarioNotFound(request);
        const body = await readBody(request);
        return json(
            { interview: await askScenario(auth.ctx, id, body.agentId, body.question) },
            201
        );
    } catch (err) {
        return handleScenarioError("POST interview", err, request);
    }
}
