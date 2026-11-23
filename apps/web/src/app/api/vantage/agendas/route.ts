// GET  /api/vantage/agendas?week=YYYY-MM-DD — that week's agenda (null when none), plus the list
// POST /api/vantage/agendas — retired in favor of canonical weekly reviews
import type { NextRequest } from "next/server";

import {
    defaultAgendaWeek,
    getAgendaByWeek,
    isIsoDate,
    listAgendas,
    weekStartOf,
    parseIsoDate,
} from "@launchstack/pipelines/vantage";

import { listVisibleLegacyAgendas, visibleLegacyAgenda } from "~/server/vantage/legacy-agenda-list";

import { error, handleVantageError, json, vantageContext, say } from "../_http";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    if (!auth.ctx.can("documents.read"))
        return error(say(request, "legacySourceAccessUnavailable"), 403, {
            code: "legacy_report_forbidden",
        });
    try {
        const weekParam = request.nextUrl.searchParams.get("week");
        const week =
            weekParam && isIsoDate(weekParam)
                ? weekStartOf(parseIsoDate(weekParam)!)
                : defaultAgendaWeek(new Date());
        const [agenda, agendas] = await Promise.all([
            getAgendaByWeek({ companyId: auth.ctx.companyId, weekStart: week }).then(agenda =>
                visibleLegacyAgenda(auth.ctx, agenda)
            ),
            listVisibleLegacyAgendas(auth.ctx, 26, (beforeWeek, limit) =>
                listAgendas({
                    companyId: auth.ctx.companyId,
                    creatorUserId: auth.ctx.userId,
                    beforeWeek,
                    limit,
                })
            ),
        ]);
        return json({ week, agenda, agendas });
    } catch (err) {
        return handleVantageError("GET agendas", err, request);
    }
}

export async function POST(request: NextRequest) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    if (!auth.ctx.can("documents.edit"))
        return error(say(request, "legacyMutationForbidden"), 403, { code: "forbidden" });
    return error(say(request, "canonicalWeeklyReviewRequired"), 410, {
        code: "canonical_weekly_review_required",
    });
}
