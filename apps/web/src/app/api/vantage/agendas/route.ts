// GET  /api/vantage/agendas?week=YYYY-MM-DD — that week's agenda (null when none), plus the list
// POST /api/vantage/agendas — prepare: { weekStart? } → draft for that week (default by the Thursday rule)
import type { NextRequest } from "next/server";

import {
    defaultAgendaWeek,
    getAgendaByWeek,
    isIsoDate,
    listAgendas,
    weekStartOf,
    parseIsoDate,
} from "@launchstack/pipelines/vantage";

import { error, firstIssue, handleVantageError, json, readBody, vantageContext } from "../_http";
import { PrepareSchema } from "../_schemas";
import { prepareWeek } from "~/server/vantage/service";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const weekParam = request.nextUrl.searchParams.get("week");
        const week =
            weekParam && isIsoDate(weekParam)
                ? weekStartOf(parseIsoDate(weekParam)!)
                : defaultAgendaWeek(new Date());
        const [agenda, agendas] = await Promise.all([
            getAgendaByWeek({ companyId: auth.ctx.companyId, weekStart: week }),
            listAgendas({ companyId: auth.ctx.companyId }),
        ]);
        return json({ week, agenda, agendas });
    } catch (err) {
        return handleVantageError("GET agendas", err);
    }
}

export async function POST(request: NextRequest) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const parsed = PrepareSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues), 400);
        const weekStart = parsed.data.weekStart
            ? weekStartOf(parseIsoDate(parsed.data.weekStart)!)
            : defaultAgendaWeek(new Date());
        const agenda = await prepareWeek({
            companyId: auth.ctx.companyId,
            userId: auth.ctx.userId,
            weekStart,
        });
        return json({ agenda }, 201);
    } catch (err) {
        return handleVantageError("POST prepare", err);
    }
}
