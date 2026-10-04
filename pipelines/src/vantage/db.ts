/**
 * Vantage repository. Every read and write takes a `companyId` and puts it
 * in the predicate; a wrong-workspace id answers "not found", never a row.
 * Rows go out as DTOs (dates as ISO strings) so routes stay thin.
 */
import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { getDb } from "@launchstack/store/client";

import {
    VANTAGE_AGENDA_STATUSES,
    VANTAGE_COMMITMENT_STATUSES,
    VANTAGE_EVIDENCE_KINDS,
    VANTAGE_TOPIC_STATUSES,
    VANTAGE_VISIBILITIES,
    vantageAgendaTopics,
    vantageAgendas,
    vantageCommitments,
    vantageEvidence,
    vantageMetricDefinitions,
    vantageMetricObservations,
    vantageProgramDeadlines,
    type VantageAgendaRow,
    type VantageAgendaStatus,
    type VantageAgendaTopicRow,
    type VantageCommitmentRow,
    type VantageCommitmentStatus,
    type VantageConflict,
    type VantageEvidenceKind,
    type VantageEvidenceRow,
    type VantageFact,
    type VantageMetricDefinitionRow,
    type VantageMetricObservationRow,
    type VantageProgramDeadlineRow,
    type VantageTopicOrigin,
    type VantageVisibility,
} from "./schema";
import type {
    AgendaDto,
    AgendaSummaryDto,
    CommitmentDto,
    DeadlineDto,
    EvidenceDto,
    MetricDefinitionDto,
    MetricObservationDto,
    TopicDto,
    WeeklySignals,
} from "./types";
import { weekEndOf } from "./week";

export {
    VANTAGE_AGENDA_STATUSES,
    VANTAGE_COMMITMENT_STATUSES,
    VANTAGE_EVIDENCE_KINDS,
    VANTAGE_TOPIC_STATUSES,
    VANTAGE_VISIBILITIES,
};

/** Expected outcomes carry their own status; routes pass them through. */
export class VantageError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string
    ) {
        super(message);
        this.name = "VantageError";
    }
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Trimmed text, or null when there is nothing but whitespace. */
export function orNull(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    return trimmed;
}

/**
 * The four metrics the brief says to tell apart. Created the first time a
 * workspace opens Metrics, so the definitions exist to be argued with rather
 * than typed from scratch.
 */
export const DEFAULT_METRICS: { key: string; name: string; definition: string; unit: string }[] = [
    {
        key: "signups",
        name: "Signups",
        definition: "Accounts created in the period, before any activation step.",
        unit: "count",
    },
    {
        key: "activated",
        name: "Activated users",
        definition: "Signups that completed the core setup or first-value action in the period.",
        unit: "count",
    },
    {
        key: "active",
        name: "Active users",
        definition: "Distinct accounts that used the product at least once in the period.",
        unit: "count",
    },
    {
        key: "paying",
        name: "Paying customers",
        definition: "Distinct accounts with a paid plan active at the end of the period.",
        unit: "count",
    },
];

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export function toEvidenceDto(row: VantageEvidenceRow): EvidenceDto {
    return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        source: row.source ?? null,
        sourceUrl: row.sourceUrl ?? null,
        observedAt: row.observedAt,
        visibility: row.visibility,
        tags: row.tags ?? [],
        createdAt: row.createdAt.toISOString(),
    };
}

export async function listEvidence(args: {
    companyId: bigint;
    kind?: VantageEvidenceKind;
    since?: string;
    limit?: number;
}): Promise<EvidenceDto[]> {
    const conditions = [eq(vantageEvidence.companyId, args.companyId)];
    if (args.kind) conditions.push(eq(vantageEvidence.kind, args.kind));
    if (args.since) conditions.push(gte(vantageEvidence.observedAt, args.since));
    const rows = await getDb()
        .select()
        .from(vantageEvidence)
        .where(and(...conditions))
        .orderBy(desc(vantageEvidence.observedAt), desc(vantageEvidence.createdAt))
        .limit(args.limit ?? 200);
    return rows.map(toEvidenceDto);
}

export async function listEvidenceRows(args: {
    companyId: bigint;
    since?: string;
}): Promise<VantageEvidenceRow[]> {
    const conditions = [eq(vantageEvidence.companyId, args.companyId)];
    if (args.since) conditions.push(gte(vantageEvidence.observedAt, args.since));
    return getDb()
        .select()
        .from(vantageEvidence)
        .where(and(...conditions))
        .orderBy(desc(vantageEvidence.observedAt));
}

/** The evidence rows behind a set of ids, scoped to the workspace. */
export async function listEvidenceByIds(args: {
    companyId: bigint;
    ids: string[];
}): Promise<VantageEvidenceRow[]> {
    if (args.ids.length === 0) return [];
    return getDb()
        .select()
        .from(vantageEvidence)
        .where(
            and(
                eq(vantageEvidence.companyId, args.companyId),
                inArray(vantageEvidence.id, args.ids)
            )
        );
}

export interface EvidenceInput {
    kind: VantageEvidenceKind;
    title: string;
    body: string;
    source?: string | null;
    sourceUrl?: string | null;
    observedAt: string;
    visibility?: VantageVisibility;
    tags?: string[];
}

export async function createEvidence(args: {
    companyId: bigint;
    userId: string;
    input: EvidenceInput;
}): Promise<EvidenceDto> {
    const [row] = await getDb()
        .insert(vantageEvidence)
        .values({
            id: randomUUID(),
            companyId: args.companyId,
            createdByUserId: args.userId,
            kind: args.input.kind,
            title: args.input.title.trim(),
            body: args.input.body.trim(),
            source: orNull(args.input.source),
            sourceUrl: orNull(args.input.sourceUrl),
            observedAt: args.input.observedAt,
            visibility: args.input.visibility ?? "private",
            tags: args.input.tags ?? [],
        })
        .returning();
    return toEvidenceDto(row!);
}

export async function updateEvidence(args: {
    companyId: bigint;
    id: string;
    patch: Partial<EvidenceInput>;
}): Promise<EvidenceDto> {
    const set: Partial<typeof vantageEvidence.$inferInsert> = {};
    const p = args.patch;
    if (p.kind !== undefined) set.kind = p.kind;
    if (p.title !== undefined) set.title = p.title.trim();
    if (p.body !== undefined) set.body = p.body.trim();
    if (p.source !== undefined) set.source = orNull(p.source);
    if (p.sourceUrl !== undefined) set.sourceUrl = orNull(p.sourceUrl);
    if (p.observedAt !== undefined) set.observedAt = p.observedAt;
    if (p.visibility !== undefined) set.visibility = p.visibility;
    if (p.tags !== undefined) set.tags = p.tags;
    const [row] = await getDb()
        .update(vantageEvidence)
        .set(set)
        .where(and(eq(vantageEvidence.id, args.id), eq(vantageEvidence.companyId, args.companyId)))
        .returning();
    if (!row) throw new VantageError("That evidence is not here.", 404, "not_found");
    return toEvidenceDto(row);
}

export async function deleteEvidence(args: { companyId: bigint; id: string }): Promise<void> {
    const deleted = await getDb()
        .delete(vantageEvidence)
        .where(and(eq(vantageEvidence.id, args.id), eq(vantageEvidence.companyId, args.companyId)))
        .returning({ id: vantageEvidence.id });
    if (deleted.length === 0)
        throw new VantageError("That evidence is not here.", 404, "not_found");
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export function toDefinitionDto(row: VantageMetricDefinitionRow): MetricDefinitionDto {
    return {
        id: row.id,
        key: row.key,
        name: row.name,
        definition: row.definition,
        unit: row.unit,
        createdAt: row.createdAt.toISOString(),
    };
}

export async function listMetricDefinitionRows(
    companyId: bigint
): Promise<VantageMetricDefinitionRow[]> {
    return getDb()
        .select()
        .from(vantageMetricDefinitions)
        .where(eq(vantageMetricDefinitions.companyId, companyId))
        .orderBy(asc(vantageMetricDefinitions.createdAt));
}

/** Definitions, creating the four defaults for a workspace that has none. */
export async function ensureMetricDefinitions(args: {
    companyId: bigint;
}): Promise<MetricDefinitionDto[]> {
    const existing = await listMetricDefinitionRows(args.companyId);
    if (existing.length > 0) return existing.map(toDefinitionDto);
    const rows = await getDb()
        .insert(vantageMetricDefinitions)
        .values(
            DEFAULT_METRICS.map(m => ({
                id: randomUUID(),
                companyId: args.companyId,
                key: m.key,
                name: m.name,
                definition: m.definition,
                unit: m.unit,
            }))
        )
        .onConflictDoNothing()
        .returning();
    if (rows.length > 0) return rows.map(toDefinitionDto);
    return (await listMetricDefinitionRows(args.companyId)).map(toDefinitionDto);
}

export function slugKey(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 64);
}

export async function createMetricDefinition(args: {
    companyId: bigint;
    input: { key?: string; name: string; definition: string; unit?: string };
}): Promise<MetricDefinitionDto> {
    const key = slugKey(orNull(args.input.key) ?? args.input.name);
    if (!key) throw new VantageError("Give the metric a name.", 400, "invalid");
    const [row] = await getDb()
        .insert(vantageMetricDefinitions)
        .values({
            id: randomUUID(),
            companyId: args.companyId,
            key,
            name: args.input.name.trim(),
            definition: args.input.definition.trim(),
            unit: orNull(args.input.unit) ?? "count",
        })
        .onConflictDoNothing()
        .returning();
    if (!row)
        throw new VantageError(`A metric with the key "${key}" already exists.`, 409, "conflict");
    return toDefinitionDto(row);
}

export async function updateMetricDefinition(args: {
    companyId: bigint;
    id: string;
    patch: { name?: string; definition?: string; unit?: string };
}): Promise<MetricDefinitionDto> {
    const set: Partial<typeof vantageMetricDefinitions.$inferInsert> = {};
    if (args.patch.name !== undefined) set.name = args.patch.name.trim();
    if (args.patch.definition !== undefined) set.definition = args.patch.definition.trim();
    if (args.patch.unit !== undefined) set.unit = orNull(args.patch.unit) ?? "count";
    const [row] = await getDb()
        .update(vantageMetricDefinitions)
        .set(set)
        .where(
            and(
                eq(vantageMetricDefinitions.id, args.id),
                eq(vantageMetricDefinitions.companyId, args.companyId)
            )
        )
        .returning();
    if (!row) throw new VantageError("That metric is not here.", 404, "not_found");
    return toDefinitionDto(row);
}

export async function deleteMetricDefinition(args: {
    companyId: bigint;
    id: string;
}): Promise<void> {
    const deleted = await getDb()
        .delete(vantageMetricDefinitions)
        .where(
            and(
                eq(vantageMetricDefinitions.id, args.id),
                eq(vantageMetricDefinitions.companyId, args.companyId)
            )
        )
        .returning({ id: vantageMetricDefinitions.id });
    if (deleted.length === 0) throw new VantageError("That metric is not here.", 404, "not_found");
}

export async function listObservationRows(args: {
    companyId: bigint;
    limit?: number;
}): Promise<VantageMetricObservationRow[]> {
    return getDb()
        .select()
        .from(vantageMetricObservations)
        .where(eq(vantageMetricObservations.companyId, args.companyId))
        .orderBy(
            desc(vantageMetricObservations.periodEnd),
            desc(vantageMetricObservations.createdAt)
        )
        .limit(args.limit ?? 500);
}

export async function listObservations(args: {
    companyId: bigint;
    limit?: number;
}): Promise<MetricObservationDto[]> {
    const rows = await getDb()
        .select({
            row: vantageMetricObservations,
            key: vantageMetricDefinitions.key,
            name: vantageMetricDefinitions.name,
        })
        .from(vantageMetricObservations)
        .innerJoin(
            vantageMetricDefinitions,
            eq(vantageMetricDefinitions.id, vantageMetricObservations.metricId)
        )
        .where(eq(vantageMetricObservations.companyId, args.companyId))
        .orderBy(
            desc(vantageMetricObservations.periodEnd),
            desc(vantageMetricObservations.createdAt)
        )
        .limit(args.limit ?? 500);
    return rows.map(({ row, key, name }) => ({
        id: row.id,
        metricId: row.metricId,
        metricKey: key,
        metricName: name,
        value: row.value,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        source: row.source ?? null,
        note: row.note ?? null,
        createdAt: row.createdAt.toISOString(),
    }));
}

export interface ObservationInput {
    metricId: string;
    value: number;
    periodStart: string;
    periodEnd: string;
    source?: string | null;
    note?: string | null;
}

export async function createObservations(args: {
    companyId: bigint;
    userId: string;
    inputs: ObservationInput[];
}): Promise<number> {
    if (args.inputs.length === 0) return 0;
    const owned = await listMetricDefinitionRows(args.companyId);
    const ids = new Set(owned.map(d => d.id));
    const values = args.inputs
        .filter(i => ids.has(i.metricId))
        .map(i => ({
            id: randomUUID(),
            companyId: args.companyId,
            createdByUserId: args.userId,
            metricId: i.metricId,
            value: i.value,
            periodStart: i.periodStart,
            periodEnd: i.periodEnd,
            source: orNull(i.source),
            note: orNull(i.note),
        }));
    if (values.length !== args.inputs.length)
        throw new VantageError("One of those metrics is not in this workspace.", 400, "invalid");
    await getDb().insert(vantageMetricObservations).values(values);
    return values.length;
}

export async function deleteObservation(args: { companyId: bigint; id: string }): Promise<void> {
    const deleted = await getDb()
        .delete(vantageMetricObservations)
        .where(
            and(
                eq(vantageMetricObservations.id, args.id),
                eq(vantageMetricObservations.companyId, args.companyId)
            )
        )
        .returning({ id: vantageMetricObservations.id });
    if (deleted.length === 0) throw new VantageError("That number is not here.", 404, "not_found");
}

// ---------------------------------------------------------------------------
// Commitments
// ---------------------------------------------------------------------------

export function toCommitmentDto(
    row: VantageCommitmentRow,
    topicTitle: string | null
): CommitmentDto {
    return {
        id: row.id,
        agendaId: row.agendaId ?? null,
        topicId: row.topicId ?? null,
        topicTitle,
        title: row.title,
        owner: row.owner,
        dueOn: row.dueOn,
        test: row.test ?? null,
        status: row.status,
        outcome: row.outcome ?? null,
        shared: row.shared,
        resolvedAt: iso(row.resolvedAt),
        createdAt: row.createdAt.toISOString(),
    };
}

export async function listCommitmentRows(companyId: bigint): Promise<VantageCommitmentRow[]> {
    return getDb()
        .select()
        .from(vantageCommitments)
        .where(eq(vantageCommitments.companyId, companyId))
        .orderBy(asc(vantageCommitments.dueOn), desc(vantageCommitments.createdAt));
}

export async function listCommitments(args: {
    companyId: bigint;
    status?: VantageCommitmentStatus[];
    agendaId?: string;
    sharedOnly?: boolean;
}): Promise<CommitmentDto[]> {
    const conditions = [eq(vantageCommitments.companyId, args.companyId)];
    if (args.status && args.status.length > 0)
        conditions.push(inArray(vantageCommitments.status, args.status));
    if (args.agendaId) conditions.push(eq(vantageCommitments.agendaId, args.agendaId));
    if (args.sharedOnly) conditions.push(eq(vantageCommitments.shared, true));
    const rows = await getDb()
        .select({ row: vantageCommitments, topicTitle: vantageAgendaTopics.title })
        .from(vantageCommitments)
        .leftJoin(vantageAgendaTopics, eq(vantageAgendaTopics.id, vantageCommitments.topicId))
        .where(and(...conditions))
        .orderBy(asc(vantageCommitments.dueOn), desc(vantageCommitments.createdAt));
    return rows.map(({ row, topicTitle }) => toCommitmentDto(row, topicTitle ?? null));
}

export interface CommitmentInput {
    title: string;
    owner: string;
    dueOn: string;
    test?: string | null;
    shared?: boolean;
    agendaId?: string | null;
    topicId?: string | null;
}

export async function createCommitment(args: {
    companyId: bigint;
    userId: string;
    input: CommitmentInput;
}): Promise<CommitmentDto> {
    const [row] = await getDb()
        .insert(vantageCommitments)
        .values({
            id: randomUUID(),
            companyId: args.companyId,
            createdByUserId: args.userId,
            agendaId: args.input.agendaId ?? null,
            topicId: args.input.topicId ?? null,
            title: args.input.title.trim(),
            owner: args.input.owner.trim(),
            dueOn: args.input.dueOn,
            test: orNull(args.input.test),
            shared: args.input.shared ?? false,
        })
        .returning();
    return toCommitmentDto(row!, null);
}

export async function updateCommitment(args: {
    companyId: bigint;
    id: string;
    patch: {
        title?: string;
        owner?: string;
        dueOn?: string;
        test?: string | null;
        shared?: boolean;
        status?: VantageCommitmentStatus;
        outcome?: string | null;
    };
}): Promise<CommitmentDto> {
    const set: Partial<typeof vantageCommitments.$inferInsert> = {};
    const p = args.patch;
    if (p.title !== undefined) set.title = p.title.trim();
    if (p.owner !== undefined) set.owner = p.owner.trim();
    if (p.dueOn !== undefined) set.dueOn = p.dueOn;
    if (p.test !== undefined) set.test = orNull(p.test);
    if (p.shared !== undefined) set.shared = p.shared;
    if (p.outcome !== undefined) set.outcome = orNull(p.outcome);
    if (p.status !== undefined) {
        set.status = p.status;
        set.resolvedAt = p.status === "open" ? null : new Date();
    }
    const [row] = await getDb()
        .update(vantageCommitments)
        .set(set)
        .where(
            and(
                eq(vantageCommitments.id, args.id),
                eq(vantageCommitments.companyId, args.companyId)
            )
        )
        .returning();
    if (!row) throw new VantageError("That commitment is not here.", 404, "not_found");
    return toCommitmentDto(row, null);
}

export async function deleteCommitment(args: { companyId: bigint; id: string }): Promise<void> {
    const deleted = await getDb()
        .delete(vantageCommitments)
        .where(
            and(
                eq(vantageCommitments.id, args.id),
                eq(vantageCommitments.companyId, args.companyId)
            )
        )
        .returning({ id: vantageCommitments.id });
    if (deleted.length === 0)
        throw new VantageError("That commitment is not here.", 404, "not_found");
}

// ---------------------------------------------------------------------------
// Agendas and topics
// ---------------------------------------------------------------------------

export function toTopicDto(row: VantageAgendaTopicRow, commitmentId: string | null): TopicDto {
    return {
        id: row.id,
        agendaId: row.agendaId,
        position: row.position,
        status: row.status,
        origin: row.origin,
        title: row.title,
        facts: row.facts ?? [],
        whyItMatters: row.whyItMatters,
        decisionQuestion: row.decisionQuestion,
        proposedNextStep: row.proposedNextStep,
        proposedOwner: row.proposedOwner ?? null,
        proposedDue: row.proposedDue ?? null,
        helpRequested: row.helpRequested ?? null,
        unknowns: row.unknowns ?? [],
        conflicts: row.conflicts ?? [],
        rationale: row.rationale ?? null,
        shared: row.shared,
        decision: row.decision ?? null,
        decidedAt: iso(row.decidedAt),
        commitmentId,
    };
}

function toAgendaDto(row: VantageAgendaRow, topics: TopicDto[]): AgendaDto {
    return {
        id: row.id,
        weekStart: row.weekStart,
        weekEnd: weekEndOf(row.weekStart),
        status: row.status,
        summary: row.summary ?? null,
        signals: (row.signals as WeeklySignals | null) ?? null,
        modelMetadata: row.modelMetadata ?? null,
        generatedAt: iso(row.generatedAt),
        heldAt: iso(row.heldAt),
        createdAt: row.createdAt.toISOString(),
        topics,
    };
}

async function topicsFor(companyId: bigint, agendaId: string): Promise<TopicDto[]> {
    const db = getDb();
    const rows = await db
        .select()
        .from(vantageAgendaTopics)
        .where(
            and(
                eq(vantageAgendaTopics.agendaId, agendaId),
                eq(vantageAgendaTopics.companyId, companyId)
            )
        )
        .orderBy(asc(vantageAgendaTopics.position), asc(vantageAgendaTopics.createdAt));
    if (rows.length === 0) return [];
    const links = await db
        .select({ id: vantageCommitments.id, topicId: vantageCommitments.topicId })
        .from(vantageCommitments)
        .where(
            and(
                eq(vantageCommitments.companyId, companyId),
                inArray(
                    vantageCommitments.topicId,
                    rows.map(r => r.id)
                )
            )
        );
    const byTopic = new Map<string, string>();
    for (const l of links) if (l.topicId && !byTopic.has(l.topicId)) byTopic.set(l.topicId, l.id);
    return rows.map(r => toTopicDto(r, byTopic.get(r.id) ?? null));
}

export async function getAgendaByWeek(args: {
    companyId: bigint;
    weekStart: string;
}): Promise<AgendaDto | null> {
    const [row] = await getDb()
        .select()
        .from(vantageAgendas)
        .where(
            and(
                eq(vantageAgendas.companyId, args.companyId),
                eq(vantageAgendas.weekStart, args.weekStart)
            )
        );
    if (!row) return null;
    return toAgendaDto(row, await topicsFor(args.companyId, row.id));
}

export async function getAgenda(args: {
    companyId: bigint;
    id: string;
}): Promise<AgendaDto | null> {
    const [row] = await getDb()
        .select()
        .from(vantageAgendas)
        .where(and(eq(vantageAgendas.companyId, args.companyId), eq(vantageAgendas.id, args.id)));
    if (!row) return null;
    return toAgendaDto(row, await topicsFor(args.companyId, row.id));
}

export async function listAgendas(args: {
    companyId: bigint;
    limit?: number;
}): Promise<AgendaSummaryDto[]> {
    const db = getDb();
    const rows = await db
        .select({
            row: vantageAgendas,
            topicCount: sql<number>`count(${vantageAgendaTopics.id}) filter (where ${vantageAgendaTopics.status} <> 'dismissed')`,
            decidedCount: sql<number>`count(${vantageAgendaTopics.id}) filter (where ${vantageAgendaTopics.decision} is not null)`,
        })
        .from(vantageAgendas)
        .leftJoin(vantageAgendaTopics, eq(vantageAgendaTopics.agendaId, vantageAgendas.id))
        .where(eq(vantageAgendas.companyId, args.companyId))
        .groupBy(vantageAgendas.id)
        .orderBy(desc(vantageAgendas.weekStart))
        .limit(args.limit ?? 26);
    return rows.map(({ row, topicCount, decidedCount }) => ({
        id: row.id,
        weekStart: row.weekStart,
        weekEnd: weekEndOf(row.weekStart),
        status: row.status,
        topicCount: Number(topicCount),
        decidedCount: Number(decidedCount),
        generatedAt: iso(row.generatedAt),
        heldAt: iso(row.heldAt),
    }));
}

/** The agenda row for a week, created as an empty draft if absent. */
export async function ensureAgenda(args: {
    companyId: bigint;
    userId: string;
    weekStart: string;
}): Promise<VantageAgendaRow> {
    const db = getDb();
    const [existing] = await db
        .select()
        .from(vantageAgendas)
        .where(
            and(
                eq(vantageAgendas.companyId, args.companyId),
                eq(vantageAgendas.weekStart, args.weekStart)
            )
        );
    if (existing) return existing;
    const [created] = await db
        .insert(vantageAgendas)
        .values({
            id: randomUUID(),
            companyId: args.companyId,
            createdByUserId: args.userId,
            weekStart: args.weekStart,
        })
        .onConflictDoNothing()
        .returning();
    if (created) return created;
    const [raced] = await db
        .select()
        .from(vantageAgendas)
        .where(
            and(
                eq(vantageAgendas.companyId, args.companyId),
                eq(vantageAgendas.weekStart, args.weekStart)
            )
        );
    return raced!;
}

export interface TopicInput {
    title: string;
    facts?: VantageFact[];
    whyItMatters?: string;
    decisionQuestion?: string;
    proposedNextStep?: string;
    proposedOwner?: string | null;
    proposedDue?: string | null;
    helpRequested?: string | null;
    unknowns?: string[];
    conflicts?: VantageConflict[];
    rationale?: string | null;
    shared?: boolean;
}

/**
 * Replace the untouched generated topics with a new draft. Topics the
 * founder kept, edited, dismissed or wrote themselves stay where they are;
 * new suggestions go after them. Runs in one transaction so a failed
 * generation never leaves an agenda half-emptied.
 */
export async function replaceGeneratedTopics(args: {
    companyId: bigint;
    agendaId: string;
    summary: string;
    signals: WeeklySignals;
    modelMetadata: Record<string, unknown>;
    origin: VantageTopicOrigin;
    topics: TopicInput[];
}): Promise<void> {
    const db = getDb();
    await db.transaction(async tx => {
        await tx
            .delete(vantageAgendaTopics)
            .where(
                and(
                    eq(vantageAgendaTopics.agendaId, args.agendaId),
                    eq(vantageAgendaTopics.companyId, args.companyId),
                    eq(vantageAgendaTopics.status, "suggested"),
                    inArray(vantageAgendaTopics.origin, ["ai", "rules"])
                )
            );
        const [maxRow] = await tx
            .select({ max: sql<number>`coalesce(max(${vantageAgendaTopics.position}), -1)` })
            .from(vantageAgendaTopics)
            .where(eq(vantageAgendaTopics.agendaId, args.agendaId));
        let position = Number(maxRow?.max ?? -1) + 1;
        if (args.topics.length > 0) {
            await tx.insert(vantageAgendaTopics).values(
                args.topics.map(t => ({
                    id: randomUUID(),
                    agendaId: args.agendaId,
                    companyId: args.companyId,
                    position: position++,
                    status: "suggested" as const,
                    origin: args.origin,
                    title: t.title.trim().slice(0, 300),
                    facts: t.facts ?? [],
                    whyItMatters: t.whyItMatters ?? "",
                    decisionQuestion: t.decisionQuestion ?? "",
                    proposedNextStep: t.proposedNextStep ?? "",
                    proposedOwner: t.proposedOwner ?? null,
                    proposedDue: t.proposedDue ?? null,
                    helpRequested: t.helpRequested ?? null,
                    unknowns: t.unknowns ?? [],
                    conflicts: t.conflicts ?? [],
                    rationale: t.rationale ?? null,
                    shared: false,
                }))
            );
        }
        await tx
            .update(vantageAgendas)
            .set({
                summary: args.summary,
                signals: args.signals as unknown as Record<string, unknown>,
                modelMetadata: args.modelMetadata,
                generatedAt: new Date(),
            })
            .where(
                and(
                    eq(vantageAgendas.id, args.agendaId),
                    eq(vantageAgendas.companyId, args.companyId)
                )
            );
    });
}

export async function addTopic(args: {
    companyId: bigint;
    agendaId: string;
    input: TopicInput;
}): Promise<TopicDto> {
    const db = getDb();
    const [agenda] = await db
        .select({ id: vantageAgendas.id })
        .from(vantageAgendas)
        .where(
            and(eq(vantageAgendas.id, args.agendaId), eq(vantageAgendas.companyId, args.companyId))
        );
    if (!agenda) throw new VantageError("That agenda is not here.", 404, "not_found");
    const [maxRow] = await db
        .select({ max: sql<number>`coalesce(max(${vantageAgendaTopics.position}), -1)` })
        .from(vantageAgendaTopics)
        .where(eq(vantageAgendaTopics.agendaId, args.agendaId));
    const [row] = await db
        .insert(vantageAgendaTopics)
        .values({
            id: randomUUID(),
            agendaId: args.agendaId,
            companyId: args.companyId,
            position: Number(maxRow?.max ?? -1) + 1,
            status: "kept",
            origin: "founder",
            title: args.input.title.trim().slice(0, 300),
            facts: args.input.facts ?? [],
            whyItMatters: args.input.whyItMatters ?? "",
            decisionQuestion: args.input.decisionQuestion ?? "",
            proposedNextStep: args.input.proposedNextStep ?? "",
            proposedOwner: args.input.proposedOwner ?? null,
            proposedDue: args.input.proposedDue ?? null,
            helpRequested: args.input.helpRequested ?? null,
            unknowns: args.input.unknowns ?? [],
            conflicts: args.input.conflicts ?? [],
            rationale: args.input.rationale ?? null,
            shared: args.input.shared ?? false,
        })
        .returning();
    return toTopicDto(row!, null);
}

export async function updateTopic(args: {
    companyId: bigint;
    id: string;
    patch: Partial<TopicInput> & { status?: "kept" | "dismissed" | "suggested" };
}): Promise<TopicDto> {
    const set: Partial<typeof vantageAgendaTopics.$inferInsert> = {};
    const p = args.patch;
    if (p.title !== undefined) set.title = p.title.trim().slice(0, 300);
    if (p.facts !== undefined) set.facts = p.facts;
    if (p.whyItMatters !== undefined) set.whyItMatters = p.whyItMatters;
    if (p.decisionQuestion !== undefined) set.decisionQuestion = p.decisionQuestion;
    if (p.proposedNextStep !== undefined) set.proposedNextStep = p.proposedNextStep;
    if (p.proposedOwner !== undefined) set.proposedOwner = orNull(p.proposedOwner);
    if (p.proposedDue !== undefined) set.proposedDue = orNull(p.proposedDue);
    if (p.helpRequested !== undefined) set.helpRequested = orNull(p.helpRequested);
    if (p.unknowns !== undefined) set.unknowns = p.unknowns;
    if (p.conflicts !== undefined) set.conflicts = p.conflicts;
    if (p.shared !== undefined) set.shared = p.shared;
    if (p.status !== undefined) set.status = p.status;
    // Any edit to a suggestion is the founder taking it: it stops being
    // replaceable by the next regeneration.
    const edited =
        p.title !== undefined ||
        p.facts !== undefined ||
        p.whyItMatters !== undefined ||
        p.decisionQuestion !== undefined ||
        p.proposedNextStep !== undefined ||
        p.proposedOwner !== undefined ||
        p.proposedDue !== undefined ||
        p.helpRequested !== undefined ||
        p.shared !== undefined;
    const db = getDb();
    const [current] = await db
        .select({ status: vantageAgendaTopics.status })
        .from(vantageAgendaTopics)
        .where(
            and(
                eq(vantageAgendaTopics.id, args.id),
                eq(vantageAgendaTopics.companyId, args.companyId)
            )
        );
    if (!current) throw new VantageError("That topic is not here.", 404, "not_found");
    if (edited && p.status === undefined && current.status === "suggested") set.status = "kept";
    const [row] = await db
        .update(vantageAgendaTopics)
        .set(set)
        .where(
            and(
                eq(vantageAgendaTopics.id, args.id),
                eq(vantageAgendaTopics.companyId, args.companyId)
            )
        )
        .returning();
    if (!row) throw new VantageError("That topic is not here.", 404, "not_found");
    const [link] = await db
        .select({ id: vantageCommitments.id })
        .from(vantageCommitments)
        .where(
            and(
                eq(vantageCommitments.topicId, row.id),
                eq(vantageCommitments.companyId, args.companyId)
            )
        )
        .limit(1);
    return toTopicDto(row, link?.id ?? null);
}

export async function deleteTopic(args: { companyId: bigint; id: string }): Promise<void> {
    const deleted = await getDb()
        .delete(vantageAgendaTopics)
        .where(
            and(
                eq(vantageAgendaTopics.id, args.id),
                eq(vantageAgendaTopics.companyId, args.companyId)
            )
        )
        .returning({ id: vantageAgendaTopics.id });
    if (deleted.length === 0) throw new VantageError("That topic is not here.", 404, "not_found");
}

/** Reorder: `ids` in the order wanted; anything not listed keeps its place after them. */
export async function reorderTopics(args: {
    companyId: bigint;
    agendaId: string;
    ids: string[];
}): Promise<void> {
    const db = getDb();
    await db.transaction(async tx => {
        const rows = await tx
            .select({ id: vantageAgendaTopics.id, position: vantageAgendaTopics.position })
            .from(vantageAgendaTopics)
            .where(
                and(
                    eq(vantageAgendaTopics.agendaId, args.agendaId),
                    eq(vantageAgendaTopics.companyId, args.companyId)
                )
            )
            .orderBy(asc(vantageAgendaTopics.position));
        const owned = new Set(rows.map(r => r.id));
        const ordered = [
            ...args.ids.filter(id => owned.has(id)),
            ...rows.map(r => r.id).filter(id => !args.ids.includes(id)),
        ];
        for (let i = 0; i < ordered.length; i++) {
            await tx
                .update(vantageAgendaTopics)
                .set({ position: i })
                .where(eq(vantageAgendaTopics.id, ordered[i]!));
        }
    });
}

/**
 * Record what the meeting decided. Writes the decision on the topic and
 * opens the commitment that will be checked next week — one transaction,
 * because a decision without its follow-through is exactly the failure the
 * product exists to stop.
 */
export async function recordDecision(args: {
    companyId: bigint;
    userId: string;
    topicId: string;
    decision: string;
    commitment: {
        title: string;
        owner: string;
        dueOn: string;
        test?: string | null;
        shared?: boolean;
    } | null;
}): Promise<TopicDto> {
    const db = getDb();
    return db.transaction(async tx => {
        const [topic] = await tx
            .update(vantageAgendaTopics)
            .set({
                decision: args.decision.trim(),
                decidedAt: new Date(),
                status: "kept",
            })
            .where(
                and(
                    eq(vantageAgendaTopics.id, args.topicId),
                    eq(vantageAgendaTopics.companyId, args.companyId)
                )
            )
            .returning();
        if (!topic) throw new VantageError("That topic is not here.", 404, "not_found");
        let commitmentId: string | null = null;
        if (args.commitment) {
            const [c] = await tx
                .insert(vantageCommitments)
                .values({
                    id: randomUUID(),
                    companyId: args.companyId,
                    createdByUserId: args.userId,
                    agendaId: topic.agendaId,
                    topicId: topic.id,
                    title: args.commitment.title.trim(),
                    owner: args.commitment.owner.trim(),
                    dueOn: args.commitment.dueOn,
                    test: orNull(args.commitment.test),
                    shared: args.commitment.shared ?? topic.shared,
                })
                .returning({ id: vantageCommitments.id });
            commitmentId = c!.id;
        } else {
            const [existing] = await tx
                .select({ id: vantageCommitments.id })
                .from(vantageCommitments)
                .where(
                    and(
                        eq(vantageCommitments.topicId, topic.id),
                        eq(vantageCommitments.companyId, args.companyId)
                    )
                )
                .limit(1);
            commitmentId = existing?.id ?? null;
        }
        return toTopicDto(topic, commitmentId);
    });
}

/**
 * Take back a decision just recorded — the Undo after a one-click commit.
 * The topic is undecided again and the commitment that decision opened, when
 * named, is removed with it, in one transaction. Only a commitment opened
 * from this topic can go this way; anything else linked to it stays.
 */
export async function undoDecision(args: {
    companyId: bigint;
    topicId: string;
    commitmentId?: string | null;
}): Promise<TopicDto> {
    const db = getDb();
    return db.transaction(async tx => {
        const [topic] = await tx
            .update(vantageAgendaTopics)
            .set({ decision: null, decidedAt: null })
            .where(
                and(
                    eq(vantageAgendaTopics.id, args.topicId),
                    eq(vantageAgendaTopics.companyId, args.companyId)
                )
            )
            .returning();
        if (!topic) throw new VantageError("That topic is not here.", 404, "not_found");
        if (args.commitmentId) {
            await tx
                .delete(vantageCommitments)
                .where(
                    and(
                        eq(vantageCommitments.id, args.commitmentId),
                        eq(vantageCommitments.topicId, topic.id),
                        eq(vantageCommitments.companyId, args.companyId)
                    )
                );
        }
        const [link] = await tx
            .select({ id: vantageCommitments.id })
            .from(vantageCommitments)
            .where(
                and(
                    eq(vantageCommitments.topicId, topic.id),
                    eq(vantageCommitments.companyId, args.companyId)
                )
            )
            .limit(1);
        return toTopicDto(topic, link?.id ?? null);
    });
}

export async function updateAgendaStatus(args: {
    companyId: bigint;
    id: string;
    status: VantageAgendaStatus;
}): Promise<AgendaDto> {
    const set: Partial<typeof vantageAgendas.$inferInsert> = { status: args.status };
    if (args.status === "held") set.heldAt = new Date();
    const [row] = await getDb()
        .update(vantageAgendas)
        .set(set)
        .where(and(eq(vantageAgendas.id, args.id), eq(vantageAgendas.companyId, args.companyId)))
        .returning();
    if (!row) throw new VantageError("That agenda is not here.", 404, "not_found");
    return toAgendaDto(row, await topicsFor(args.companyId, row.id));
}

export async function deleteAgenda(args: { companyId: bigint; id: string }): Promise<boolean> {
    const deleted = await getDb()
        .delete(vantageAgendas)
        .where(and(eq(vantageAgendas.id, args.id), eq(vantageAgendas.companyId, args.companyId)))
        .returning({ id: vantageAgendas.id });
    return deleted.length > 0;
}

/** Shared topics with an open help request, newest agenda first. */
export async function listHelpRequests(args: {
    companyId: bigint;
    limit?: number;
}): Promise<{ topic: TopicDto; weekStart: string; agendaId: string }[]> {
    const rows = await getDb()
        .select({ topic: vantageAgendaTopics, weekStart: vantageAgendas.weekStart })
        .from(vantageAgendaTopics)
        .innerJoin(vantageAgendas, eq(vantageAgendas.id, vantageAgendaTopics.agendaId))
        .where(
            and(
                eq(vantageAgendaTopics.companyId, args.companyId),
                eq(vantageAgendaTopics.shared, true),
                sql`${vantageAgendaTopics.helpRequested} is not null and ${vantageAgendaTopics.helpRequested} <> ''`,
                sql`${vantageAgendaTopics.status} <> 'dismissed'`
            )
        )
        .orderBy(desc(vantageAgendas.weekStart), asc(vantageAgendaTopics.position))
        .limit(args.limit ?? 50);
    return rows.map(({ topic, weekStart }) => ({
        topic: toTopicDto(topic, null),
        weekStart,
        agendaId: topic.agendaId,
    }));
}

// ---------------------------------------------------------------------------
// Program deadlines
// ---------------------------------------------------------------------------

export function toDeadlineDto(row: VantageProgramDeadlineRow): DeadlineDto {
    return {
        id: row.id,
        title: row.title,
        dueOn: row.dueOn,
        note: row.note ?? null,
        createdAt: row.createdAt.toISOString(),
    };
}

export async function listDeadlines(args: {
    companyId: bigint;
    from?: string;
}): Promise<DeadlineDto[]> {
    const conditions = [eq(vantageProgramDeadlines.companyId, args.companyId)];
    if (args.from) conditions.push(gte(vantageProgramDeadlines.dueOn, args.from));
    const rows = await getDb()
        .select()
        .from(vantageProgramDeadlines)
        .where(and(...conditions))
        .orderBy(asc(vantageProgramDeadlines.dueOn));
    return rows.map(toDeadlineDto);
}

export async function createDeadline(args: {
    companyId: bigint;
    userId: string;
    input: { title: string; dueOn: string; note?: string | null };
}): Promise<DeadlineDto> {
    const [row] = await getDb()
        .insert(vantageProgramDeadlines)
        .values({
            id: randomUUID(),
            companyId: args.companyId,
            createdByUserId: args.userId,
            title: args.input.title.trim(),
            dueOn: args.input.dueOn,
            note: orNull(args.input.note),
        })
        .returning();
    return toDeadlineDto(row!);
}

export async function deleteDeadline(args: { companyId: bigint; id: string }): Promise<void> {
    const deleted = await getDb()
        .delete(vantageProgramDeadlines)
        .where(
            and(
                eq(vantageProgramDeadlines.id, args.id),
                eq(vantageProgramDeadlines.companyId, args.companyId)
            )
        )
        .returning({ id: vantageProgramDeadlines.id });
    if (deleted.length === 0)
        throw new VantageError("That deadline is not here.", 404, "not_found");
}

/** Most recent moment anything was logged in this workspace's Vantage. */
export async function lastEntryAt(companyId: bigint): Promise<Date | null> {
    const db = getDb();
    const [e] = await db
        .select({ at: sql<Date | null>`max(${vantageEvidence.createdAt})` })
        .from(vantageEvidence)
        .where(eq(vantageEvidence.companyId, companyId));
    const [o] = await db
        .select({ at: sql<Date | null>`max(${vantageMetricObservations.createdAt})` })
        .from(vantageMetricObservations)
        .where(eq(vantageMetricObservations.companyId, companyId));
    const [a] = await db
        .select({ at: sql<Date | null>`max(${vantageAgendas.updatedAt})` })
        .from(vantageAgendas)
        .where(eq(vantageAgendas.companyId, companyId));
    const candidates: Date[] = [];
    for (const raw of [e?.at, o?.at, a?.at]) {
        if (!raw) continue;
        const d = raw instanceof Date ? raw : new Date(raw as unknown as string);
        if (!Number.isNaN(d.getTime())) candidates.push(d);
    }
    if (candidates.length === 0) return null;
    return candidates.sort((x, y) => y.getTime() - x.getTime())[0]!;
}
