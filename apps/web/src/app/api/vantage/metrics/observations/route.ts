// POST /api/vantage/metrics/observations — one number for one period
import type { NextRequest } from "next/server";

import { createObservations, listObservations } from "@launchstack/pipelines/vantage";

import { error, firstIssue, handleVantageError, json, readBody, vantageContext } from "../../_http";
import { ObservationSchema } from "../../_schemas";

export async function POST(request: NextRequest) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const parsed = ObservationSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues), 400);
        await createObservations({
            companyId: auth.ctx.companyId,
            userId: auth.ctx.userId,
            inputs: [parsed.data],
        });
        const observations = await listObservations({ companyId: auth.ctx.companyId });
        return json({ observations }, 201);
    } catch (err) {
        return handleVantageError("POST observation", err);
    }
}
