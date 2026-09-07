/**
 * Persistence for the distribution pipeline. Every read and write is scoped
 * by company_id; nothing here accepts a tenant from a model or a URL — the
 * route resolves the workspace and the job carries what the route resolved.
 */
import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";

import { getDb } from "@launchstack/store/client";
import { kgEntities } from "@launchstack/store/schema";
import type { ResolvedOrg } from "@launchstack/tools/org-resolver";
import { normalizeDomain, normalizeOrgName } from "@launchstack/tools/org-resolver";

import {
    distributionAgreements,
    distributionPrograms,
    distributionRuns,
    partnerEvidence,
    partnerOrgs,
    partnerRelationships,
    relationshipEvents,
    type DistributionAgreementRow,
    type DistributionProgramRow,
    type DistributionRunRow,
    type PartnerEvidenceRow,
    type PartnerOrgRow,
    type PartnerRelationshipRow,
    type RelationshipEventRow,
} from "./schema";
import { assertTransition, isPastCandidate, STALE_AFTER_DAYS, STAGE_ORDER } from "./stages";
import type {
    AgreementInput,
    AgreementRecord,
    DiscoveryPlan,
    Dossier,
    EvidenceKind,
    EvidenceRecord,
    FitBreakdown,
    ImportPartnerRow,
    PartnerKind,
    PartnerOrgRecord,
    ProgramInput,
    ProgramPatch,
    ProgramRecord,
    RelationshipEventRecord,
    RelationshipEventType,
    RelationshipRecord,
    RelationshipStage,
    RunOptions,
    RunRecord,
    RunStatus,
    RunSummary,
    ScreeningState,
    Territory,
} from "./types";

// ─── Mappers ─────────────────────────────────────────────────────────────────

function toProgram(row: DistributionProgramRow): ProgramRecord {
    return {
        id: row.id,
        companyId: row.companyId,
        createdByUserId: row.createdByUserId,
        name: row.name,
        offering: row.offering,
        categories: row.categories ?? [],
        hsCodes: row.hsCodes ?? [],
        targetTerritories: row.targetTerritories ?? [],
        partnerKinds: (row.partnerKinds ?? []) as PartnerKind[],
        constraints: row.constraints ?? null,
        knownPartnerDomains: row.knownPartnerDomains ?? [],
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt ?? null,
    };
}

function toRun(row: DistributionRunRow): RunRecord {
    return {
        id: row.id,
        companyId: row.companyId,
        programId: row.programId,
        userId: row.userId,
        status: row.status,
        options: row.options,
        plan: row.plan ?? null,
        summary: row.summary ?? null,
        candidateOrgIds: row.candidateOrgIds ?? null,
        creditsUsed: row.creditsUsed,
        errorMessage: row.errorMessage ?? null,
        createdAt: row.createdAt,
        startedAt: row.startedAt ?? null,
        completedAt: row.completedAt ?? null,
    };
}

function toOrg(row: PartnerOrgRow): PartnerOrgRecord {
    return {
        id: row.id,
        companyId: row.companyId,
        resolveKey: row.resolveKey,
        name: row.name,
        domain: row.domain ?? null,
        country: row.country ?? null,
        region: row.region ?? null,
        city: row.city ?? null,
        lat: row.lat ?? null,
        lng: row.lng ?? null,
        roles: row.roles ?? [],
        categories: row.categories ?? [],
        sizeBand: row.sizeBand ?? null,
        description: row.description ?? null,
        kgEntityId: row.kgEntityId ?? null,
        firstSeenRunId: row.firstSeenRunId ?? null,
        lastEnrichedAt: row.lastEnrichedAt ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt ?? null,
    };
}

function toEvidence(row: PartnerEvidenceRow): EvidenceRecord {
    return {
        id: row.id,
        companyId: row.companyId,
        orgId: row.orgId,
        runId: row.runId ?? null,
        kind: row.kind as EvidenceKind,
        claim: row.claim,
        sourceUrl: row.sourceUrl,
        quote: row.quote ?? null,
        confidence: row.confidence,
        capturedAt: row.capturedAt,
        provenance: row.provenance ?? null,
    };
}

function toRelationship(row: PartnerRelationshipRow): RelationshipRecord {
    return {
        id: row.id,
        companyId: row.companyId,
        programId: row.programId,
        orgId: row.orgId,
        kind: row.kind,
        territory: row.territory ?? null,
        stage: row.stage,
        fitScore: row.fitScore ?? null,
        fitRationale: row.fitRationale ?? null,
        fitBreakdown: row.fitBreakdown ?? null,
        riskFlags: row.riskFlags ?? [],
        screening: row.screening ?? null,
        dossier: row.dossier ?? null,
        ownerUserId: row.ownerUserId ?? null,
        nextAction: row.nextAction ?? null,
        nextActionAt: row.nextActionAt ?? null,
        lastActivityAt: row.lastActivityAt ?? null,
        dossierDocumentId: row.dossierDocumentId ?? null,
        source: row.source,
        stageChangedAt: row.stageChangedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt ?? null,
    };
}

function toEvent(row: RelationshipEventRow): RelationshipEventRecord {
    return {
        id: row.id,
        companyId: row.companyId,
        relationshipId: row.relationshipId,
        type: row.type as RelationshipEventType,
        payload: row.payload ?? {},
        actorUserId: row.actorUserId ?? null,
        ref: row.ref ?? null,
        occurredAt: row.occurredAt,
    };
}

function toAgreement(row: DistributionAgreementRow): AgreementRecord {
    return {
        id: row.id,
        companyId: row.companyId,
        relationshipId: row.relationshipId,
        territory: row.territory ?? null,
        exclusivity: row.exclusivity,
        startsOn: row.startsOn ?? null,
        endsOn: row.endsOn ?? null,
        terms: row.terms ?? {},
        documentId: row.documentId ?? null,
        renewalReminderAt: row.renewalReminderAt ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt ?? null,
    };
}

// ─── Programs ────────────────────────────────────────────────────────────────

export async function createProgram(args: {
    companyId: bigint;
    userId: string;
    input: ProgramInput;
}): Promise<ProgramRecord> {
    const db = getDb();
    const [row] = await db
        .insert(distributionPrograms)
        .values({
            id: randomUUID(),
            companyId: args.companyId,
            createdByUserId: args.userId,
            name: args.input.name,
            offering: args.input.offering,
            categories: args.input.categories,
            hsCodes: args.input.hsCodes,
            targetTerritories: args.input.targetTerritories,
            partnerKinds: args.input.partnerKinds,
            constraints: args.input.constraints ?? null,
            knownPartnerDomains: args.input.knownPartnerDomains
                .map(d => normalizeDomain(d))
                .filter((d): d is string => Boolean(d)),
        })
        .returning();
    if (!row) throw new Error("Failed to create distribution program");
    return toProgram(row);
}

export async function listPrograms(companyId: bigint): Promise<ProgramRecord[]> {
    const db = getDb();
    const rows = await db
        .select()
        .from(distributionPrograms)
        .where(eq(distributionPrograms.companyId, companyId))
        .orderBy(desc(distributionPrograms.createdAt));
    return rows.map(toProgram);
}

export async function getProgram(id: string, companyId: bigint): Promise<ProgramRecord | null> {
    const db = getDb();
    const [row] = await db
        .select()
        .from(distributionPrograms)
        .where(and(eq(distributionPrograms.id, id), eq(distributionPrograms.companyId, companyId)))
        .limit(1);
    return row ? toProgram(row) : null;
}

export async function updateProgram(
    id: string,
    companyId: bigint,
    patch: ProgramPatch
): Promise<ProgramRecord | null> {
    const db = getDb();
    const values: Partial<InferInsertModel<typeof distributionPrograms>> = {};
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.offering !== undefined) values.offering = patch.offering;
    if (patch.categories !== undefined) values.categories = patch.categories;
    if (patch.hsCodes !== undefined) values.hsCodes = patch.hsCodes;
    if (patch.targetTerritories !== undefined) values.targetTerritories = patch.targetTerritories;
    if (patch.partnerKinds !== undefined) values.partnerKinds = patch.partnerKinds;
    if (patch.constraints !== undefined) values.constraints = patch.constraints ?? null;
    if (patch.knownPartnerDomains !== undefined) {
        values.knownPartnerDomains = patch.knownPartnerDomains
            .map(d => normalizeDomain(d))
            .filter((d): d is string => Boolean(d));
    }
    if (patch.status !== undefined) values.status = patch.status;
    if (Object.keys(values).length === 0) return getProgram(id, companyId);
    const [row] = await db
        .update(distributionPrograms)
        .set(values)
        .where(and(eq(distributionPrograms.id, id), eq(distributionPrograms.companyId, companyId)))
        .returning();
    return row ? toProgram(row) : null;
}

// ─── Runs ────────────────────────────────────────────────────────────────────

export async function createRun(args: {
    id?: string;
    companyId: bigint;
    programId: string;
    userId: string;
    options: RunOptions;
}): Promise<RunRecord> {
    const db = getDb();
    const [row] = await db
        .insert(distributionRuns)
        .values({
            id: args.id ?? randomUUID(),
            companyId: args.companyId,
            programId: args.programId,
            userId: args.userId,
            options: args.options,
        })
        .returning();
    if (!row) throw new Error("Failed to create distribution run");
    return toRun(row);
}

export async function getRun(id: string, companyId: bigint): Promise<RunRecord | null> {
    const db = getDb();
    const [row] = await db
        .select()
        .from(distributionRuns)
        .where(and(eq(distributionRuns.id, id), eq(distributionRuns.companyId, companyId)))
        .limit(1);
    return row ? toRun(row) : null;
}

export async function listRuns(
    companyId: bigint,
    options: { programId?: string; limit?: number } = {}
): Promise<RunRecord[]> {
    const db = getDb();
    const conditions = [eq(distributionRuns.companyId, companyId)];
    if (options.programId) conditions.push(eq(distributionRuns.programId, options.programId));
    const rows = await db
        .select()
        .from(distributionRuns)
        .where(and(...conditions))
        .orderBy(desc(distributionRuns.createdAt))
        .limit(options.limit ?? 50);
    return rows.map(toRun);
}

export async function updateRun(
    id: string,
    companyId: bigint,
    patch: {
        status?: RunStatus;
        plan?: DiscoveryPlan;
        summary?: RunSummary;
        candidateOrgIds?: string[];
        errorMessage?: string | null;
        startedAt?: Date;
        completedAt?: Date;
    }
): Promise<RunRecord | null> {
    const db = getDb();
    const values: Partial<InferInsertModel<typeof distributionRuns>> = { ...patch };
    if (patch.status === "completed" || patch.status === "failed") {
        values.completedAt = patch.completedAt ?? new Date();
    }
    const [row] = await db
        .update(distributionRuns)
        .set(values)
        .where(and(eq(distributionRuns.id, id), eq(distributionRuns.companyId, companyId)))
        .returning();
    return row ? toRun(row) : null;
}

export async function addRunCredits(id: string, companyId: bigint, amount: number): Promise<void> {
    if (amount <= 0) return;
    const db = getDb();
    await db
        .update(distributionRuns)
        .set({ creditsUsed: sql`${distributionRuns.creditsUsed} + ${amount}` })
        .where(and(eq(distributionRuns.id, id), eq(distributionRuns.companyId, companyId)));
}

// ─── Organisations ───────────────────────────────────────────────────────────

function mergeUnique(a: readonly string[] | null | undefined, b: readonly string[]): string[] {
    const out = [...(a ?? [])];
    for (const value of b) if (value && !out.includes(value)) out.push(value);
    return out;
}

/** Insert new organisations, merge into existing ones by resolve key. Returns rows in input order. */
export async function upsertOrgs(args: {
    companyId: bigint;
    runId: string | null;
    orgs: readonly ResolvedOrg[];
}): Promise<PartnerOrgRecord[]> {
    if (args.orgs.length === 0) return [];
    const db = getDb();
    const keys = args.orgs.map(o => o.resolveKey);
    const existing = await db
        .select()
        .from(partnerOrgs)
        .where(
            and(eq(partnerOrgs.companyId, args.companyId), inArray(partnerOrgs.resolveKey, keys))
        );
    const byKey = new Map(existing.map(row => [row.resolveKey, row]));

    const out: PartnerOrgRecord[] = [];
    for (const org of args.orgs) {
        const current = byKey.get(org.resolveKey);
        if (current) {
            const [row] = await db
                .update(partnerOrgs)
                .set({
                    domain: current.domain ?? org.domain,
                    country: current.country ?? org.country,
                    region: current.region ?? org.region,
                    city: current.city ?? org.city,
                    description: current.description ?? org.description,
                    roles: mergeUnique(current.roles, org.roles),
                    categories: mergeUnique(current.categories, org.categories),
                    name: current.name === current.domain && org.name ? org.name : current.name,
                })
                .where(eq(partnerOrgs.id, current.id))
                .returning();
            out.push(toOrg(row ?? current));
            continue;
        }
        const [row] = await db
            .insert(partnerOrgs)
            .values({
                id: randomUUID(),
                companyId: args.companyId,
                resolveKey: org.resolveKey,
                name: org.name,
                domain: org.domain,
                country: org.country,
                region: org.region,
                city: org.city,
                roles: org.roles,
                categories: org.categories,
                description: org.description,
                firstSeenRunId: args.runId,
            })
            .onConflictDoNothing({ target: [partnerOrgs.companyId, partnerOrgs.resolveKey] })
            .returning();
        if (row) {
            byKey.set(org.resolveKey, row);
            out.push(toOrg(row));
        } else {
            // Lost a race with a concurrent run: read the winner.
            const [winner] = await db
                .select()
                .from(partnerOrgs)
                .where(
                    and(
                        eq(partnerOrgs.companyId, args.companyId),
                        eq(partnerOrgs.resolveKey, org.resolveKey)
                    )
                )
                .limit(1);
            if (winner) out.push(toOrg(winner));
        }
    }
    return out;
}

export async function getOrg(id: string, companyId: bigint): Promise<PartnerOrgRecord | null> {
    const db = getDb();
    const [row] = await db
        .select()
        .from(partnerOrgs)
        .where(and(eq(partnerOrgs.id, id), eq(partnerOrgs.companyId, companyId)))
        .limit(1);
    return row ? toOrg(row) : null;
}

export async function listOrgsByIds(
    ids: readonly string[],
    companyId: bigint
): Promise<PartnerOrgRecord[]> {
    if (ids.length === 0) return [];
    const db = getDb();
    const rows = await db
        .select()
        .from(partnerOrgs)
        .where(and(eq(partnerOrgs.companyId, companyId), inArray(partnerOrgs.id, [...ids])));
    return rows.map(toOrg);
}

export async function updateOrg(
    id: string,
    companyId: bigint,
    patch: Partial<
        Pick<
            InferInsertModel<typeof partnerOrgs>,
            | "sizeBand"
            | "description"
            | "roles"
            | "categories"
            | "kgEntityId"
            | "lastEnrichedAt"
            | "lat"
            | "lng"
            | "city"
            | "region"
            | "country"
        >
    >
): Promise<PartnerOrgRecord | null> {
    const db = getDb();
    const [row] = await db
        .update(partnerOrgs)
        .set(patch)
        .where(and(eq(partnerOrgs.id, id), eq(partnerOrgs.companyId, companyId)))
        .returning();
    return row ? toOrg(row) : null;
}

/**
 * "Do we already know them": a knowledge-graph organisation entity whose
 * normalised name matches. Entities are company-scoped, so this is
 * tenant-private by construction.
 */
export async function findKnownOrgEntity(
    companyId: bigint,
    name: string
): Promise<{ id: number; displayName: string; mentionCount: number } | null> {
    const normalized = normalizeOrgName(name);
    if (!normalized) return null;
    const db = getDb();
    const [row] = await db
        .select({
            id: kgEntities.id,
            displayName: kgEntities.displayName,
            mentionCount: kgEntities.mentionCount,
        })
        .from(kgEntities)
        .where(
            and(
                eq(kgEntities.companyId, companyId),
                eq(kgEntities.label, "ORG"),
                eq(kgEntities.name, normalized)
            )
        )
        .limit(1);
    return row ?? null;
}

// ─── Evidence ────────────────────────────────────────────────────────────────

export async function insertEvidence(args: {
    companyId: bigint;
    orgId: string;
    runId: string | null;
    kind: EvidenceKind;
    claim: string;
    sourceUrl: string;
    quote?: string | null;
    confidence?: number;
    provenance?: Record<string, unknown> | null;
}): Promise<EvidenceRecord> {
    const db = getDb();
    const [row] = await db
        .insert(partnerEvidence)
        .values({
            companyId: args.companyId,
            orgId: args.orgId,
            runId: args.runId,
            kind: args.kind,
            claim: args.claim,
            sourceUrl: args.sourceUrl,
            quote: args.quote ?? null,
            confidence: args.confidence ?? 0.5,
            provenance: args.provenance ?? null,
        })
        .returning();
    if (!row) throw new Error("Failed to insert evidence");
    return toEvidence(row);
}

export async function listEvidenceForOrg(
    companyId: bigint,
    orgId: string
): Promise<EvidenceRecord[]> {
    const db = getDb();
    const rows = await db
        .select()
        .from(partnerEvidence)
        .where(and(eq(partnerEvidence.companyId, companyId), eq(partnerEvidence.orgId, orgId)))
        .orderBy(asc(partnerEvidence.id));
    return rows.map(toEvidence);
}

export async function listEvidenceByIds(
    companyId: bigint,
    ids: readonly number[]
): Promise<EvidenceRecord[]> {
    if (ids.length === 0) return [];
    const db = getDb();
    const rows = await db
        .select()
        .from(partnerEvidence)
        .where(
            and(eq(partnerEvidence.companyId, companyId), inArray(partnerEvidence.id, [...ids]))
        );
    return rows.map(toEvidence);
}

// ─── Relationships ───────────────────────────────────────────────────────────

/** Create candidate rows; existing (program, org, kind) rows are left untouched. */
export async function upsertCandidateRelationships(args: {
    companyId: bigint;
    programId: string;
    items: ReadonlyArray<{ orgId: string; kind: PartnerKind; territory: Territory | null }>;
}): Promise<RelationshipRecord[]> {
    if (args.items.length === 0) return [];
    const db = getDb();
    await db
        .insert(partnerRelationships)
        .values(
            args.items.map(item => ({
                id: randomUUID(),
                companyId: args.companyId,
                programId: args.programId,
                orgId: item.orgId,
                kind: item.kind,
                territory: item.territory,
                source: "discovery" as const,
            }))
        )
        .onConflictDoNothing();
    const orgIds = [...new Set(args.items.map(i => i.orgId))];
    const rows = await db
        .select()
        .from(partnerRelationships)
        .where(
            and(
                eq(partnerRelationships.companyId, args.companyId),
                eq(partnerRelationships.programId, args.programId),
                inArray(partnerRelationships.orgId, orgIds)
            )
        );
    return rows.map(toRelationship);
}

export async function getRelationship(
    id: string,
    companyId: bigint
): Promise<RelationshipRecord | null> {
    const db = getDb();
    const [row] = await db
        .select()
        .from(partnerRelationships)
        .where(and(eq(partnerRelationships.id, id), eq(partnerRelationships.companyId, companyId)))
        .limit(1);
    return row ? toRelationship(row) : null;
}

export interface PartnerListFilters {
    programId?: string;
    stage?: RelationshipStage | RelationshipStage[];
    kind?: PartnerKind;
    country?: string;
    minFit?: number;
    /** Only relationships whose last activity is older than this many days (and are in a stale-able stage). */
    staleOnly?: boolean;
    /** Only relationships with a next action due on or before this date. */
    dueBefore?: Date;
    search?: string;
    limit?: number;
    offset?: number;
    orderBy?: "fit" | "activity" | "stage" | "created";
}

export interface PartnerListItem {
    relationship: RelationshipRecord;
    org: PartnerOrgRecord;
    evidenceCount: number;
    stale: boolean;
}

function staleCutoff(stage: RelationshipStage, now: Date): Date | null {
    const days = STALE_AFTER_DAYS[stage];
    if (days === null) return null;
    return new Date(now.getTime() - days * 86_400_000);
}

export function isStale(
    relationship: Pick<RelationshipRecord, "stage" | "lastActivityAt" | "stageChangedAt">,
    now = new Date()
): boolean {
    const cutoff = staleCutoff(relationship.stage, now);
    if (!cutoff) return false;
    const last = relationship.lastActivityAt ?? relationship.stageChangedAt;
    return last.getTime() < cutoff.getTime();
}

export async function listPartners(
    companyId: bigint,
    filters: PartnerListFilters = {}
): Promise<PartnerListItem[]> {
    const db = getDb();
    const conditions = [eq(partnerRelationships.companyId, companyId)];
    if (filters.programId) conditions.push(eq(partnerRelationships.programId, filters.programId));
    if (filters.stage) {
        const stages = Array.isArray(filters.stage) ? filters.stage : [filters.stage];
        if (stages.length > 0) conditions.push(inArray(partnerRelationships.stage, stages));
    }
    if (filters.kind) conditions.push(eq(partnerRelationships.kind, filters.kind));
    if (filters.country) conditions.push(eq(partnerOrgs.country, filters.country.toUpperCase()));
    if (filters.minFit !== undefined)
        conditions.push(gte(partnerRelationships.fitScore, filters.minFit));
    if (filters.dueBefore) {
        conditions.push(isNotNull(partnerRelationships.nextActionAt));
        conditions.push(lt(partnerRelationships.nextActionAt, filters.dueBefore));
    }
    if (filters.search) {
        const needle = `%${filters.search.toLowerCase()}%`;
        conditions.push(sql`lower(${partnerOrgs.name}) like ${needle}`);
    }

    const evidenceCount = sql<number>`(
        select count(*)::int from ${partnerEvidence}
        where ${partnerEvidence.orgId} = ${partnerRelationships.orgId}
          and ${partnerEvidence.companyId} = ${partnerRelationships.companyId}
    )`;

    const order =
        filters.orderBy === "activity"
            ? [
                  desc(
                      sql`coalesce(${partnerRelationships.lastActivityAt}, ${partnerRelationships.stageChangedAt})`
                  ),
              ]
            : filters.orderBy === "created"
              ? [desc(partnerRelationships.createdAt)]
              : filters.orderBy === "stage"
                ? [asc(partnerRelationships.stage), desc(partnerRelationships.fitScore)]
                : [
                      desc(sql`coalesce(${partnerRelationships.fitScore}, -1)`),
                      desc(partnerRelationships.createdAt),
                  ];

    const rows = await db
        .select({ relationship: partnerRelationships, org: partnerOrgs, evidenceCount })
        .from(partnerRelationships)
        .innerJoin(partnerOrgs, eq(partnerOrgs.id, partnerRelationships.orgId))
        .where(and(...conditions))
        .orderBy(...order)
        .limit(Math.min(filters.limit ?? 100, 500))
        .offset(filters.offset ?? 0);

    const now = new Date();
    const items = rows.map(row => {
        const relationship = toRelationship(row.relationship);
        return {
            relationship,
            org: toOrg(row.org),
            evidenceCount: Number(row.evidenceCount ?? 0),
            stale: isStale(relationship, now),
        };
    });
    return filters.staleOnly ? items.filter(i => i.stale) : items;
}

export async function updateRelationship(
    id: string,
    companyId: bigint,
    patch: Partial<
        Pick<
            InferInsertModel<typeof partnerRelationships>,
            | "ownerUserId"
            | "nextAction"
            | "nextActionAt"
            | "lastActivityAt"
            | "dossierDocumentId"
            | "riskFlags"
            | "screening"
            | "territory"
        >
    >
): Promise<RelationshipRecord | null> {
    const db = getDb();
    const [row] = await db
        .update(partnerRelationships)
        .set(patch)
        .where(and(eq(partnerRelationships.id, id), eq(partnerRelationships.companyId, companyId)))
        .returning();
    return row ? toRelationship(row) : null;
}

/** Record the enrich/score outcome for a relationship. */
export async function setResearchResult(
    id: string,
    companyId: bigint,
    result: {
        dossier: Dossier | null;
        fitScore: number;
        fitRationale: string;
        fitBreakdown: FitBreakdown;
        riskFlags: string[];
        screening: ScreeningState;
        stage: RelationshipStage;
    }
): Promise<RelationshipRecord | null> {
    const db = getDb();
    const [row] = await db
        .update(partnerRelationships)
        .set({
            dossier: result.dossier,
            fitScore: result.fitScore,
            fitRationale: result.fitRationale,
            fitBreakdown: result.fitBreakdown,
            riskFlags: result.riskFlags,
            screening: result.screening,
            stage: result.stage,
            stageChangedAt: new Date(),
            lastActivityAt: new Date(),
        })
        .where(and(eq(partnerRelationships.id, id), eq(partnerRelationships.companyId, companyId)))
        .returning();
    return row ? toRelationship(row) : null;
}

/** Domains and resolve keys this program must never re-discover (design §4.4 exclusion gate). */
export async function listExclusions(
    companyId: bigint,
    programId: string
): Promise<{ domains: string[]; keys: string[] }> {
    const db = getDb();
    const program = await getProgram(programId, companyId);
    const domains = new Set<string>(program?.knownPartnerDomains ?? []);
    const keys = new Set<string>();
    const rows = await db
        .select({
            stage: partnerRelationships.stage,
            source: partnerRelationships.source,
            domain: partnerOrgs.domain,
            resolveKey: partnerOrgs.resolveKey,
        })
        .from(partnerRelationships)
        .innerJoin(partnerOrgs, eq(partnerOrgs.id, partnerRelationships.orgId))
        .where(
            and(
                eq(partnerRelationships.companyId, companyId),
                eq(partnerRelationships.programId, programId)
            )
        );
    for (const row of rows) {
        const engaged =
            isPastCandidate(row.stage) || row.source === "import" || row.stage === "declined";
        if (!engaged) continue;
        if (row.domain) domains.add(row.domain);
        keys.add(row.resolveKey);
    }
    return { domains: [...domains], keys: [...keys] };
}

// ─── Events and transitions ──────────────────────────────────────────────────

export async function addEvent(args: {
    companyId: bigint;
    relationshipId: string;
    type: RelationshipEventType;
    payload?: Record<string, unknown>;
    actorUserId?: string | null;
    ref?: string | null;
    occurredAt?: Date;
    /** Update last_activity_at (default true). */
    touch?: boolean;
}): Promise<RelationshipEventRecord> {
    const db = getDb();
    const occurredAt = args.occurredAt ?? new Date();
    const [row] = await db
        .insert(relationshipEvents)
        .values({
            companyId: args.companyId,
            relationshipId: args.relationshipId,
            type: args.type,
            payload: args.payload ?? {},
            actorUserId: args.actorUserId ?? null,
            ref: args.ref ?? null,
            occurredAt,
        })
        .returning();
    if (!row) throw new Error("Failed to record relationship event");
    if (args.touch !== false) {
        await db
            .update(partnerRelationships)
            .set({ lastActivityAt: occurredAt })
            .where(
                and(
                    eq(partnerRelationships.id, args.relationshipId),
                    eq(partnerRelationships.companyId, args.companyId)
                )
            );
    }
    return toEvent(row);
}

export async function listEvents(
    companyId: bigint,
    relationshipId: string
): Promise<RelationshipEventRecord[]> {
    const db = getDb();
    const rows = await db
        .select()
        .from(relationshipEvents)
        .where(
            and(
                eq(relationshipEvents.companyId, companyId),
                eq(relationshipEvents.relationshipId, relationshipId)
            )
        )
        .orderBy(desc(relationshipEvents.occurredAt), desc(relationshipEvents.id));
    return rows.map(toEvent);
}

/**
 * Apply a stage transition through the table in stages.ts and record the
 * event. Throws StageTransitionError (status 409) on an illegal move.
 */
export async function transitionStage(args: {
    companyId: bigint;
    relationshipId: string;
    to: RelationshipStage;
    actorUserId: string | null;
    /** Field updates applied in the same write, evaluated for the target's requirements. */
    ownerUserId?: string | null;
    nextAction?: string | null;
    nextActionAt?: Date | null;
}): Promise<RelationshipRecord> {
    const current = await getRelationship(args.relationshipId, args.companyId);
    if (!current) throw new Error("Relationship not found");
    const agreements = await listAgreements(args.companyId, args.relationshipId);
    const ownerUserId = args.ownerUserId !== undefined ? args.ownerUserId : current.ownerUserId;
    const nextAction = args.nextAction !== undefined ? args.nextAction : current.nextAction;
    assertTransition({
        from: current.stage,
        to: args.to,
        context: { ownerUserId, nextAction, hasAgreement: agreements.length > 0 },
    });
    const db = getDb();
    const now = new Date();
    const [row] = await db
        .update(partnerRelationships)
        .set({
            stage: args.to,
            stageChangedAt: now,
            lastActivityAt: now,
            ownerUserId,
            nextAction,
            ...(args.nextActionAt !== undefined ? { nextActionAt: args.nextActionAt } : {}),
        })
        .where(
            and(
                eq(partnerRelationships.id, args.relationshipId),
                eq(partnerRelationships.companyId, args.companyId)
            )
        )
        .returning();
    if (!row) throw new Error("Relationship not found");
    await addEvent({
        companyId: args.companyId,
        relationshipId: args.relationshipId,
        type: "stage_changed",
        payload: { from: current.stage, to: args.to },
        actorUserId: args.actorUserId,
        occurredAt: now,
        touch: false,
    });
    return toRelationship(row);
}

// ─── Import ──────────────────────────────────────────────────────────────────

export async function importPartners(args: {
    companyId: bigint;
    programId: string;
    userId: string;
    rows: readonly ImportPartnerRow[];
}): Promise<{ created: number; existing: number; relationships: RelationshipRecord[] }> {
    const db = getDb();
    const { resolveOrganizations } = await import("@launchstack/tools/org-resolver");
    const resolved = resolveOrganizations(
        args.rows.map(r => ({
            name: r.name,
            domain: r.domain,
            country: r.country,
            source: "import",
        }))
    );
    const orgs = await upsertOrgs({ companyId: args.companyId, runId: null, orgs: resolved });
    const byKey = new Map(orgs.map(o => [o.resolveKey, o]));

    let created = 0;
    let existing = 0;
    const out: RelationshipRecord[] = [];
    for (const row of args.rows) {
        const key = resolveOrganizations([
            { name: row.name, domain: row.domain, country: row.country },
        ])[0]?.resolveKey;
        const org = key ? byKey.get(key) : undefined;
        if (!org) continue;
        const [inserted] = await db
            .insert(partnerRelationships)
            .values({
                id: randomUUID(),
                companyId: args.companyId,
                programId: args.programId,
                orgId: org.id,
                kind: row.kind,
                territory: row.territoryCountry
                    ? { country: row.territoryCountry.toUpperCase() }
                    : null,
                stage: row.stage,
                ownerUserId: row.ownerUserId ?? args.userId,
                source: "import",
                lastActivityAt: new Date(),
            })
            .onConflictDoNothing()
            .returning();
        if (inserted) {
            created += 1;
            const record = toRelationship(inserted);
            out.push(record);
            await addEvent({
                companyId: args.companyId,
                relationshipId: record.id,
                type: "imported",
                payload: { stage: row.stage },
                actorUserId: args.userId,
                touch: false,
            });
        } else {
            existing += 1;
        }
    }
    // Imported partners' domains join the program's exclusion list.
    const domains = orgs.map(o => o.domain).filter((d): d is string => Boolean(d));
    if (domains.length > 0) {
        const program = await getProgram(args.programId, args.companyId);
        if (program) {
            await updateProgram(args.programId, args.companyId, {
                knownPartnerDomains: mergeUnique(program.knownPartnerDomains, domains),
            });
        }
    }
    return { created, existing, relationships: out };
}

// ─── Agreements ──────────────────────────────────────────────────────────────

export async function createAgreement(args: {
    companyId: bigint;
    relationshipId: string;
    input: AgreementInput;
}): Promise<AgreementRecord> {
    const db = getDb();
    const [row] = await db
        .insert(distributionAgreements)
        .values({
            id: randomUUID(),
            companyId: args.companyId,
            relationshipId: args.relationshipId,
            territory: args.input.territory ?? null,
            exclusivity: args.input.exclusivity,
            startsOn: args.input.startsOn ?? null,
            endsOn: args.input.endsOn ?? null,
            terms: args.input.terms,
            documentId: args.input.documentId ?? null,
            renewalReminderAt: args.input.renewalReminderAt
                ? new Date(args.input.renewalReminderAt)
                : null,
        })
        .returning();
    if (!row) throw new Error("Failed to create agreement");
    return toAgreement(row);
}

export async function updateAgreement(
    id: string,
    companyId: bigint,
    input: Partial<AgreementInput>
): Promise<AgreementRecord | null> {
    const db = getDb();
    const values: Partial<InferInsertModel<typeof distributionAgreements>> = {};
    if (input.territory !== undefined) values.territory = input.territory ?? null;
    if (input.exclusivity !== undefined) values.exclusivity = input.exclusivity;
    if (input.startsOn !== undefined) values.startsOn = input.startsOn ?? null;
    if (input.endsOn !== undefined) values.endsOn = input.endsOn ?? null;
    if (input.terms !== undefined) values.terms = input.terms;
    if (input.documentId !== undefined) values.documentId = input.documentId ?? null;
    if (input.renewalReminderAt !== undefined) {
        values.renewalReminderAt = input.renewalReminderAt
            ? new Date(input.renewalReminderAt)
            : null;
    }
    const [row] = await db
        .update(distributionAgreements)
        .set(values)
        .where(
            and(eq(distributionAgreements.id, id), eq(distributionAgreements.companyId, companyId))
        )
        .returning();
    return row ? toAgreement(row) : null;
}

export async function listAgreements(
    companyId: bigint,
    relationshipId: string
): Promise<AgreementRecord[]> {
    const db = getDb();
    const rows = await db
        .select()
        .from(distributionAgreements)
        .where(
            and(
                eq(distributionAgreements.companyId, companyId),
                eq(distributionAgreements.relationshipId, relationshipId)
            )
        )
        .orderBy(desc(distributionAgreements.createdAt));
    return rows.map(toAgreement);
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export interface CoverageCell {
    country: string;
    kind: PartnerKind;
    /** contracted or active */
    covered: number;
    /** contacted … negotiating */
    inPipeline: number;
    candidates: number;
    targeted: boolean;
}

export interface DashboardData {
    programId: string;
    counts: Record<RelationshipStage, number>;
    funnel: Array<{ stage: RelationshipStage; count: number }>;
    inPipeline: number;
    stale: number;
    dueThisWeek: number;
    renewalsDue: number;
    coverage: CoverageCell[];
    coveredCells: number;
    targetedCells: number;
    medianDaysInStage: Partial<Record<RelationshipStage, number>>;
    attention: PartnerListItem[];
}

function median(values: number[]): number | undefined {
    if (values.length === 0) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export async function getDashboard(companyId: bigint, programId: string): Promise<DashboardData> {
    const db = getDb();
    const program = await getProgram(programId, companyId);
    const items = await listPartners(companyId, { programId, limit: 500, orderBy: "activity" });

    const counts = Object.fromEntries(
        STAGE_ORDER.concat(["declined", "dormant"]).map(s => [s, 0])
    ) as Record<RelationshipStage, number>;
    for (const item of items) counts[item.relationship.stage] += 1;

    const funnelStages: RelationshipStage[] = [
        "candidate",
        "contacted",
        "in_conversation",
        "qualified",
        "negotiating",
        "contracted",
        "active",
    ];
    // Cumulative funnel: a relationship at "qualified" has also passed "contacted".
    const funnel = funnelStages.map((stage, index) => ({
        stage,
        count: items.filter(item => {
            const rank = STAGE_ORDER.indexOf(item.relationship.stage);
            return rank >= 0 && rank >= STAGE_ORDER.indexOf(stage) && (index > 0 || true);
        }).length,
    }));

    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 86_400_000);
    const inPipeline = items.filter(i =>
        ["contacted", "in_conversation", "qualified", "negotiating"].includes(i.relationship.stage)
    ).length;
    const stale = items.filter(i => i.stale).length;
    const dueThisWeek = items.filter(
        i => i.relationship.nextActionAt && i.relationship.nextActionAt <= weekAhead
    ).length;

    const renewalRows = await db
        .select({ id: distributionAgreements.id })
        .from(distributionAgreements)
        .innerJoin(
            partnerRelationships,
            eq(partnerRelationships.id, distributionAgreements.relationshipId)
        )
        .where(
            and(
                eq(distributionAgreements.companyId, companyId),
                eq(partnerRelationships.programId, programId),
                isNotNull(distributionAgreements.renewalReminderAt),
                lt(distributionAgreements.renewalReminderAt, weekAhead)
            )
        );

    // Coverage: territory × kind from the program, filled from relationships.
    const cellMap = new Map<string, CoverageCell>();
    const kinds = (program?.partnerKinds ?? []);
    for (const territory of program?.targetTerritories ?? []) {
        for (const kind of kinds) {
            cellMap.set(`${territory.country}|${kind}`, {
                country: territory.country,
                kind,
                covered: 0,
                inPipeline: 0,
                candidates: 0,
                targeted: true,
            });
        }
    }
    for (const item of items) {
        const country = item.relationship.territory?.country ?? item.org.country;
        if (!country) continue;
        const key = `${country}|${item.relationship.kind}`;
        let cell = cellMap.get(key);
        if (!cell) {
            cell = {
                country,
                kind: item.relationship.kind,
                covered: 0,
                inPipeline: 0,
                candidates: 0,
                targeted: false,
            };
            cellMap.set(key, cell);
        }
        const stage = item.relationship.stage;
        if (stage === "contracted" || stage === "active") cell.covered += 1;
        else if (["contacted", "in_conversation", "qualified", "negotiating"].includes(stage))
            cell.inPipeline += 1;
        else if (stage === "candidate" || stage === "researched") cell.candidates += 1;
    }
    const coverage = [...cellMap.values()].sort(
        (a, b) => a.country.localeCompare(b.country) || a.kind.localeCompare(b.kind)
    );
    const targetedCells = coverage.filter(c => c.targeted).length;
    const coveredCells = coverage.filter(c => c.targeted && c.covered > 0).length;

    // Median days per stage, from stage_changed events (momentum, not inventory).
    const relationshipIds = items.map(i => i.relationship.id);
    const medianDaysInStage: Partial<Record<RelationshipStage, number>> = {};
    if (relationshipIds.length > 0) {
        const events = await db
            .select()
            .from(relationshipEvents)
            .where(
                and(
                    eq(relationshipEvents.companyId, companyId),
                    eq(relationshipEvents.type, "stage_changed"),
                    inArray(relationshipEvents.relationshipId, relationshipIds)
                )
            )
            .orderBy(asc(relationshipEvents.relationshipId), asc(relationshipEvents.occurredAt));
        const durations = new Map<RelationshipStage, number[]>();
        let prev: RelationshipEventRow | null = null;
        for (const event of events) {
            if (prev && prev.relationshipId === event.relationshipId) {
                const stage = (prev.payload as { to?: RelationshipStage }).to;
                if (stage) {
                    const days =
                        (event.occurredAt.getTime() - prev.occurredAt.getTime()) / 86_400_000;
                    const list = durations.get(stage) ?? [];
                    list.push(days);
                    durations.set(stage, list);
                }
            }
            prev = event;
        }
        for (const [stage, list] of durations) {
            const m = median(list);
            if (m !== undefined) medianDaysInStage[stage] = Math.round(m * 10) / 10;
        }
    }

    const attention = items
        .filter(
            i =>
                i.stale || (i.relationship.nextActionAt && i.relationship.nextActionAt <= weekAhead)
        )
        .sort((a, b) => {
            const ad = a.relationship.nextActionAt?.getTime() ?? Number.POSITIVE_INFINITY;
            const bd = b.relationship.nextActionAt?.getTime() ?? Number.POSITIVE_INFINITY;
            return ad - bd;
        })
        .slice(0, 25);

    return {
        programId,
        counts,
        funnel,
        inPipeline,
        stale,
        dueThisWeek,
        renewalsDue: renewalRows.length,
        coverage,
        coveredCells,
        targetedCells,
        medianDaysInStage,
        attention,
    };
}
