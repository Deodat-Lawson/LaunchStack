// GET  /api/vantage/metrics — workspace-shared definitions and recent observations (read-only)
// POST /api/vantage/metrics — define a metric
import type { NextRequest } from "next/server";

import {
    createMetricDefinition,
    listMetricDefinitionRows,
    toDefinitionDto,
    listObservations,
} from "@launchstack/pipelines/vantage";

import {
    error,
    firstIssue,
    handleVantageError,
    json,
    readBody,
    vantageContext,
    say,
} from "../_http";
import { MetricDefinitionSchema } from "../_schemas";

export async function GET(request: Request) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    if (!auth.ctx.can("documents.read"))
        return error(say(request, "legacyMutationForbidden"), 403, { code: "forbidden" });
    try {
        const [definitions, observations] = await Promise.all([
            listMetricDefinitionRows(auth.ctx.companyId).then(rows => rows.map(toDefinitionDto)),
            listObservations({ companyId: auth.ctx.companyId }),
        ]);
        return json({ definitions, observations });
    } catch (err) {
        return handleVantageError("GET metrics", err, request);
    }
}

export async function POST(request: NextRequest) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    if (!auth.ctx.can("documents.edit"))
        return error(say(request, "legacyMutationForbidden"), 403, { code: "forbidden" });
    try {
        const parsed = MetricDefinitionSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues, request), 400);
        const definition = await createMetricDefinition({
            companyId: auth.ctx.companyId,
            input: parsed.data,
        });
        return json({ definition }, 201);
    } catch (err) {
        return handleVantageError("POST metrics", err, request);
    }
}
