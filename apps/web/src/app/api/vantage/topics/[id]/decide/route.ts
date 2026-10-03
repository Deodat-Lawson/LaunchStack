// POST /api/vantage/topics/:id/decide — { decision, commitment | null }
// Records what the meeting decided and opens the commitment next week checks.
import type { NextRequest } from "next/server";

import { recordDecision } from "@launchstack/pipelines/vantage";

import {
    error,
    firstIssue,
    handleVantageError,
    json,
    readBody,
    vantageContext,
} from "../../../_http";
import { DecisionSchema } from "../../../_schemas";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const parsed = DecisionSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues), 400);
        const topic = await recordDecision({
            companyId: auth.ctx.companyId,
            userId: auth.ctx.userId,
            topicId: id,
            decision: parsed.data.decision,
            commitment: parsed.data.commitment,
        });
        return json({ topic });
    } catch (err) {
        return handleVantageError("POST decide", err);
    }
}
