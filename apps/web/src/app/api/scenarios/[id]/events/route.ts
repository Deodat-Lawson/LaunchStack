// POST /api/scenarios/[id]/events — { text }: a narrator post for the next round, creator only
import type { NextRequest } from "next/server";

import { addScenarioEvent } from "~/server/scenarios/service";

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
        return json({ injection: await addScenarioEvent(auth.ctx, id, body.text) }, 201);
    } catch (err) {
        return handleScenarioError("POST event", err, request);
    }
}
