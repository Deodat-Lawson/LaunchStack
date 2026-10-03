// PATCH  /api/vantage/metrics/:id — rename or redefine
// DELETE /api/vantage/metrics/:id — removes its observations too
import type { NextRequest } from "next/server";

import { deleteMetricDefinition, updateMetricDefinition } from "@launchstack/pipelines/vantage";

import { error, firstIssue, handleVantageError, json, readBody, vantageContext } from "../../_http";
import { MetricDefinitionSchema } from "../../_schemas";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const parsed = MetricDefinitionSchema.omit({ key: true })
            .partial()
            .safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues), 400);
        const definition = await updateMetricDefinition({
            companyId: auth.ctx.companyId,
            id,
            patch: parsed.data,
        });
        return json({ definition });
    } catch (err) {
        return handleVantageError("PATCH metric", err);
    }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        await deleteMetricDefinition({ companyId: auth.ctx.companyId, id });
        return json({ ok: true });
    } catch (err) {
        return handleVantageError("DELETE metric", err);
    }
}
