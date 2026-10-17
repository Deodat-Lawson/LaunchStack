// GET  /api/vantage/agendas?week=YYYY-MM-DD — that week's agenda (null when none), plus the list
// POST /api/vantage/agendas — prepare: { weekStart? } → draft for that week (default by the Thursday rule)
import type { NextRequest } from "next/server";

import {
    listAgendas,
    validDate,
    reportingWeekOf,
    getAgendaV1,
    reportPeriod,
} from "@launchstack/pipelines/vantage";

import { error, firstIssue, handleVantageError, json, readBody, vantageContext } from "../_http";
import { PrepareSchema } from "../_schemas";
import { prepareWeekV1 } from "~/server/vantage/service-v1";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const weekParam = request.nextUrl.searchParams.get("week");
        if (weekParam && !validDate(weekParam))
            return error("Use a real YYYY-MM-DD date.", 400, { code: "validation_error" });
        const week = weekParam ? reportingWeekOf(weekParam) : reportPeriod(new Date()).weekStart;
        const [agenda, agendas] = await Promise.all([
            getAgendaV1(auth.ctx.companyId, { weekStart: week }),
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
        const agenda = await prepareWeekV1(
            {
                companyId: auth.ctx.companyId,
                userId: auth.ctx.userId,
                weekStart: parsed.data.weekStart,
                generationMode: parsed.data.generationMode,
            },
            {
                revalidate: async () => {
                    const again = await vantageContext();
                    if (
                        !again.ok ||
                        again.ctx.companyId !== auth.ctx.companyId ||
                        again.ctx.userId !== auth.ctx.userId
                    ) {
                        const { VantageError } = await import("@launchstack/pipelines/vantage");
                        throw new VantageError(
                            "Access changed during generation.",
                            403,
                            "pilot_access_denied"
                        );
                    }
                },
            }
        );
        return json({ agenda }, 201);
    } catch (err) {
        return handleVantageError("POST prepare", err);
    }
}
