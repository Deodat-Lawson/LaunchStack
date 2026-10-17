// GET  /api/scenarios — the viewer's runs plus runs shared with the workspace
// POST /api/scenarios — start a run: { title?, subject, sources, agents, rounds }
import type { NextRequest } from "next/server";

import { createScenario, listScenarios } from "~/server/scenarios/service";

import { handleScenarioError, json, readBody, scenarioContext } from "./_http";

export async function GET() {
    const auth = await scenarioContext();
    if (!auth.ok) return auth.response;
    try {
        return json({ runs: await listScenarios(auth.ctx) });
    } catch (err) {
        return handleScenarioError("GET", err);
    }
}

export async function POST(request: NextRequest) {
    const auth = await scenarioContext();
    if (!auth.ok) return auth.response;
    try {
        const run = await createScenario(auth.ctx, await readBody(request));
        return json({ run }, 201);
    } catch (err) {
        return handleScenarioError("POST", err);
    }
}
