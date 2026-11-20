// GET  /api/scenarios — the viewer's runs plus runs shared with the workspace
// POST /api/scenarios — start a run: { title?, subject, sources, agents, rounds }
//      With { contractVersion: 2 } and an Idempotency-Key header: a durable,
//      evidence-grounded run. 201 when accepted, 200 with the original run
//      when the same key and payload come again, 409 for the same key with
//      another payload.
import type { NextRequest } from "next/server";

import { localeOfRequest } from "~/i18n/server";

import { createScenario, listScenarios, namesFor } from "~/server/scenarios/service";
import { createScenarioV2 } from "~/server/scenarios/v2/service";

import { handleScenarioError, json, readBody, scenarioContext } from "./_http";

export async function GET(request: Request) {
    const auth = await scenarioContext();
    if (!auth.ok) return auth.response;
    try {
        return json({ runs: await listScenarios(auth.ctx, localeOfRequest(request)) });
    } catch (err) {
        return handleScenarioError("GET", err, request);
    }
}

export async function POST(request: NextRequest) {
    const auth = await scenarioContext();
    if (!auth.ok) return auth.response;
    try {
        const body = await readBody(request);
        const locale = localeOfRequest(request);
        if (body.contractVersion === 2) {
            const ctx = auth.ctx;
            const result = await createScenarioV2(
                ctx,
                body,
                request.headers.get("idempotency-key"),
                locale,
                ids => namesFor(ctx.companyId, ids, locale)
            );
            return json(
                {
                    run: result.run,
                    runId: result.run.id,
                    requestSpecId: result.requestSpecId,
                    worldSpecId: null,
                },
                result.created ? 201 : 200
            );
        }
        const run = await createScenario(auth.ctx, body, locale);
        return json({ run }, 201);
    } catch (err) {
        return handleScenarioError("POST", err, request);
    }
}
