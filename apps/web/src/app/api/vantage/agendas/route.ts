import { authorizeLegacyAgendaRead } from "~/server/vantage/legacy-read-authority";
// GET  /api/vantage/agendas?week=YYYY-MM-DD — that week's agenda (null when none), plus the list
// POST /api/vantage/agendas — prepare: { weekStart? } → draft for that week (default by the Thursday rule)
import type { NextRequest } from "next/server";

import {
    defaultAgendaWeek,
    getAgendaByWeek,
    getAgenda,
    VantageError,
    isIsoDate,
    listAgendas,
    weekStartOf,
    parseIsoDate,
} from "@launchstack/pipelines/vantage";

import { error, handleVantageError, json, vantageContext, say } from "../_http";

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
        await authorizeLegacyAgendaRead(auth.ctx, agenda);
        const visible = [];
        for (const row of agendas) {
            const body = await getAgenda({ companyId: auth.ctx.companyId, id: row.id });
            if (!body) continue;
            try {
                await authorizeLegacyAgendaRead(auth.ctx, body);
                visible.push(row);
            } catch (error) {
                if (!(error instanceof VantageError) || error.status !== 403) throw error;
            }
        }
        return json({ week, agenda, agendas: visible });
    } catch (err) {
        return handleVantageError("GET agendas", err, request);
    }
}

export async function POST(request: NextRequest) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    return error(say(request, "canonicalWeeklyReviewRequired"), 410, {
        code: "canonical_weekly_review_required",
    });
}
