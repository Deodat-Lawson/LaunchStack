/**
 * Prospects service: loads Distribution records for a workspace and hands
 * them to the adapter. Routes stay thin; everything that touches the
 * database lives here. Tenancy is by the `companyId` on the context, never a
 * value from the request body.
 *
 * Reads are queries, not scans: every list asks the database for the page,
 * the counts and the search it needs, so a workspace with thousands of
 * companies costs the same per screen as one with ten.
 */
import { prepareEmailCampaign, type Recipient } from "@launchstack/pipelines/email";
import {
    addEvent,
    countPartnerViews,
    countPartners,
    countProgramSummaries,
    countRelationshipsByStage,
    createProgram,
    findLiveRun,
    getOrg,
    getProgram,
    getRelationship,
    isStale,
    listAgreements,
    listAgreementsForRelationships,
    listEvents,
    listEvidenceForOrg,
    listExclusions,
    listPartners,
    listPeopleRows,
    listPrograms,
    listRuns,
    listStageChangeEvents,
    requestRunStop,
    transitionStage,
    updateProgram,
    updateRelationship,
    type PartnerListFilters,
    type PartnerListItem,
} from "@launchstack/pipelines/distribution/db";
import {
    ALLOWED_TRANSITIONS,
    StageTransitionError,
} from "@launchstack/pipelines/distribution/stages";
import type {
    ProgramInput,
    ProgramPatch,
    ProgramRecord,
    RelationshipRecord,
    RelationshipStage,
    RunRecord,
    Territory,
} from "@launchstack/pipelines/distribution/types";
import { resolveComplianceProvider } from "@launchstack/tools/compliance-screen";
import { isPlaceSearchConfigured } from "@launchstack/tools/place-search";
import { isTradeDataConfigured } from "@launchstack/tools/trade-data";

import type {
    CompaniesSort,
    CompaniesView,
    CompanyDetail,
    CompanyRow,
    DealDto,
    DealRow,
    EmailStatusKind,
    HomeDto,
    NewSegmentInput,
    OutreachResult,
    PersonRow,
    RunDto,
    SalesStage,
    SegmentDto,
    SegmentSummary,
    SourceRow,
    TodoItem,
} from "~/app/employer/tools/growth/prospects/api";
import { env } from "~/env";

import {
    FIT_THRESHOLD,
    SALES_OF,
    countsFromProgram,
    latestCompleted,
    personFromRow,
    relationshipTarget,
    sourceRows,
    toCompanyDetail,
    toCompanyRow,
    toDeal,
    toRunDto,
    toSegmentSummaryWithCounts,
    toSegmentWithCounts,
    toYield,
    type RowContext,
    type SourceAvailability,
} from "./adapter";

export interface ProspectsCtx {
    companyId: bigint;
    /** Better Auth user id; owners are stored as this string. */
    userId: string;
    userPk: unknown;
}

export class ProspectsError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly extra: Record<string, unknown> = {}
    ) {
        super(message);
        this.name = "ProspectsError";
    }
}

/** Page sizes: what a screen shows before asking for more, and the ceiling. */
export const DEFAULT_PAGE = 50;
export const MAX_PAGE = 200;

export function clampPage(limit: number | undefined, offset: number | undefined) {
    return {
        limit: Math.min(Math.max(1, limit ?? DEFAULT_PAGE), MAX_PAGE),
        offset: Math.max(0, offset ?? 0),
    };
}

function nextOffset(offset: number, limit: number, total: number): number | null {
    return offset + limit < total ? offset + limit : null;
}

// ── Availability ──────────────────────────────────────────────────────────

export function availability(): SourceAvailability {
    return {
        web: Boolean(env.server.EXA_API_KEY) || Boolean(env.server.SERPER_API_KEY),
        place: isPlaceSearchConfigured(),
        trade: isTradeDataConfigured(),
        screening: resolveComplianceProvider() !== null,
    };
}

/** Keyless sources (OpenStreetMap, YC) and sample data are always on; keyed ones when configured. */
function sourcesOn(avail: SourceAvailability): number {
    return [avail.web, avail.place, avail.trade, avail.screening].filter(Boolean).length + 3;
}

// ── Segment context ───────────────────────────────────────────────────────

interface SegmentContext {
    program: ProgramRecord;
    runs: RunRecord[];
    latest: RunRecord | null;
    excludedDomains: string[];
    rowCtx: RowContext;
}

/** The program, its recent runs and its exclusion list: three small queries, no rows. */
async function segmentContext(ctx: ProspectsCtx, programId: string): Promise<SegmentContext> {
    const program = await getProgram(programId, ctx.companyId);
    if (!program) throw new ProspectsError("Segment not found", 404);
    const [runs, exclusions] = await Promise.all([
        listRuns(ctx.companyId, { programId, limit: 50 }),
        listExclusions(ctx.companyId, programId),
    ]);
    const latest = latestCompleted(runs);
    return {
        program,
        runs,
        latest,
        excludedDomains: exclusions.domains,
        rowCtx: { latestRunId: latest?.id ?? null, excludedDomains: new Set(exclusions.domains) },
    };
}

async function segmentCounts(
    ctx: ProspectsCtx,
    program: ProgramRecord
): Promise<SegmentSummary["counts"]> {
    const counts = await countProgramSummaries(ctx.companyId, [program]);
    return countsFromProgram(counts.get(program.id), sourcesOn(availability()));
}

async function loadItem(
    ctx: ProspectsCtx,
    relationshipId: string
): Promise<{ item: PartnerListItem; relationship: RelationshipRecord }> {
    const relationship = await getRelationship(relationshipId, ctx.companyId);
    if (!relationship) throw new ProspectsError("Company not found", 404);
    const org = await getOrg(relationship.orgId, ctx.companyId);
    if (!org) throw new ProspectsError("Company not found", 404);
    return {
        relationship,
        item: { relationship, org, evidenceCount: 0, stale: isStale(relationship) },
    };
}

// ── Segments ──────────────────────────────────────────────────────────────

export async function listSegments(ctx: ProspectsCtx): Promise<SegmentSummary[]> {
    const programs = (await listPrograms(ctx.companyId)).filter(p => p.status === "active");
    const counts = await countProgramSummaries(ctx.companyId, programs);
    const on = sourcesOn(availability());
    return programs.map(program =>
        toSegmentSummaryWithCounts(program, countsFromProgram(counts.get(program.id), on))
    );
}

export async function getSegment(ctx: ProspectsCtx, programId: string): Promise<SegmentDto> {
    const program = await getProgram(programId, ctx.companyId);
    if (!program) throw new ProspectsError("Segment not found", 404);
    return toSegmentWithCounts(program, await segmentCounts(ctx, program));
}

export async function createSegment(
    ctx: ProspectsCtx,
    input: NewSegmentInput
): Promise<SegmentDto> {
    const programInput: ProgramInput = {
        name: input.name,
        offering: input.offering,
        categories: input.industries,
        hsCodes: [],
        targetTerritories: input.countries.map(c => ({ country: c.toUpperCase() })),
        // Until the pipeline reframe, discovery still searches by partner kind;
        // these three are the buyer-shaped ones.
        partnerKinds: ["distributor", "retailer", "wholesaler"],
        constraints: null,
        knownPartnerDomains: [],
    };
    const program = await createProgram({
        companyId: ctx.companyId,
        userId: ctx.userId,
        input: programInput,
    });
    return toSegmentWithCounts(program, countsFromProgram(undefined, sourcesOn(availability())));
}

function parseTerritory(value: string): Territory | null {
    const [country, region] = value.split(":").map(s => s.trim());
    if (!country || country.length !== 2) return null;
    return region ? { country: country.toUpperCase(), region } : { country: country.toUpperCase() };
}

export async function patchSegment(
    ctx: ProspectsCtx,
    programId: string,
    fields: Record<string, string | string[]>
): Promise<SegmentDto> {
    const patch: ProgramPatch = {};
    for (const [key, value] of Object.entries(fields)) {
        const list = Array.isArray(value)
            ? value
            : value
                  .split(",")
                  .map(s => s.trim())
                  .filter(Boolean);
        const text = Array.isArray(value) ? value.join(", ") : value;
        switch (key) {
            case "offering":
                if (text.trim()) patch.offering = text.trim();
                break;
            case "industries":
                patch.categories = list.slice(0, 20);
                break;
            case "geographies": {
                const territories = list
                    .map(parseTerritory)
                    .filter((t): t is Territory => t !== null);
                if (territories.length === 0)
                    throw new ProspectsError(
                        "Use two-letter country codes, for example NL, DE, GB",
                        400
                    );
                patch.targetTerritories = territories;
                break;
            }
            case "disqualifiers":
                patch.constraints = text.trim() || null;
                break;
            default:
                break;
        }
    }
    const program = await updateProgram(programId, ctx.companyId, patch);
    if (!program) throw new ProspectsError("Segment not found", 404);
    return toSegmentWithCounts(program, await segmentCounts(ctx, program));
}

// ── Home ──────────────────────────────────────────────────────────────────

const IN_MOTION_STAGES: RelationshipStage[] = ["contacted", "in_conversation", "negotiating"];

function median(values: number[]): number | undefined {
    if (values.length === 0) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Median days spent in each stage, from stage_changed events: momentum, not inventory. */
async function medianDaysInStage(
    ctx: ProspectsCtx,
    programId: string
): Promise<Partial<Record<RelationshipStage, number>>> {
    const events = await listStageChangeEvents(ctx.companyId, programId);
    const durations = new Map<RelationshipStage, number[]>();
    let prev: (typeof events)[number] | null = null;
    for (const event of events) {
        if (prev && prev.relationshipId === event.relationshipId) {
            const stage = (prev.payload as { to?: RelationshipStage }).to;
            if (stage) {
                const days = (event.occurredAt.getTime() - prev.occurredAt.getTime()) / 86_400_000;
                durations.set(stage, [...(durations.get(stage) ?? []), days]);
            }
        }
        prev = event;
    }
    const out: Partial<Record<RelationshipStage, number>> = {};
    for (const [stage, list] of durations) {
        const m = median(list);
        if (m !== undefined) out[stage] = Math.round(m * 10) / 10;
    }
    return out;
}

export async function getHome(ctx: ProspectsCtx, programId: string): Promise<HomeDto> {
    const seg = await segmentContext(ctx, programId);
    const base: PartnerListFilters = {
        programId,
        excluded: false,
        excludedDomains: seg.excludedDomains,
    };
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const [counts, byStage, freshItems, dueItems, staleItems, medians] = await Promise.all([
        segmentCounts(ctx, seg.program),
        countRelationshipsByStage(ctx.companyId, programId, {
            excludedDomains: seg.excludedDomains,
        }),
        seg.latest
            ? listPartners(ctx.companyId, {
                  ...base,
                  firstSeenRunId: seg.latest.id,
                  orderBy: "fit",
                  limit: 12,
              })
            : Promise.resolve([] as PartnerListItem[]),
        listPartners(ctx.companyId, {
            ...base,
            stage: IN_MOTION_STAGES,
            dueBefore: endOfToday,
            limit: 50,
        }),
        listPartners(ctx.companyId, { ...base, staleOnly: true, orderBy: "activity", limit: 50 }),
        medianDaysInStage(ctx, programId),
    ]);

    const fresh = freshItems.map(i => toCompanyRow(i, seg.rowCtx));
    const freshHigh = fresh.filter(r => (r.fit ?? 0) >= FIT_THRESHOLD);
    // Keyless profiles rarely clear the live threshold (no brands, no known
    // signal), so a run that found companies still puts them in front of you.
    const toReview = freshHigh.length > 0 ? freshHigh : fresh;
    const todo: TodoItem[] = [];
    if (toReview.length > 0)
        todo.push({
            id: "review-new",
            title: `Review ${toReview.length} new ${freshHigh.length > 0 ? "high-fit " : ""}${toReview.length === 1 ? "company" : "companies"} from the last run`,
            detail: toReview
                .slice(0, 3)
                .map(r => r.name)
                .join(", "),
            action: { label: "Review", href: "/companies?view=new" },
        });
    if (dueItems.length > 0)
        todo.push({
            id: "due",
            title: `${dueItems.length} next ${dueItems.length === 1 ? "step is" : "steps are"} due`,
            detail: dueItems
                .map(i => `${i.org.name}: ${i.relationship.nextAction ?? "follow up"}`)
                .join(" · "),
            action: { label: "Open deals", href: "/deals" },
        });
    if (staleItems.length > 0)
        todo.push({
            id: "stale",
            title: `${staleItems.length} ${staleItems.length === 1 ? "deal has" : "deals have"} gone quiet`,
            detail: staleItems
                .map(i => `${i.org.name} for ${toCompanyRow(i, seg.rowCtx).staleDays ?? 0} days`)
                .join(" · "),
            action: { label: "Follow up", href: "/deals" },
        });

    const funnelStages: SalesStage[] = [
        "lead",
        "qualified",
        "contacted",
        "meeting",
        "proposal",
        "negotiating",
        "won",
    ];
    const salesCounts = new Map<SalesStage, number>();
    for (const [stage, n] of Object.entries(byStage) as Array<[RelationshipStage, number]>) {
        const sales = SALES_OF[stage];
        salesCounts.set(sales, (salesCounts.get(sales) ?? 0) + n);
    }
    const funnel = funnelStages.map(stage => ({ stage, count: salesCounts.get(stage) ?? 0 }));
    const medianValue = medians.contacted ?? medians.in_conversation;

    return {
        segment: toSegmentSummaryWithCounts(seg.program, counts),
        lastRunAt: seg.latest ? (seg.latest.startedAt ?? seg.latest.createdAt).toISOString() : null,
        todo,
        funnel,
        medianDays:
            medianValue !== undefined
                ? { from: "contacted", to: "meeting", days: Math.round(medianValue) }
                : null,
        yield: seg.latest?.summary
            ? seg.latest.summary.sources.map(s => toYield(s, seg.latest!.options.mode))
            : [],
        fresh: fresh.slice(0, 4),
    };
}

// ── Companies ─────────────────────────────────────────────────────────────

const SORT_OF: Record<CompaniesSort, PartnerListFilters["orderBy"]> = {
    fit: "fit",
    activity: "activity",
    name: "name",
};

function viewFilters(view: CompaniesView, seg: SegmentContext): PartnerListFilters {
    const base: PartnerListFilters = {
        programId: seg.program.id,
        excludedDomains: seg.excludedDomains,
    };
    switch (view) {
        case "all":
            return { ...base, excluded: false };
        case "new":
            // No completed run yet means nothing is "new"; an impossible id keeps the list empty.
            return { ...base, excluded: false, firstSeenRunId: seg.latest?.id ?? "__none__" };
        case "highfit":
            return { ...base, excluded: false, minFit: FIT_THRESHOLD };
        case "uncontacted":
            return { ...base, excluded: false, stage: ["candidate", "researched", "qualified"] };
        case "excluded":
            return { ...base, excluded: true };
    }
}

export async function listCompanies(
    ctx: ProspectsCtx,
    programId: string,
    params: {
        view: CompaniesView;
        q: string;
        sort: CompaniesSort;
        limit?: number;
        offset?: number;
    }
): Promise<{
    companies: CompanyRow[];
    counts: Record<CompaniesView, number>;
    total: number;
    nextOffset: number | null;
}> {
    const seg = await segmentContext(ctx, programId);
    const { limit, offset } = clampPage(params.limit, params.offset);
    const filters: PartnerListFilters = {
        ...viewFilters(params.view, seg),
        search: params.q.trim() || undefined,
        orderBy: SORT_OF[params.sort],
        limit,
        offset,
    };
    const [items, total, counts] = await Promise.all([
        listPartners(ctx.companyId, filters),
        countPartners(ctx.companyId, filters),
        countPartnerViews(ctx.companyId, programId, {
            latestRunId: seg.latest?.id ?? null,
            excludedDomains: seg.excludedDomains,
            fitThreshold: FIT_THRESHOLD,
        }),
    ]);
    return {
        companies: items.map(i => toCompanyRow(i, seg.rowCtx)),
        counts,
        total,
        nextOffset: nextOffset(offset, limit, total),
    };
}

export async function getCompany(
    ctx: ProspectsCtx,
    relationshipId: string
): Promise<CompanyDetail> {
    const { item, relationship } = await loadItem(ctx, relationshipId);
    const [evidence, events, agreements, runs, exclusions] = await Promise.all([
        listEvidenceForOrg(ctx.companyId, relationship.orgId),
        listEvents(ctx.companyId, relationship.id),
        listAgreements(ctx.companyId, relationship.id),
        listRuns(ctx.companyId, { programId: relationship.programId, limit: 50 }),
        listExclusions(ctx.companyId, relationship.programId),
    ]);
    const rowCtx: RowContext = {
        latestRunId: latestCompleted(runs)?.id ?? null,
        excludedDomains: new Set(exclusions.domains),
    };
    return toCompanyDetail(
        { ...item, evidenceCount: evidence.length },
        evidence,
        events,
        agreements.length > 0,
        ctx.userId,
        rowCtx
    );
}

/**
 * Excluding a company adds its domain to the program's exclusion list (so
 * discovery never proposes it again) and parks the deal as declined.
 * Including reverses both.
 */
export async function setExcluded(
    ctx: ProspectsCtx,
    ids: string[],
    excluded: boolean
): Promise<number> {
    let updated = 0;
    for (const id of ids) {
        const relationship = await getRelationship(id, ctx.companyId);
        if (!relationship) continue;
        const [org, program] = await Promise.all([
            getOrg(relationship.orgId, ctx.companyId),
            getProgram(relationship.programId, ctx.companyId),
        ]);
        if (!org || !program) continue;
        const domains = new Set(program.knownPartnerDomains);
        if (org.domain) {
            if (excluded) domains.add(org.domain);
            else domains.delete(org.domain);
            await updateProgram(program.id, ctx.companyId, { knownPartnerDomains: [...domains] });
        }
        const target = excluded ? "declined" : "candidate";
        if (
            relationship.stage !== target &&
            ALLOWED_TRANSITIONS[relationship.stage].includes(target)
        ) {
            await transitionStage({
                companyId: ctx.companyId,
                relationshipId: id,
                to: target,
                actorUserId: ctx.userId,
            });
        }
        await addEvent({
            companyId: ctx.companyId,
            relationshipId: id,
            type: "note",
            payload: {
                text: excluded
                    ? "Excluded from Prospects runs."
                    : "Included in Prospects runs again.",
            },
            actorUserId: ctx.userId,
            touch: false,
        });
        updated += 1;
    }
    return updated;
}

// ── Deals ─────────────────────────────────────────────────────────────────

export interface DealPatch {
    stage?: SalesStage;
    ownerName?: string | null;
    nextStep?: string | null;
    nextStepAt?: string | null;
}

export async function patchDeal(
    ctx: ProspectsCtx,
    relationshipId: string,
    patch: DealPatch
): Promise<DealDto> {
    let { relationship } = await loadItem(ctx, relationshipId);
    const ownerUserId =
        patch.ownerName === undefined
            ? undefined
            : patch.ownerName === "You"
              ? ctx.userId
              : patch.ownerName === ""
                ? null
                : patch.ownerName;
    const nextActionAt =
        patch.nextStepAt === undefined
            ? undefined
            : patch.nextStepAt === null
              ? null
              : new Date(patch.nextStepAt);
    const nextAction =
        patch.nextStep === undefined ? undefined : patch.nextStep === "" ? null : patch.nextStep;

    if (patch.stage && patch.stage !== SALES_OF[relationship.stage]) {
        const target = relationshipTarget(relationship.stage, patch.stage);
        if (!target)
            throw new ProspectsError(`Cannot move to ${patch.stage}`, 409, {
                reason:
                    patch.stage === "proposal"
                        ? "Not a stage in this workspace yet"
                        : "Not available from here",
            });
        relationship = await transitionStage({
            companyId: ctx.companyId,
            relationshipId,
            to: target,
            actorUserId: ctx.userId,
            ownerUserId,
            nextAction,
            nextActionAt,
        });
    } else {
        const fields: Parameters<typeof updateRelationship>[2] = {};
        if (ownerUserId !== undefined) fields.ownerUserId = ownerUserId;
        if (nextAction !== undefined) fields.nextAction = nextAction;
        if (nextActionAt !== undefined) fields.nextActionAt = nextActionAt;
        if (Object.keys(fields).length > 0) {
            const updated = await updateRelationship(relationshipId, ctx.companyId, fields);
            if (!updated) throw new ProspectsError("Company not found", 404);
            relationship = updated;
            if (ownerUserId) {
                await addEvent({
                    companyId: ctx.companyId,
                    relationshipId,
                    type: "owner_changed",
                    payload: { ownerUserId },
                    actorUserId: ctx.userId,
                    touch: false,
                });
            }
            if (nextAction !== undefined || nextActionAt !== undefined) {
                await addEvent({
                    companyId: ctx.companyId,
                    relationshipId,
                    type: "next_action_set",
                    payload: {
                        nextAction: relationship.nextAction,
                        nextActionAt: relationship.nextActionAt,
                    },
                    actorUserId: ctx.userId,
                    touch: false,
                });
            }
        }
    }
    const [org, agreements] = await Promise.all([
        getOrg(relationship.orgId, ctx.companyId),
        listAgreements(ctx.companyId, relationshipId),
    ]);
    if (!org) throw new ProspectsError("Company not found", 404);
    return toDeal(
        { relationship, org, evidenceCount: 0, stale: isStale(relationship) },
        agreements.length > 0,
        ctx.userId
    );
}

export async function listDeals(ctx: ProspectsCtx, programId: string): Promise<DealRow[]> {
    const seg = await segmentContext(ctx, programId);
    const items = await listPartners(ctx.companyId, {
        programId,
        excluded: false,
        excludedDomains: seg.excludedDomains,
        orderBy: "activity",
        limit: MAX_PAGE * 2,
    });
    // Only the won check needs the agreement; one query for every deal that needs it.
    const agreements = await listAgreementsForRelationships(
        ctx.companyId,
        items.filter(i => i.relationship.stage === "negotiating").map(i => i.relationship.id)
    );
    return items.map(item => ({
        ...toDeal(item, (agreements.get(item.relationship.id)?.length ?? 0) > 0, ctx.userId),
        companyName: item.org.name,
        domain: item.org.domain,
        fit: item.relationship.fitScore,
        fitThreshold: FIT_THRESHOLD,
    }));
}

// ── People ────────────────────────────────────────────────────────────────

export async function listPeople(
    ctx: ProspectsCtx,
    programId: string,
    params: { q: string; status: EmailStatusKind | null; limit?: number; offset?: number }
): Promise<{ people: PersonRow[]; total: number; nextOffset: number | null }> {
    const seg = await segmentContext(ctx, programId);
    const { limit, offset } = clampPage(params.limit, params.offset);
    // Verified and guessed mailboxes do not exist yet: people are the
    // dossiers' public mailboxes, found on a page or a shared inbox.
    if (params.status === "verified" || params.status === "guess")
        return { people: [], total: 0, nextOffset: null };
    const { rows, total } = await listPeopleRows(ctx.companyId, {
        programId,
        excludedDomains: seg.excludedDomains,
        search: params.q.trim() || undefined,
        generic: params.status === "generic" ? true : params.status === "found" ? false : undefined,
        limit,
        offset,
    });
    return {
        people: rows.map(row =>
            personFromRow(row, row.excluded ? "Company excluded: Excluded from runs" : null)
        ),
        total,
        nextOffset: nextOffset(offset, limit, total),
    };
}

// ── Outreach ──────────────────────────────────────────────────────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sameDay(a: Date, b: Date): boolean {
    return a.toDateString() === b.toDateString();
}

/**
 * One campaign in the email vertical for the selected companies; recipients
 * are the public mailboxes in each dossier. Nothing is sent from here: the
 * email vertical's approval gate owns dispatch. Same four exclusions as the
 * Distribution outreach route, plus one: a company already drafted into a
 * campaign today is not drafted again.
 */
export async function draftOutreach(
    ctx: ProspectsCtx,
    input: { personIds?: string[]; companyIds?: string[] }
): Promise<OutreachResult> {
    const relationshipIds = [
        ...new Set([
            ...(input.companyIds ?? []),
            ...(input.personIds ?? []).map(id => id.split(":")[0]!),
        ]),
    ];
    if (relationshipIds.length === 0) throw new ProspectsError("Nothing selected", 400);

    const recipients: Recipient[] = [];
    const included: string[] = [];
    const skipped: OutreachResult["skipped"] = [];
    let program: ProgramRecord | null = null;
    let excludedDomains = new Set<string>();
    const today = new Date();

    for (const relationshipId of relationshipIds) {
        const relationship = await getRelationship(relationshipId, ctx.companyId);
        if (!relationship) {
            skipped.push({ personId: relationshipId, reason: "Not found" });
            continue;
        }
        if (!program) {
            program = await getProgram(relationship.programId, ctx.companyId);
            if (!program) throw new ProspectsError("Segment not found", 404);
            excludedDomains = new Set((await listExclusions(ctx.companyId, program.id)).domains);
        }
        if (relationship.programId !== program.id) {
            skipped.push({ personId: relationshipId, reason: "In another segment" });
            continue;
        }
        if (["contracted", "active", "declined"].includes(relationship.stage)) {
            skipped.push({
                personId: relationshipId,
                reason: `Deal is ${SALES_OF[relationship.stage]}`,
            });
            continue;
        }
        const org = await getOrg(relationship.orgId, ctx.companyId);
        if (!org) {
            skipped.push({ personId: relationshipId, reason: "Company missing" });
            continue;
        }
        if (org.domain && excludedDomains.has(org.domain)) {
            skipped.push({ personId: relationshipId, reason: `${org.name} is excluded` });
            continue;
        }
        const events = await listEvents(ctx.companyId, relationship.id);
        const draftedToday = events.some(
            e =>
                e.type === "note" &&
                typeof e.payload.campaignId !== "undefined" &&
                sameDay(e.occurredAt, today)
        );
        if (draftedToday) {
            skipped.push({
                personId: relationshipId,
                reason: `${org.name} is already in today's campaign`,
            });
            continue;
        }
        const emails = (relationship.dossier?.contactChannels ?? [])
            .map(c => c.value.trim())
            .filter(v => EMAIL.test(v))
            .filter(
                v =>
                    !org.domain ||
                    v.toLowerCase().endsWith(`@${org.domain}`) ||
                    /^(info|sales|hello|contact|office|purchasing|einkauf|import)@/i.test(v)
            );
        if (emails.length === 0) {
            skipped.push({
                personId: relationshipId,
                reason: `${org.name}: no public mailbox in the profile`,
            });
            continue;
        }
        recipients.push({
            email: emails[0]!,
            name: null,
            company: org.name,
            contextNotes: relationship.dossier?.summary ?? null,
            vars: {
                partner_kind: relationship.kind,
                territory: relationship.territory?.country ?? "",
            },
        });
        included.push(relationshipId);
    }
    if (!program || recipients.length === 0)
        throw new ProspectsError("None of the selected companies can be contacted yet", 409, {
            skipped,
        });

    const prepared = await prepareEmailCampaign({
        companyId: Number(ctx.companyId),
        name: `Prospects outreach — ${program.name} — ${new Date().toISOString().slice(0, 10)}`,
        goal: `Introduce ${program.offering.slice(0, 200)} and ask for a first conversation.`,
        recipients,
        actorUserId: Number.isFinite(Number(ctx.userPk)) ? Number(ctx.userPk) : null,
    });
    for (const relationshipId of included) {
        await addEvent({
            companyId: ctx.companyId,
            relationshipId,
            type: "note",
            payload: {
                text: `Outreach campaign #${prepared.campaign.id} drafted (awaiting approval in Email).`,
                campaignId: prepared.campaign.id,
            },
            actorUserId: ctx.userId,
            ref: String(prepared.campaign.id),
        });
    }
    return { campaignId: String(prepared.campaign.id), people: included.length, skipped };
}

// ── Runs and sources ──────────────────────────────────────────────────────

export async function listRunDtos(ctx: ProspectsCtx, programId: string): Promise<RunDto[]> {
    const runs = await listRuns(ctx.companyId, { programId, limit: 50 });
    return runs.map(toRunDto);
}

/** The run in flight for this segment, if any. */
export async function getActiveRun(ctx: ProspectsCtx, programId: string): Promise<RunDto | null> {
    const run = await findLiveRun(ctx.companyId, programId);
    return run ? toRunDto(run) : null;
}

/**
 * Ask a run to stop. The worker checks the flag before every company, so
 * the one in progress finishes and nothing after it starts.
 */
export async function stopRun(ctx: ProspectsCtx, runId: string): Promise<RunDto> {
    const run = await requestRunStop(runId, ctx.companyId);
    if (!run) throw new ProspectsError("No run in progress", 409);
    return toRunDto(run);
}

export async function listSources(ctx: ProspectsCtx, programId: string): Promise<SourceRow[]> {
    const runs = await listRuns(ctx.companyId, { programId, limit: 50 });
    return sourceRows(availability(), latestCompleted(runs));
}

export { StageTransitionError };
