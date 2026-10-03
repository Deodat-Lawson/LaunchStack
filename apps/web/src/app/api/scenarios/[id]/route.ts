// GET    /api/scenarios/[id] — the full run (poll while it's going)
// PATCH  /api/scenarios/[id] — { title?, shared? }, creator only
// DELETE /api/scenarios/[id] — creator only
import type { NextRequest } from "next/server";

import { deleteScenario, getScenarioDetail, updateScenario } from "~/server/scenarios/service";

import { error, handleScenarioError, json, readBody, runIdFrom, scenarioContext } from "../_http";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
    const auth = await scenarioContext();
    if (!auth.ok) return auth.response;
    try {
        const id = await runIdFrom(params);
        if (id === null) return error("Scenario not found", 404);
        return json({ run: await getScenarioDetail(auth.ctx, id) });
    } catch (err) {
        return handleScenarioError("GET run", err);
    }
}

export async function PATCH(request: NextRequest, { params }: Params) {
    const auth = await scenarioContext();
    if (!auth.ok) return auth.response;
    try {
        const id = await runIdFrom(params);
        if (id === null) return error("Scenario not found", 404);
        const body = await readBody(request);
        return json({
            run: await updateScenario(auth.ctx, id, { title: body.title, shared: body.shared }),
        });
    } catch (err) {
        return handleScenarioError("PATCH run", err);
    }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
    const auth = await scenarioContext();
    if (!auth.ok) return auth.response;
    try {
        const id = await runIdFrom(params);
        if (id === null) return error("Scenario not found", 404);
        await deleteScenario(auth.ctx, id);
        return json({ ok: true });
    } catch (err) {
        return handleScenarioError("DELETE run", err);
    }
}
