import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@launchstack/store/client";
import {
    getAgenda,
    VantageError,
    vantageAgendas,
    vantageAgendaTopics,
    vantageEvidence,
    vantageMetricObservations,
    vantageCommitments,
    type AgendaDto,
    type WeeklySignals,
    type CommitmentDto,
} from "@launchstack/pipelines/vantage";
import type { VantageCtx } from "~/app/api/vantage/_http";
import type { OverviewDto } from "./service";

const denied = (): never => {
    throw new VantageError("Report source access is unavailable", 403, "legacy_report_forbidden");
};
export interface LegacyReadStore {
    agendaOwner(companyId: bigint, id: string): Promise<string | null>;
    agenda(companyId: bigint, id: string): Promise<AgendaDto | null>;
    topicAgendaId(companyId: bigint, id: string): Promise<string | null>;
    records(
        companyId: bigint,
        kind: "ev" | "obs" | "cm",
        ids: string[]
    ): Promise<LegacyReadRecord[]>;
}
type CommitmentLink = { agendaId?: string | null; topicId?: string | null };
type LegacyReadRecord = CommitmentLink & {
    id: string;
    createdByUserId: string;
    kind?: string;
    visibility?: string;
    shared?: boolean;
};

const productionStore: LegacyReadStore = {
    async agendaOwner(companyId, id) {
        const [row] = await getDb()
            .select({ owner: vantageAgendas.createdByUserId })
            .from(vantageAgendas)
            .where(and(eq(vantageAgendas.companyId, companyId), eq(vantageAgendas.id, id)));
        return row?.owner ?? null;
    },
    agenda: (companyId, id) => getAgenda({ companyId, id }),
    async topicAgendaId(companyId, id) {
        const [row] = await getDb()
            .select({ agendaId: vantageAgendaTopics.agendaId })
            .from(vantageAgendaTopics)
            .where(
                and(eq(vantageAgendaTopics.companyId, companyId), eq(vantageAgendaTopics.id, id))
            );
        return row?.agendaId ?? null;
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
        [...signalRefs(overview.signals), ...overview.recentEvidence.map(item => "ev:" + item.id)],
        store
    );
    await authorizeLegacyCommitmentRead(ctx, overview.checkIns, store);
}

/** A linked action can only surface its agenda-derived data to an authorized agenda reader. */
export async function authorizeLegacyCommitmentSource(
    ctx: VantageCtx,
    link: CommitmentLink,
    store: LegacyReadStore = productionStore
): Promise<void> {
    if (!link.agendaId && !link.topicId) return;
    if (!ctx.can("documents.read")) denied();
    const topicAgendaId = link.topicId
        ? await store.topicAgendaId(ctx.companyId, link.topicId)
        : null;
    if (link.topicId && (!topicAgendaId || (link.agendaId && link.agendaId !== topicAgendaId)))
        denied();
    const agenda = await store.agenda(ctx.companyId, (link.agendaId ?? topicAgendaId)!);
    if (!agenda) denied();
    await authorizeLegacyAgendaRead(ctx, agenda, store);
}

function sameCommitmentLink(record: LegacyReadRecord, commitment: CommitmentDto): boolean {
    return (
        (record.agendaId ?? null) === commitment.agendaId &&
        (record.topicId ?? null) === commitment.topicId
    );
}

/** Overview and Markdown export require creator-owned actions and their sources. */
export async function authorizeLegacyCommitmentRead(
    ctx: VantageCtx,
    commitments: CommitmentDto[],
    store: LegacyReadStore = productionStore
): Promise<void> {
    if (!ctx.can("documents.read")) denied();
    if (!commitments.length) return;
    const rows = await store.records(
        ctx.companyId,
        "cm",
        commitments.map(item => item.id)
    );
    const byId = new Map(rows.map(row => [row.id, row]));
    for (const commitment of commitments) {
        const row = byId.get(commitment.id);
        if (!row || row.createdByUserId !== ctx.userId || !sameCommitmentLink(row, commitment))
            return denied();
        await authorizeLegacyCommitmentSource(ctx, row, store);
    }
}

/** Standalone manual commitments may be shared with program administrators.
 * Linked historical agendas retain their original source authority.
 */
export async function filterLegacyCommitmentsRead(
    ctx: VantageCtx,
    commitments: CommitmentDto[],
    store: LegacyReadStore = productionStore
): Promise<CommitmentDto[]> {
    if (!ctx.can("documents.read")) denied();
    if (!commitments.length) return [];
    const rows = await store.records(
        ctx.companyId,
        "cm",
        commitments.map(item => item.id)
    );
    const byId = new Map(rows.map(row => [row.id, row]));
    const canEdit = ctx.can("documents.edit");
    const canSeeProgramShares = ctx.can("settings.manage");
    const visible: CommitmentDto[] = [];
    for (const item of commitments) {
        const row = byId.get(item.id);
        if (!row || !sameCommitmentLink(row, item)) continue;
        const creator = row.createdByUserId === ctx.userId;
        if (!creator && (!canSeeProgramShares || !row.shared || row.agendaId || row.topicId))
            continue;
        try {
            await authorizeLegacyCommitmentSource(ctx, row, store);
            visible.push({ ...item, canEdit: creator && canEdit });
        } catch (error) {
            if (!(error instanceof VantageError) || error.status !== 403) throw error;
        }
    }
    return visible;
}

export async function authorizeLegacyCommitmentMutation(
    ctx: VantageCtx,
    id: string,
    store: LegacyReadStore = productionStore
): Promise<void> {
    if (!ctx.can("documents.edit")) denied();
    const [row] = await store.records(ctx.companyId, "cm", [id]);
    if (!row || row.createdByUserId !== ctx.userId) return denied();
    await authorizeLegacyCommitmentSource(ctx, row, store);
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
