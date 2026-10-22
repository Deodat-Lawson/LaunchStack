// GET    /api/vantage/metrics/observations/:id — direct observation read
// DELETE /api/vantage/metrics/observations/:id
import type { NextRequest } from "next/server";

import { deleteObservation, getObservation } from "@launchstack/pipelines/vantage";

import { error, handleVantageError, json, vantageContext } from "../../../_http";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const observation = await getObservation({ companyId: auth.ctx.companyId, id });
        if (!observation) return error("That number is not here.", 404, { code: "not_found" });
        return json({ observation });
    } catch (err) {
        return handleVantageError("GET observation", err);
    }
}

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
