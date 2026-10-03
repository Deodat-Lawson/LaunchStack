// DELETE /api/vantage/metrics/observations/:id
import type { NextRequest } from "next/server";

import { deleteObservation } from "@launchstack/pipelines/vantage";

import { handleVantageError, json, vantageContext } from "../../../_http";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        await deleteObservation({ companyId: auth.ctx.companyId, id });
        return json({ ok: true });
    } catch (err) {
        return handleVantageError("DELETE observation", err);
    }
}
