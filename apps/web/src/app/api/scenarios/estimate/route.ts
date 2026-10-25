// POST /api/scenarios/estimate — { agents, rounds } → expected calls and credits
import type { NextRequest } from "next/server";

import { estimateScenario } from "~/server/scenarios/service";

import { handleScenarioError, json, readBody, scenarioContext } from "../_http";

export async function POST(request: NextRequest) {
    const auth = await scenarioContext();
    if (!auth.ok) return auth.response;
    try {
        const body = await readBody(request);
        return json(await estimateScenario(auth.ctx, body.agents, body.rounds));
    } catch (err) {
        return handleScenarioError("POST estimate", err, request);
    }
}
