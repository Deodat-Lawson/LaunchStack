// GET    /api/scenarios/[id] — the full run (poll while it's going)
// PATCH  /api/scenarios/[id] — { title?, shared? }, creator only
// DELETE /api/scenarios/[id] — creator only
import type { NextRequest } from "next/server";

import { localeOfRequest } from "~/i18n/server";

import { deleteScenario, getScenarioDetail, updateScenario } from "~/server/scenarios/service";

import {
    handleScenarioError,
    json,
    readBody,
    runIdFrom,
    scenarioContext,
    scenarioNotFound,
} from "../_http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
    const auth = await scenarioContext();
    if (!auth.ok) return auth.response;
    try {
        const id = await runIdFrom(params);
        if (id === null) return scenarioNotFound(request);
        return json({ run: await getScenarioDetail(auth.ctx, id, localeOfRequest(request)) });
    } catch (err) {
        return handleScenarioError("GET run", err, request);
    }
}

export async function PATCH(request: NextRequest, { params }: Params) {
    const auth = await scenarioContext();
    if (!auth.ok) return auth.response;
    try {
        const id = await runIdFrom(params);
        if (id === null) return scenarioNotFound(request);
        const body = await readBody(request);
        return json({
            run: await updateScenario(
                auth.ctx,
                id,
                { title: body.title, shared: body.shared },
                localeOfRequest(request)
            ),
        });
    } catch (err) {
        return handleScenarioError("PATCH run", err, request);
    }
}

export async function DELETE(request: NextRequest, { params }: Params) {
    const auth = await scenarioContext();
    if (!auth.ok) return auth.response;
    try {
        const id = await runIdFrom(params);
        if (id === null) return scenarioNotFound(request);
        await deleteScenario(auth.ctx, id);
        return json({ ok: true });
    } catch (err) {
        return handleScenarioError("DELETE run", err, request);
    }
}
