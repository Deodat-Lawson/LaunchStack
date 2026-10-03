// GET    /api/vantage/agendas/:id
// PATCH  /api/vantage/agendas/:id — { status }
// DELETE /api/vantage/agendas/:id
import type { NextRequest } from "next/server";

import { deleteAgenda, getAgenda, updateAgendaStatus } from "@launchstack/pipelines/vantage";

import { error, firstIssue, handleVantageError, json, readBody, vantageContext } from "../../_http";
import { AgendaStatusSchema } from "../../_schemas";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const agenda = await getAgenda({ companyId: auth.ctx.companyId, id });
        if (!agenda) return error("That agenda is not here.", 404);
        return json({ agenda });
    } catch (err) {
        return handleVantageError("GET agenda", err);
    }
}

export async function PATCH(request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const parsed = AgendaStatusSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues), 400);
        const agenda = await updateAgendaStatus({
            companyId: auth.ctx.companyId,
            id,
            status: parsed.data.status,
        });
        return json({ agenda });
    } catch (err) {
        return handleVantageError("PATCH agenda", err);
    }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const removed = await deleteAgenda({ companyId: auth.ctx.companyId, id });
        if (!removed) return error("That agenda is not here.", 404);
        return json({ ok: true });
    } catch (err) {
        return handleVantageError("DELETE agenda", err);
    }
}
