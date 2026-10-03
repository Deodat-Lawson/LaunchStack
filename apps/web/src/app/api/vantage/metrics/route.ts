// GET  /api/vantage/metrics — definitions (defaults created on first read) and recent observations
// POST /api/vantage/metrics — define a metric
import type { NextRequest } from "next/server";

import {
    createMetricDefinition,
    ensureMetricDefinitions,
    listObservations,
} from "@launchstack/pipelines/vantage";

import { error, firstIssue, handleVantageError, json, readBody, vantageContext } from "../_http";
import { MetricDefinitionSchema } from "../_schemas";

export async function GET() {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const [definitions, observations] = await Promise.all([
            ensureMetricDefinitions({ companyId: auth.ctx.companyId }),
            listObservations({ companyId: auth.ctx.companyId }),
        ]);
        return json({ definitions, observations });
    } catch (err) {
        return handleVantageError("GET metrics", err);
    }
}

export async function POST(request: NextRequest) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const parsed = MetricDefinitionSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues), 400);
        const definition = await createMetricDefinition({
            companyId: auth.ctx.companyId,
            input: parsed.data,
        });
        return json({ definition }, 201);
    } catch (err) {
        return handleVantageError("POST metrics", err);
    }
}
