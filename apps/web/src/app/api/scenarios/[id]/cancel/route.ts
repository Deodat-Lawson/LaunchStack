// POST /api/scenarios/[id]/cancel — stop a run at its next unit, creator only
import type { NextRequest } from "next/server";

import { cancelScenario } from "~/server/scenarios/service";

import { error, handleScenarioError, json, runIdFrom, scenarioContext } from "../../_http";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await scenarioContext();
    if (!auth.ok) return auth.response;
    try {
        const id = await runIdFrom(params);
        if (id === null) return error("Scenario not found", 404);
        return json({ run: await cancelScenario(auth.ctx, id) });
    } catch (err) {
        return handleScenarioError("POST cancel", err);
    }
}
