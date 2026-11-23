// POST /api/vantage/metrics/observations — one number for one period
import type { NextRequest } from "next/server";

import { createObservation } from "@launchstack/pipelines/vantage";

import {
    error,
    firstIssue,
    handleVantageError,
    json,
    readBody,
    vantageContext,
    say,
} from "../../_http";
import { ObservationSchema } from "../../_schemas";

export async function POST(request: NextRequest) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    if (!auth.ctx.can("documents.edit"))
        return error(say(request, "legacyMutationForbidden"), 403, { code: "forbidden" });
    try {
        const parsed = ObservationSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues, request), 400);
        const observation = await createObservation({
            companyId: auth.ctx.companyId,
            userId: auth.ctx.userId,
            input: parsed.data,
        });
        return json({ observations: [observation] }, 201);
    } catch (err) {
        return handleVantageError("POST observation", err, request);
    }
}
