import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@launchstack/store/client";
import {
    VantageError,
    vantageAgendas,
    vantageEvidence,
    vantageMetricObservations,
    vantageCommitments,
    type AgendaDto,
    type WeeklySignals,
    type EvidenceDto,
} from "@launchstack/pipelines/vantage";
import type { VantageCtx } from "~/app/api/vantage/_http";
import type { OverviewDto } from "./service";

const denied = (): never => {
    throw new VantageError("Report source access is unavailable", 403, "legacy_report_forbidden");
};
export interface LegacyReadStore {
    agendaOwner(companyId: bigint, id: string): Promise<string | null>;
    records(
        companyId: bigint,
        kind: "ev" | "obs" | "cm",
        ids: string[]
    ): Promise<{ id: string; createdByUserId: string; kind?: string; visibility?: string }[]>;
}
const productionStore: LegacyReadStore = {
    async agendaOwner(companyId, id) {
        const [row] = await getDb()
            .select({ owner: vantageAgendas.createdByUserId })
            .from(vantageAgendas)
            .where(and(eq(vantageAgendas.companyId, companyId), eq(vantageAgendas.id, id)));
        return row?.owner ?? null;
    },
    async records(companyId, kind, ids) {
        if (!ids.length) return [];
        if (kind === "ev")
            return getDb()
                .select()
                .from(vantageEvidence)
                .where(
                    and(eq(vantageEvidence.companyId, companyId), inArray(vantageEvidence.id, ids))
                );
        if (kind === "obs")
            return getDb()
                .select()
                .from(vantageMetricObservations)
                .where(
                    and(
                        eq(vantageMetricObservations.companyId, companyId),
                        inArray(vantageMetricObservations.id, ids)
                    )
                );
        return getDb()
            .select()
            .from(vantageCommitments)
            .where(
                and(
                    eq(vantageCommitments.companyId, companyId),
                    inArray(vantageCommitments.id, ids)
                )
            );
    },
};
function signalRefs(signals: WeeklySignals | null): string[] {
    if (!signals) return [];
    // Legacy V1 stored document-kind totals but no immutable document/version
    // dependency registry. Even its creator cannot prove current source access.
    if (signals.newEvidence.some(item => item.kind === "document" && item.count > 0)) denied();
    return [
        ...signals.recentEvidenceIds.map(id => "ev:" + id),
        ...signals.metricChanges
            .flatMap(item => [
                item.latest.observationId,
                ...(item.previous ? [item.previous.observationId] : []),
            ])
            .map(id => "obs:" + id),
        ...signals.metricConflicts
            .flatMap(item => [item.a.observationId, item.b.observationId])
            .map(id => "obs:" + id),
        ...[
            ...signals.overdueCommitmentIds,
            ...signals.dueThisWeekCommitmentIds,
            ...signals.resolvedCommitmentIds,
        ].map(id => "cm:" + id),
    ];
}
async function authorizeRefs(ctx: VantageCtx, refs: string[], store: LegacyReadStore) {
    const grouped = { ev: new Set<string>(), obs: new Set<string>(), cm: new Set<string>() };
    for (const ref of refs) {
        const match = /^(ev|obs|cm):([^:]+)$/.exec(ref);
        if (!match) return denied();
        grouped[match[1] as keyof typeof grouped].add(match[2]!);
    }
    for (const kind of ["ev", "obs", "cm"] as const) {
        const ids = [...grouped[kind]];
        if (!ids.length) continue;
        const rows = await store.records(ctx.companyId, kind, ids);
        if (
            rows.length !== ids.length ||
            rows.some(row => row.createdByUserId !== ctx.userId || row.kind === "document")
        )
            denied();
    }
}
/** Original V1 bodies remain private to their creator. No V2.1 reinterpretation
 * or guessed immutable document lineage: unresolved document-derived V1 is withheld.
 */
export async function authorizeLegacyAgendaRead(
    ctx: VantageCtx,
    agenda: AgendaDto | null,
    store: LegacyReadStore = productionStore
): Promise<void> {
    if (!ctx.can("documents.read")) denied();
    if (!agenda) return;
    if ((await store.agendaOwner(ctx.companyId, agenda.id)) !== ctx.userId) denied();
    await authorizeRefs(
        ctx,
        [
            ...signalRefs(agenda.signals),
            ...agenda.topics.flatMap(topic =>
                [...topic.facts, ...topic.conflicts].flatMap(fact => fact.refs.map(ref => ref.ref))
            ),
        ],
        store
    );
}
export async function authorizeLegacyOverviewRead(
    ctx: VantageCtx,
    overview: OverviewDto,
    store: LegacyReadStore = productionStore
): Promise<void> {
    await authorizeLegacyAgendaRead(ctx, overview.agenda, store);
    await authorizeLegacyAgendaRead(ctx, overview.previousAgenda, store);
    await authorizeRefs(
        ctx,
        [
            ...signalRefs(overview.signals),
            ...overview.recentEvidence.map(item => "ev:" + item.id),
            ...overview.checkIns.map(item => "cm:" + item.id),
        ],
        store
    );
}

/** The legacy Markdown export also joins current action rows. */
export async function authorizeLegacyCommitmentRead(
    ctx: VantageCtx,
    ids: string[],
    store: LegacyReadStore = productionStore
): Promise<void> {
    if (!ctx.can("documents.read")) denied();
    await authorizeRefs(
        ctx,
        ids.map(id => "cm:" + id),
        store
    );
}

/** Manual evidence is private unless its creator explicitly shared it. Legacy
 * document captures have no immutable source registry and remain unavailable. */
export async function filterLegacyEvidenceRead(
    ctx: VantageCtx,
    items: EvidenceDto[],
    store: LegacyReadStore = productionStore
): Promise<EvidenceDto[]> {
    if (!ctx.can("documents.read")) denied();
    const rows = await store.records(
        ctx.companyId,
        "ev",
        items.map(item => item.id)
    );
    const allowed = new Set(
        rows
            .filter(
                row =>
                    row.kind !== "document" &&
                    (row.createdByUserId === ctx.userId || row.visibility === "shared")
            )
            .map(row => row.id)
    );
    return items.filter(item => allowed.has(item.id));
}

export async function authorizeLegacyEvidenceMutation(
    ctx: VantageCtx,
    id: string,
    store: LegacyReadStore = productionStore
): Promise<void> {
    if (!ctx.can("documents.edit")) denied();
    const rows = await store.records(ctx.companyId, "ev", [id]);
    if (
        rows.length !== 1 ||
        rows[0]!.createdByUserId !== ctx.userId ||
        rows[0]!.kind === "document"
    )
        denied();
}
