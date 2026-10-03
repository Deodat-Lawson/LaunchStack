// POST /api/vantage/agendas/:id/reorder — { ids } in the wanted order
import type { NextRequest } from "next/server";

import { getAgenda, reorderTopics } from "@launchstack/pipelines/vantage";

import {
    error,
    firstIssue,
    handleVantageError,
    json,
    readBody,
    vantageContext,
} from "../../../_http";
import { ReorderSchema } from "../../../_schemas";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const parsed = ReorderSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues), 400);
        await reorderTopics({ companyId: auth.ctx.companyId, agendaId: id, ids: parsed.data.ids });
        const agenda = await getAgenda({ companyId: auth.ctx.companyId, id });
        if (!agenda) return error("That agenda is not here.", 404);
        return json({ agenda });
    } catch (err) {
        return handleVantageError("POST reorder", err);
    }
}
