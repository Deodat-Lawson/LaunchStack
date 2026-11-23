// DELETE /api/vantage/metrics/observations/:id
import type { NextRequest } from "next/server";

import { deleteObservation } from "@launchstack/pipelines/vantage";

import { handleVantageError, json, vantageContext, say, error } from "../../../_http";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    if (!auth.ctx.can("documents.edit"))
        return error(say(request, "legacyMutationForbidden"), 403, { code: "forbidden" });
    try {
        const { id } = await params;
        await deleteObservation({ companyId: auth.ctx.companyId, id });
        return json({ ok: true });
    } catch (err) {
        return handleVantageError("DELETE observation", err, request);
    }
}
