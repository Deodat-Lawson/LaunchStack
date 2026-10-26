// POST /api/scenarios/[id]/cancel — stop a run at its next unit, creator only
import type { NextRequest } from "next/server";

import { localeOfRequest } from "~/i18n/server";

import { cancelScenario } from "~/server/scenarios/service";

import {
    handleScenarioError,
    json,
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
        return json({ run: await cancelScenario(auth.ctx, id, localeOfRequest(request)) });
    } catch (err) {
        return handleScenarioError("POST cancel", err, request);
    }
}
