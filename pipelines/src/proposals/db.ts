/**
 * Persistence for the grants vertical. Every read and write is scoped by
 * company_id; nothing here accepts a tenant from a model or a URL — the
 * route resolves the workspace and the run carries what the route resolved.
 */
import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@launchstack/store/client";

import {
    proposalApplications,
    proposalLibraryItems,
    proposalOpportunities,
    proposalProfiles,
    proposalRuns,
    proposalSections,
    type ProposalApplicationRow,
    type ProposalLibraryItemRow,
    type ProposalOpportunityRow,
    type ProposalProfileRow,
    type ProposalRunRow,
    type ProposalSectionRow,
} from "./schema";
import type {
    ApplicationRecord,
    ApplicationStatus,
    DraftMeta,
    Evidence,
    ExtractedRequest,
    ExtractedSection,
    Fit,
    LibraryItemRecord,
    OpportunityRecord,
    OpportunityStatus,
    OrgProfile,
    ProfileRecord,
    ProfileStatus,
    Requirement,
    Review,
    RunInput,
    RunKind,
    RunRecord,
    RunStatus,
    RunStep,
    RunSummary,
    SectionRecord,
    SectionStatus,
} from "./types";

// ─── Mappers ─────────────────────────────────────────────────────────────────

function toProfile(row: ProposalProfileRow): ProfileRecord {
    return {
        id: row.id,
        companyId: row.companyId,
        status: row.status,
        profile: row.profile ?? null,
        error: row.error ?? null,
        builtAt: row.builtAt ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt ?? null,
    };
}

function toOpportunity(row: ProposalOpportunityRow): OpportunityRecord {
    return {
        id: row.id,
        companyId: row.companyId,
        source: row.source,
        externalId: row.externalId,
        title: row.title,
        funder: row.funder,
        url: row.url ?? null,
        summary: row.summary ?? null,
        opensOn: row.opensOn ?? null,
        closesOn: row.closesOn ?? null,
        status: row.status,
        amountMin: row.amountMin ?? null,
        amountMax: row.amountMax ?? null,
        eligibility: row.eligibility ?? null,
        categories: row.categories ?? [],
        fit: row.fit ?? null,
        runId: row.runId ?? null,
        createdByUserId: row.createdByUserId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt ?? null,
    };
}

function toApplication(row: ProposalApplicationRow): ApplicationRecord {
    return {
        id: row.id,
        companyId: row.companyId,
        opportunityId: row.opportunityId ?? null,
        title: row.title,
        funder: row.funder ?? null,
        status: row.status,
        deadline: row.deadline ?? null,
        ownerUserId: row.ownerUserId ?? null,
        requestText: row.requestText ?? null,
        requestUrl: row.requestUrl ?? null,
        requestDocumentId: row.requestDocumentId ?? null,
        extracted: row.extracted ?? null,
        requirements: row.requirements ?? [],
        review: row.review ?? null,
        readiness: row.readiness,
        notes: row.notes ?? null,
        exportedDocumentId: row.exportedDocumentId ?? null,
        submittedAt: row.submittedAt ?? null,
        createdByUserId: row.createdByUserId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt ?? null,
    };
}

function toSection(row: ProposalSectionRow): SectionRecord {
    return {
        id: row.id,
        companyId: row.companyId,
        applicationId: row.applicationId,
        position: row.position,
        key: row.key,
        question: row.question,
        guidance: row.guidance ?? null,
        wordLimit: row.wordLimit ?? null,
        required: row.required,
        status: row.status,
        draft: row.draft ?? null,
        draftMeta: row.draftMeta ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt ?? null,
    };
}

function toLibraryItem(row: ProposalLibraryItemRow): LibraryItemRecord {
    return {
        id: row.id,
        companyId: row.companyId,
        question: row.question,
        answer: row.answer,
        tags: row.tags ?? [],
        evidence: row.evidence ?? [],
        sourceApplicationId: row.sourceApplicationId ?? null,
        sourceSectionKey: row.sourceSectionKey ?? null,
        uses: row.uses,
        createdByUserId: row.createdByUserId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt ?? null,
    };
}

function toRun(row: ProposalRunRow): RunRecord {
    return {
        id: row.id,
        companyId: row.companyId,
        kind: row.kind,
        status: row.status,
        applicationId: row.applicationId ?? null,
        userId: row.userId,
        input: row.input ?? {},
        steps: row.steps ?? [],
        summary: row.summary ?? null,
        error: row.error ?? null,
        creditsUsed: row.creditsUsed,
        createdAt: row.createdAt,
        startedAt: row.startedAt ?? null,
        completedAt: row.completedAt ?? null,
        updatedAt: row.updatedAt ?? null,
    };
}

const newId = () => randomUUID();

// ─── Profile ─────────────────────────────────────────────────────────────────

export async function getProfile(companyId: bigint): Promise<ProfileRecord | null> {
    const [row] = await getDb()
        .select()
        .from(proposalProfiles)
        .where(eq(proposalProfiles.companyId, companyId))
        .limit(1);
    return row ? toProfile(row) : null;
}

/** The workspace's profile row, created empty on first touch. */
export async function ensureProfile(companyId: bigint): Promise<ProfileRecord> {
    const existing = await getProfile(companyId);
    if (existing) return existing;
    const db = getDb();
    await db
        .insert(proposalProfiles)
        .values({ id: newId(), companyId, status: "empty" })
        .onConflictDoNothing({ target: proposalProfiles.companyId });
    const created = await getProfile(companyId);
    if (!created) throw new Error("Could not create the grant profile row");
    return created;
}

export async function setProfileStatus(
    companyId: bigint,
    status: ProfileStatus,
    error: string | null = null
): Promise<void> {
    await ensureProfile(companyId);
    await getDb()
        .update(proposalProfiles)
        .set({ status, error })
        .where(eq(proposalProfiles.companyId, companyId));
}

export async function saveProfile(companyId: bigint, profile: OrgProfile): Promise<ProfileRecord> {
    await ensureProfile(companyId);
    await getDb()
        .update(proposalProfiles)
        .set({ status: "ready", profile, error: null, builtAt: new Date(profile.builtAt) })
        .where(eq(proposalProfiles.companyId, companyId));
    const saved = await getProfile(companyId);
    if (!saved) throw new Error("Profile vanished while saving");
    return saved;
}

/** A person's edit to one fact; a new key appends, an empty value removes. */
export async function patchProfileFact(
    companyId: bigint,
    fact: { key: string; label?: string; value: string }
): Promise<ProfileRecord | null> {
    const current = await getProfile(companyId);
    if (!current?.profile) return current;
    const facts = current.profile.facts.filter(f => f.key !== fact.key);
    if (fact.value.trim().length > 0) {
        const previous = current.profile.facts.find(f => f.key === fact.key);
        facts.push({
            key: fact.key,
            label: fact.label ?? previous?.label ?? fact.key,
            value: fact.value.trim(),
            cites: [],
            source: "manual",
        });
    }
    const profile: OrgProfile = { ...current.profile, facts };
    await getDb()
        .update(proposalProfiles)
        .set({ profile })
        .where(eq(proposalProfiles.companyId, companyId));
    return getProfile(companyId);
}

// ─── Opportunities ───────────────────────────────────────────────────────────

export interface UpsertOpportunityInput {
    companyId: bigint;
    source: OpportunityRecord["source"];
    externalId: string;
    title: string;
    funder: string;
    url: string | null;
    summary: string | null;
    opensOn: string | null;
    closesOn: string | null;
    amountMin: number | null;
    amountMax: number | null;
    eligibility: string | null;
    categories: string[];
    fit: Fit | null;
    runId: string | null;
    createdByUserId: string;
}

/**
 * Insert or refresh a found opportunity. A dismissed one stays dismissed and
 * a saved one stays saved: a new run refreshes what the funder says, never a
 * person's decision about it.
 */
export async function upsertOpportunity(input: UpsertOpportunityInput): Promise<OpportunityRecord> {
    const db = getDb();
    const id = newId();
    await db
        .insert(proposalOpportunities)
        .values({
            id,
            companyId: input.companyId,
            source: input.source,
            externalId: input.externalId.slice(0, 1024),
            title: input.title.slice(0, 512),
            funder: input.funder.slice(0, 256),
            url: input.url,
            summary: input.summary,
            opensOn: input.opensOn,
            closesOn: input.closesOn,
            status: "candidate",
            amountMin: input.amountMin,
            amountMax: input.amountMax,
            eligibility: input.eligibility,
            categories: input.categories,
            fit: input.fit,
            runId: input.runId,
            createdByUserId: input.createdByUserId,
        })
        .onConflictDoUpdate({
            target: [
                proposalOpportunities.companyId,
                proposalOpportunities.source,
                proposalOpportunities.externalId,
            ],
            set: {
                title: input.title.slice(0, 512),
                funder: input.funder.slice(0, 256),
                url: input.url,
                summary: input.summary,
                opensOn: input.opensOn,
                closesOn: input.closesOn,
                amountMin: input.amountMin,
                amountMax: input.amountMax,
                eligibility: input.eligibility,
                categories: input.categories,
                fit: input.fit,
                runId: input.runId,
                updatedAt: new Date(),
            },
        });
    const [row] = await db
        .select()
        .from(proposalOpportunities)
        .where(
            and(
                eq(proposalOpportunities.companyId, input.companyId),
                eq(proposalOpportunities.source, input.source),
                eq(proposalOpportunities.externalId, input.externalId.slice(0, 1024))
            )
        )
        .limit(1);
    if (!row) throw new Error("Opportunity vanished after upsert");
    return toOpportunity(row);
}

export async function createManualOpportunity(input: {
    companyId: bigint;
    title: string;
    funder: string;
    url: string | null;
    summary: string | null;
    closesOn: string | null;
    amountMin: number | null;
    amountMax: number | null;
    createdByUserId: string;
}): Promise<OpportunityRecord> {
    const record = await upsertOpportunity({
        companyId: input.companyId,
        source: "manual",
        externalId: `manual:${newId()}`,
        title: input.title,
        funder: input.funder,
        url: input.url,
        summary: input.summary,
        opensOn: null,
        closesOn: input.closesOn,
        amountMin: input.amountMin,
        amountMax: input.amountMax,
        eligibility: null,
        categories: [],
        fit: null,
        runId: null,
        createdByUserId: input.createdByUserId,
    });
    await setOpportunityStatus(input.companyId, record.id, "saved");
    return (await getOpportunity(record.id, input.companyId)) ?? record;
}

export async function getOpportunity(
    id: string,
    companyId: bigint
): Promise<OpportunityRecord | null> {
    const [row] = await getDb()
        .select()
        .from(proposalOpportunities)
        .where(
            and(eq(proposalOpportunities.id, id), eq(proposalOpportunities.companyId, companyId))
        )
        .limit(1);
    return row ? toOpportunity(row) : null;
}

export async function listOpportunities(
    companyId: bigint,
    options: { statuses?: OpportunityStatus[]; limit?: number } = {}
): Promise<OpportunityRecord[]> {
    const where = options.statuses?.length
        ? and(
              eq(proposalOpportunities.companyId, companyId),
              inArray(proposalOpportunities.status, options.statuses)
          )
        : eq(proposalOpportunities.companyId, companyId);
    const rows = await getDb()
        .select()
        .from(proposalOpportunities)
        .where(where)
        .orderBy(desc(proposalOpportunities.updatedAt), desc(proposalOpportunities.createdAt))
        .limit(options.limit ?? 200);
    return rows.map(toOpportunity);
}

export async function setOpportunityStatus(
    companyId: bigint,
    id: string,
    status: OpportunityStatus
): Promise<OpportunityRecord | null> {
    await getDb()
        .update(proposalOpportunities)
        .set({ status })
        .where(
            and(eq(proposalOpportunities.id, id), eq(proposalOpportunities.companyId, companyId))
        );
    return getOpportunity(id, companyId);
}

export async function deleteOpportunity(companyId: bigint, id: string): Promise<boolean> {
    const deleted = await getDb()
        .delete(proposalOpportunities)
        .where(
            and(eq(proposalOpportunities.id, id), eq(proposalOpportunities.companyId, companyId))
        )
        .returning({ id: proposalOpportunities.id });
    return deleted.length > 0;
}

// ─── Applications ────────────────────────────────────────────────────────────

export interface CreateApplicationInput {
    companyId: bigint;
    createdByUserId: string;
    title: string;
    funder: string | null;
    opportunityId: string | null;
    deadline: string | null;
    requestText: string | null;
    requestUrl: string | null;
    requestDocumentId: number | null;
}

export async function createApplication(input: CreateApplicationInput): Promise<ApplicationRecord> {
    const db = getDb();
    const id = newId();
    await db.insert(proposalApplications).values({
        id,
        companyId: input.companyId,
        opportunityId: input.opportunityId,
        title: input.title.slice(0, 512),
        funder: input.funder?.slice(0, 256) ?? null,
        status: "draft",
        deadline: input.deadline,
        ownerUserId: input.createdByUserId,
        requestText: input.requestText,
        requestUrl: input.requestUrl,
        requestDocumentId: input.requestDocumentId,
        requirements: [],
        readiness: 0,
        createdByUserId: input.createdByUserId,
    });
    const created = await getApplication(id, input.companyId);
    if (!created) throw new Error("Application vanished after insert");
    return created;
}

export async function getApplication(
    id: string,
    companyId: bigint
): Promise<ApplicationRecord | null> {
    const [row] = await getDb()
        .select()
        .from(proposalApplications)
        .where(and(eq(proposalApplications.id, id), eq(proposalApplications.companyId, companyId)))
        .limit(1);
    return row ? toApplication(row) : null;
}

export async function listApplications(
    companyId: bigint,
    options: { limit?: number } = {}
): Promise<ApplicationRecord[]> {
    const rows = await getDb()
        .select()
        .from(proposalApplications)
        .where(eq(proposalApplications.companyId, companyId))
        .orderBy(desc(proposalApplications.updatedAt), desc(proposalApplications.createdAt))
        .limit(options.limit ?? 200);
    return rows.map(toApplication);
}

export interface ApplicationPatch {
    title?: string;
    funder?: string | null;
    status?: ApplicationStatus;
    deadline?: string | null;
    ownerUserId?: string | null;
    notes?: string | null;
    requestText?: string | null;
    requestUrl?: string | null;
    requestDocumentId?: number | null;
    extracted?: ExtractedRequest | null;
    requirements?: Requirement[];
    review?: Review | null;
    readiness?: number;
    exportedDocumentId?: number | null;
    submittedAt?: Date | null;
    opportunityId?: string | null;
}

export async function updateApplication(
    companyId: bigint,
    id: string,
    patch: ApplicationPatch
): Promise<ApplicationRecord | null> {
    const set: Partial<typeof proposalApplications.$inferInsert> = {};
    if (patch.title !== undefined) set.title = patch.title.slice(0, 512);
    if (patch.funder !== undefined) set.funder = patch.funder?.slice(0, 256) ?? null;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.deadline !== undefined) set.deadline = patch.deadline;
    if (patch.ownerUserId !== undefined) set.ownerUserId = patch.ownerUserId;
    if (patch.notes !== undefined) set.notes = patch.notes;
    if (patch.requestText !== undefined) set.requestText = patch.requestText;
    if (patch.requestUrl !== undefined) set.requestUrl = patch.requestUrl;
    if (patch.requestDocumentId !== undefined) set.requestDocumentId = patch.requestDocumentId;
    if (patch.extracted !== undefined) set.extracted = patch.extracted;
    if (patch.requirements !== undefined) set.requirements = patch.requirements;
    if (patch.review !== undefined) set.review = patch.review;
    if (patch.readiness !== undefined) set.readiness = patch.readiness;
    if (patch.exportedDocumentId !== undefined) set.exportedDocumentId = patch.exportedDocumentId;
    if (patch.submittedAt !== undefined) set.submittedAt = patch.submittedAt;
    if (patch.opportunityId !== undefined) set.opportunityId = patch.opportunityId;
    if (Object.keys(set).length > 0) {
        set.updatedAt = new Date();
        await getDb()
            .update(proposalApplications)
            .set(set)
            .where(
                and(eq(proposalApplications.id, id), eq(proposalApplications.companyId, companyId))
            );
    }
    return getApplication(id, companyId);
}

export async function deleteApplication(companyId: bigint, id: string): Promise<boolean> {
    const deleted = await getDb()
        .delete(proposalApplications)
        .where(and(eq(proposalApplications.id, id), eq(proposalApplications.companyId, companyId)))
        .returning({ id: proposalApplications.id });
    return deleted.length > 0;
}

// ─── Sections ────────────────────────────────────────────────────────────────

export async function listSections(
    companyId: bigint,
    applicationId: string
): Promise<SectionRecord[]> {
    const rows = await getDb()
        .select()
        .from(proposalSections)
        .where(
            and(
                eq(proposalSections.companyId, companyId),
                eq(proposalSections.applicationId, applicationId)
            )
        )
        .orderBy(asc(proposalSections.position));
    return rows.map(toSection);
}

export async function getSection(companyId: bigint, id: string): Promise<SectionRecord | null> {
    const [row] = await getDb()
        .select()
        .from(proposalSections)
        .where(and(eq(proposalSections.id, id), eq(proposalSections.companyId, companyId)))
        .limit(1);
    return row ? toSection(row) : null;
}

/**
 * Replace an application's sections with a freshly extracted set. A section
 * whose key already exists keeps its draft and status, so re-extracting a
 * request never throws away written work; sections no longer in the request
 * are removed.
 */
export async function replaceSections(
    companyId: bigint,
    applicationId: string,
    sections: ExtractedSection[]
): Promise<SectionRecord[]> {
    const db = getDb();
    const existing = await listSections(companyId, applicationId);
    const byKey = new Map(existing.map(s => [s.key, s]));
    const keep = new Set(sections.map(s => s.key));
    const gone = existing.filter(s => !keep.has(s.key)).map(s => s.id);
    if (gone.length > 0)
        await db.delete(proposalSections).where(inArray(proposalSections.id, gone));
    for (const [position, section] of sections.entries()) {
        const current = byKey.get(section.key);
        if (current) {
            await db
                .update(proposalSections)
                .set({
                    position,
                    question: section.question,
                    guidance: section.guidance,
                    wordLimit: section.wordLimit,
                    required: section.required,
                    updatedAt: new Date(),
                })
                .where(eq(proposalSections.id, current.id));
        } else {
            await db.insert(proposalSections).values({
                id: newId(),
                companyId,
                applicationId,
                position,
                key: section.key,
                question: section.question,
                guidance: section.guidance,
                wordLimit: section.wordLimit,
                required: section.required,
                status: "empty",
            });
        }
    }
    return listSections(companyId, applicationId);
}

export interface SectionPatch {
    draft?: string | null;
    status?: SectionStatus;
    draftMeta?: DraftMeta | null;
    question?: string;
    guidance?: string | null;
    wordLimit?: number | null;
    required?: boolean;
}

export async function updateSection(
    companyId: bigint,
    id: string,
    patch: SectionPatch
): Promise<SectionRecord | null> {
    const set: Partial<typeof proposalSections.$inferInsert> = {};
    if (patch.draft !== undefined) set.draft = patch.draft;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.draftMeta !== undefined) set.draftMeta = patch.draftMeta;
    if (patch.question !== undefined) set.question = patch.question;
    if (patch.guidance !== undefined) set.guidance = patch.guidance;
    if (patch.wordLimit !== undefined) set.wordLimit = patch.wordLimit;
    if (patch.required !== undefined) set.required = patch.required;
    if (Object.keys(set).length > 0) {
        set.updatedAt = new Date();
        await getDb()
            .update(proposalSections)
            .set(set)
            .where(and(eq(proposalSections.id, id), eq(proposalSections.companyId, companyId)));
    }
    return getSection(companyId, id);
}

/** Append a section a person adds by hand, after the extracted ones. */
export async function addSection(
    companyId: bigint,
    applicationId: string,
    section: ExtractedSection
): Promise<SectionRecord> {
    const existing = await listSections(companyId, applicationId);
    const id = newId();
    await getDb().insert(proposalSections).values({
        id,
        companyId,
        applicationId,
        position: existing.length,
        key: section.key,
        question: section.question,
        guidance: section.guidance,
        wordLimit: section.wordLimit,
        required: section.required,
        status: "empty",
    });
    const created = await getSection(companyId, id);
    if (!created) throw new Error("Section vanished after insert");
    return created;
}

export async function deleteSection(companyId: bigint, id: string): Promise<boolean> {
    const deleted = await getDb()
        .delete(proposalSections)
        .where(and(eq(proposalSections.id, id), eq(proposalSections.companyId, companyId)))
        .returning({ id: proposalSections.id });
    return deleted.length > 0;
}

// ─── Library ─────────────────────────────────────────────────────────────────

export async function listLibraryItems(
    companyId: bigint,
    options: { limit?: number } = {}
): Promise<LibraryItemRecord[]> {
    const rows = await getDb()
        .select()
        .from(proposalLibraryItems)
        .where(eq(proposalLibraryItems.companyId, companyId))
        .orderBy(desc(proposalLibraryItems.updatedAt), desc(proposalLibraryItems.createdAt))
        .limit(options.limit ?? 500);
    return rows.map(toLibraryItem);
}

export async function getLibraryItem(
    companyId: bigint,
    id: string
): Promise<LibraryItemRecord | null> {
    const [row] = await getDb()
        .select()
        .from(proposalLibraryItems)
        .where(and(eq(proposalLibraryItems.id, id), eq(proposalLibraryItems.companyId, companyId)))
        .limit(1);
    return row ? toLibraryItem(row) : null;
}

export async function createLibraryItem(input: {
    companyId: bigint;
    createdByUserId: string;
    question: string;
    answer: string;
    tags: string[];
    evidence: Evidence[];
    sourceApplicationId: string | null;
    sourceSectionKey: string | null;
}): Promise<LibraryItemRecord> {
    const id = newId();
    await getDb().insert(proposalLibraryItems).values({
        id,
        companyId: input.companyId,
        question: input.question,
        answer: input.answer,
        tags: input.tags,
        evidence: input.evidence,
        sourceApplicationId: input.sourceApplicationId,
        sourceSectionKey: input.sourceSectionKey,
        uses: 0,
        createdByUserId: input.createdByUserId,
    });
    const created = await getLibraryItem(input.companyId, id);
    if (!created) throw new Error("Library item vanished after insert");
    return created;
}

export async function updateLibraryItem(
    companyId: bigint,
    id: string,
    patch: { question?: string; answer?: string; tags?: string[] }
): Promise<LibraryItemRecord | null> {
    const set: Partial<typeof proposalLibraryItems.$inferInsert> = {};
    if (patch.question !== undefined) set.question = patch.question;
    if (patch.answer !== undefined) set.answer = patch.answer;
    if (patch.tags !== undefined) set.tags = patch.tags;
    if (Object.keys(set).length > 0) {
        set.updatedAt = new Date();
        await getDb()
            .update(proposalLibraryItems)
            .set(set)
            .where(
                and(eq(proposalLibraryItems.id, id), eq(proposalLibraryItems.companyId, companyId))
            );
    }
    return getLibraryItem(companyId, id);
}

export async function deleteLibraryItem(companyId: bigint, id: string): Promise<boolean> {
    const deleted = await getDb()
        .delete(proposalLibraryItems)
        .where(and(eq(proposalLibraryItems.id, id), eq(proposalLibraryItems.companyId, companyId)))
        .returning({ id: proposalLibraryItems.id });
    return deleted.length > 0;
}

/** A draft reused these items; count it so the library can show what earns its keep. */
export async function noteLibraryUses(companyId: bigint, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await getDb()
        .update(proposalLibraryItems)
        .set({ uses: sql`${proposalLibraryItems.uses} + 1` })
        .where(
            and(
                eq(proposalLibraryItems.companyId, companyId),
                inArray(proposalLibraryItems.id, ids)
            )
        );
}

// ─── Runs ────────────────────────────────────────────────────────────────────

export async function createRun(input: {
    companyId: bigint;
    userId: string;
    kind: RunKind;
    applicationId: string | null;
    input: RunInput;
    steps: RunStep[];
}): Promise<RunRecord> {
    const id = newId();
    await getDb().insert(proposalRuns).values({
        id,
        companyId: input.companyId,
        kind: input.kind,
        status: "queued",
        applicationId: input.applicationId,
        userId: input.userId,
        input: input.input,
        steps: input.steps,
        creditsUsed: 0,
    });
    const created = await getRun(id, input.companyId);
    if (!created) throw new Error("Run vanished after insert");
    return created;
}

export async function getRun(id: string, companyId: bigint): Promise<RunRecord | null> {
    const [row] = await getDb()
        .select()
        .from(proposalRuns)
        .where(and(eq(proposalRuns.id, id), eq(proposalRuns.companyId, companyId)))
        .limit(1);
    return row ? toRun(row) : null;
}

export async function listRuns(
    companyId: bigint,
    options: { applicationId?: string; limit?: number } = {}
): Promise<RunRecord[]> {
    const where = options.applicationId
        ? and(
              eq(proposalRuns.companyId, companyId),
              eq(proposalRuns.applicationId, options.applicationId)
          )
        : eq(proposalRuns.companyId, companyId);
    const rows = await getDb()
        .select()
        .from(proposalRuns)
        .where(where)
        .orderBy(desc(proposalRuns.createdAt))
        .limit(options.limit ?? 50);
    return rows.map(toRun);
}

/** The run in progress, if any: one at a time per workspace keeps the credits story simple. */
export async function findLiveRun(companyId: bigint): Promise<RunRecord | null> {
    const [row] = await getDb()
        .select()
        .from(proposalRuns)
        .where(
            and(
                eq(proposalRuns.companyId, companyId),
                inArray(proposalRuns.status, ["queued", "running"])
            )
        )
        .orderBy(desc(proposalRuns.createdAt))
        .limit(1);
    return row ? toRun(row) : null;
}

export async function updateRun(
    companyId: bigint,
    id: string,
    patch: {
        status?: RunStatus;
        steps?: RunStep[];
        summary?: RunSummary | null;
        error?: string | null;
        creditsUsed?: number;
        startedAt?: Date;
        completedAt?: Date | null;
    }
): Promise<RunRecord | null> {
    const set: Partial<typeof proposalRuns.$inferInsert> = { updatedAt: new Date() };
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.steps !== undefined) set.steps = patch.steps;
    if (patch.summary !== undefined) set.summary = patch.summary;
    if (patch.error !== undefined) set.error = patch.error;
    if (patch.creditsUsed !== undefined) set.creditsUsed = patch.creditsUsed;
    if (patch.startedAt !== undefined) set.startedAt = patch.startedAt;
    if (patch.completedAt !== undefined) set.completedAt = patch.completedAt;
    await getDb()
        .update(proposalRuns)
        .set(set)
        .where(and(eq(proposalRuns.id, id), eq(proposalRuns.companyId, companyId)));
    return getRun(id, companyId);
}

export async function deleteRun(companyId: bigint, id: string): Promise<boolean> {
    const deleted = await getDb()
        .delete(proposalRuns)
        .where(and(eq(proposalRuns.id, id), eq(proposalRuns.companyId, companyId)))
        .returning({ id: proposalRuns.id });
    return deleted.length > 0;
}
