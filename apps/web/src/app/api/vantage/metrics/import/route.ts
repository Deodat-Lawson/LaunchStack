// POST /api/vantage/metrics/import — { csv, source? }: rows land, problems are reported by line.
// A metric named in the CSV that is not defined yet is created with the CSV's
// name and an empty definition, named in the response so the founder fills it in.
import type { NextRequest } from "next/server";

import {
    createMetricDefinition,
    createObservations,
    ensureMetricDefinitions,
    parseMetricCsv,
    slugKey,
    type MetricDefinitionDto,
} from "@launchstack/pipelines/vantage";

import { error, firstIssue, handleVantageError, json, readBody, vantageContext } from "../../_http";
import { ImportSchema } from "../../_schemas";

export async function POST(request: NextRequest) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const parsed = ImportSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues), 400);
        const { rows, problems } = parseMetricCsv(parsed.data.csv);

        const definitions = await ensureMetricDefinitions({ companyId: auth.ctx.companyId });
        const byKey = new Map<string, MetricDefinitionDto>();
        for (const d of definitions) {
            byKey.set(d.key, d);
            byKey.set(slugKey(d.name), d);
        }
        const created: string[] = [];
        for (const row of rows) {
            const key = slugKey(row.metric);
            if (byKey.has(key)) continue;
            const def = await createMetricDefinition({
                companyId: auth.ctx.companyId,
                input: { key, name: row.metric, definition: "", unit: "count" },
            });
            byKey.set(key, def);
            byKey.set(slugKey(def.name), def);
            created.push(def.name);
        }
        const imported = await createObservations({
            companyId: auth.ctx.companyId,
            userId: auth.ctx.userId,
            inputs: rows.map(row => ({
                metricId: byKey.get(slugKey(row.metric))!.id,
                value: row.value,
                periodStart: row.periodStart,
                periodEnd: row.periodEnd,
                source: row.source ?? parsed.data.source ?? null,
                note: row.note,
            })),
        });
        return json({ imported, problems, createdMetrics: created });
    } catch (err) {
        return handleVantageError("POST import", err);
    }
}
