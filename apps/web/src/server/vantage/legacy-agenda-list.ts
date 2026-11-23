import { getAgenda, VantageError, type AgendaDto } from "@launchstack/pipelines/vantage";

import type { VantageCtx } from "~/app/api/vantage/_http";

import { authorizeLegacyAgendaRead } from "./legacy-read-authority";

export async function visibleLegacyAgenda(
    ctx: VantageCtx,
    agenda: AgendaDto | null
): Promise<AgendaDto | null> {
    if (!agenda) return null;
    try {
        await authorizeLegacyAgendaRead(ctx, agenda);
        return agenda;
    } catch (error) {
        if (!(error instanceof VantageError) || error.status !== 403) throw error;
        return null;
    }
}

/** Week starts are unique per workspace. Continue past source-denied rows. */
export async function listVisibleLegacyAgendas<Row extends { id: string; weekStart: string }>(
    ctx: VantageCtx,
    limit: number,
    loadPage: (beforeWeek: string | undefined, limit: number) => Promise<Row[]>
): Promise<Row[]> {
    const visible: Row[] = [];
    let beforeWeek: string | undefined;
    while (visible.length < limit) {
        const rows = await loadPage(beforeWeek, limit);
        for (const row of rows) {
            const agenda = await getAgenda({ companyId: ctx.companyId, id: row.id });
            if (await visibleLegacyAgenda(ctx, agenda)) visible.push(row);
            if (visible.length === limit) return visible;
        }
        if (rows.length < limit) break;
        beforeWeek = rows.at(-1)!.weekStart;
    }
    return visible;
}
