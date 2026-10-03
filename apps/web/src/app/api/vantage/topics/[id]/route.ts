// PATCH  /api/vantage/topics/:id — edit, reorder, dismiss, share
// DELETE /api/vantage/topics/:id
import type { NextRequest } from "next/server";

import { deleteTopic, updateTopic } from "@launchstack/pipelines/vantage";

import { error, firstIssue, handleVantageError, json, readBody, vantageContext } from "../../_http";
import { TopicPatchSchema } from "../../_schemas";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const parsed = TopicPatchSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues), 400);
        const patch = { ...parsed.data };
        if (patch.proposedDue === "") patch.proposedDue = null;
        const topic = await updateTopic({ companyId: auth.ctx.companyId, id, patch });
        return json({ topic });
    } catch (err) {
        return handleVantageError("PATCH topic", err);
    }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        await deleteTopic({ companyId: auth.ctx.companyId, id });
        return json({ ok: true });
    } catch (err) {
        return handleVantageError("DELETE topic", err);
    }
}
