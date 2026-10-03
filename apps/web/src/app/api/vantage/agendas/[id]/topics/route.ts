// POST /api/vantage/agendas/:id/topics — the founder adds a topic of their own
import type { NextRequest } from "next/server";

import { addTopic } from "@launchstack/pipelines/vantage";

import {
    error,
    firstIssue,
    handleVantageError,
    json,
    readBody,
    vantageContext,
} from "../../../_http";
import { TopicSchema } from "../../../_schemas";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const parsed = TopicSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues), 400);
        const topic = await addTopic({
            companyId: auth.ctx.companyId,
            agendaId: id,
            input: {
                ...parsed.data,
                proposedDue:
                    parsed.data.proposedDue === "" ? null : (parsed.data.proposedDue ?? null),
            },
        });
        return json({ topic }, 201);
    } catch (err) {
        return handleVantageError("POST topic", err);
    }
}
