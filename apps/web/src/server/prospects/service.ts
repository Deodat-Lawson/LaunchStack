/**
 * Prospects service: loads Distribution records for a workspace and hands
 * them to the adapter. Routes stay thin; everything that touches the
 * database lives here. Tenancy is by the `companyId` on the context, never a
 * value from the request body.
 */
import { prepareEmailCampaign, type Recipient } from "@launchstack/pipelines/email";
import {
    addEvent,
    createProgram,
    getDashboard,
    getOrg,
    getProgram,
    getRelationship,
    isStale,
    listAgreements,
    listEvents,
    listEvidenceForOrg,
    listExclusions,
    listPartners,
    listPrograms,
    listRuns,
    transitionStage,
    updateProgram,
    updateRelationship,
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
} from "~/app/employer/tools/prospects/api";
import { env } from "~/env";

import {
    FIT_THRESHOLD,
    SALES_OF,
    contactPeople,
    inMotion,
    latestCompleted,
    relationshipTarget,
    searchMatches,
    sortRows,
    sourceRows,
    toCompanyDetail,
    toCompanyRow,
    toDeal,
    toRunDto,
    toSegment,
    toSegmentSummary,
    toYield,
    viewMatches,
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

// ── Availability ──────────────────────────────────────────────────────────

export function availability(): SourceAvailability {
    return {
        web: Boolean(env.server.EXA_API_KEY) || Boolean(env.server.SERPER_API_KEY),
        place: isPlaceSearchConfigured(),
        trade: isTradeDataConfigured(),
        screening: resolveComplianceProvider() !== null,
    };
}

function sourcesOn(avail: SourceAvailability): number {
    return [avail.web, avail.place, avail.trade, avail.screening].filter(Boolean).length + 1;
}

// ── Loading ───────────────────────────────────────────────────────────────

interface SegmentData {
    program: ProgramRecord;
    items: PartnerListItem[];
    runs: RunRecord[];
    latest: RunRecord | null;
    rowCtx: RowContext;
    rows: CompanyRow[];
}

async function loadSegment(ctx: ProspectsCtx, programId: string): Promise<SegmentData> {
    const program = await getProgram(programId, ctx.companyId);
    if (!program) throw new ProspectsError("Segment not found", 404);
    const [items, runs, exclusions] = await Promise.all([
        listPartners(ctx.companyId, { programId, limit: 500, orderBy: "fit" }),
        listRuns(ctx.companyId, { programId, limit: 50 }),
        listExclusions(ctx.companyId, programId),
    ]);
    const latest = latestCompleted(runs);
    const rowCtx: RowContext = {
        latestRunId: latest?.id ?? null,
        excludedDomains: new Set(exclusions.domains),
    };
    return { program, items, runs, latest, rowCtx, rows: items.map(i => toCompanyRow(i, rowCtx)) };
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
    const programs = await listPrograms(ctx.companyId);
    const on = sourcesOn(availability());
    const out: SegmentSummary[] = [];
    for (const program of programs.filter(p => p.status === "active")) {
        const data = await loadSegment(ctx, program.id);
        out.push(toSegmentSummary(program, data.rows, on));
    }
    return out;
}

export async function getSegment(ctx: ProspectsCtx, programId: string): Promise<SegmentDto> {
    const data = await loadSegment(ctx, programId);
    return toSegment(data.program, data.rows, sourcesOn(availability()));
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
    return toSegment(program, [], sourcesOn(availability()));
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
    const data = await loadSegment(ctx, programId);
    return toSegment(data.program, data.rows, sourcesOn(availability()));
}

// ── Home ──────────────────────────────────────────────────────────────────

export async function getHome(ctx: ProspectsCtx, programId: string): Promise<HomeDto> {
    const data = await loadSegment(ctx, programId);
    const dashboard = await getDashboard(ctx.companyId, programId);
    const live = data.rows.filter(r => !r.excluded);
    const todo: TodoItem[] = [];

    const fresh = live.filter(r => r.isNew).sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1));
    const freshHigh = fresh.filter(r => (r.fit ?? 0) >= FIT_THRESHOLD);
    if (freshHigh.length > 0)
        todo.push({
            id: "review-new",
            title: `Review ${freshHigh.length} new high-fit ${freshHigh.length === 1 ? "company" : "companies"} from the last run`,
            detail: freshHigh
                .slice(0, 3)
                .map(r => r.name)
                .join(", "),
            action: { label: "Review", href: "/companies?view=new" },
        });

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const due = data.items.filter(
        i =>
            inMotion(SALES_OF[i.relationship.stage]) &&
            i.relationship.nextActionAt !== null &&
            i.relationship.nextActionAt <= endOfToday
    );
    if (due.length > 0)
        todo.push({
            id: "due",
            title: `${due.length} next ${due.length === 1 ? "step is" : "steps are"} due`,
            detail: due
                .map(i => `${i.org.name}: ${i.relationship.nextAction ?? "follow up"}`)
                .join(" · "),
            action: { label: "Open deals", href: "/deals" },
        });

    const stale = live.filter(r => r.staleDays !== null);
    if (stale.length > 0)
        todo.push({
            id: "stale",
            title: `${stale.length} ${stale.length === 1 ? "deal has" : "deals have"} gone quiet`,
            detail: stale.map(r => `${r.name} for ${r.staleDays} days`).join(" · "),
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
    const funnel = funnelStages.map(stage => ({
        stage,
        count: live.filter(r => r.stage === stage).length,
    }));
    const median =
        dashboard.medianDaysInStage.contacted ?? dashboard.medianDaysInStage.in_conversation;

    return {
        segment: toSegmentSummary(data.program, data.rows, sourcesOn(availability())),
        lastRunAt: data.latest
            ? (data.latest.startedAt ?? data.latest.createdAt).toISOString()
            : null,
        todo,
        funnel,
        medianDays:
            median !== undefined
                ? { from: "contacted", to: "meeting", days: Math.round(median) }
                : null,
        yield: data.latest?.summary ? data.latest.summary.sources.map(toYield) : [],
        fresh: fresh.slice(0, 4),
    };
}

// ── Companies ─────────────────────────────────────────────────────────────

export async function listCompanies(
    ctx: ProspectsCtx,
    programId: string,
    params: { view: CompaniesView; q: string; sort: CompaniesSort }
): Promise<{ companies: CompanyRow[]; counts: Record<CompaniesView, number> }> {
    const data = await loadSegment(ctx, programId);
    const views: CompaniesView[] = ["all", "new", "highfit", "uncontacted", "excluded"];
    const counts = Object.fromEntries(
        views.map(v => [v, data.rows.filter(r => viewMatches(r, v)).length])
    ) as Record<CompaniesView, number>;
    const companies = sortRows(
        data.rows.filter(r => viewMatches(r, params.view) && searchMatches(r, params.q)),
        params.sort
    );
    return { companies, counts };
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
    const data = await loadSegment(ctx, programId);
    const out: DealRow[] = [];
    for (const item of data.items) {
        const row = toCompanyRow(item, data.rowCtx);
        if (row.excluded) continue;
        // Only the won check needs the agreement; skip the query elsewhere.
        const hasAgreement =
            item.relationship.stage === "negotiating"
                ? (await listAgreements(ctx.companyId, item.relationship.id)).length > 0
                : false;
        out.push({
            ...toDeal(item, hasAgreement, ctx.userId),
            companyName: item.org.name,
            domain: item.org.domain,
            fit: item.relationship.fitScore,
            fitThreshold: FIT_THRESHOLD,
        });
    }
    return out;
}

// ── People ────────────────────────────────────────────────────────────────

export async function listPeople(
    ctx: ProspectsCtx,
    programId: string,
    params: { q: string; status: EmailStatusKind | null }
): Promise<PersonRow[]> {
    const data = await loadSegment(ctx, programId);
    let people = data.items.flatMap(item => {
        const row = toCompanyRow(item, data.rowCtx);
        return contactPeople(
            item.relationship,
            item.org,
            row.excluded ? `Company excluded: ${row.excludedReason ?? "by you"}` : null
        );
    });
    if (params.status) people = people.filter(p => p.emailStatus === params.status);
    const q = params.q.trim().toLowerCase();
    if (q)
        people = people.filter(p =>
            [p.name, p.title, p.companyName, p.email ?? ""].some(t => t.toLowerCase().includes(q))
        );
    return people.sort(
        (a, b) => a.companyName.localeCompare(b.companyName) || a.name.localeCompare(b.name)
    );
}

// ── Outreach ──────────────────────────────────────────────────────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * One campaign in the email vertical for the selected companies; recipients
 * are the public mailboxes in each dossier. Nothing is sent from here: the
 * email vertical's approval gate owns dispatch. Same four exclusions as the
 * Distribution outreach route.
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

export async function listSources(ctx: ProspectsCtx, programId: string): Promise<SourceRow[]> {
    const runs = await listRuns(ctx.companyId, { programId, limit: 50 });
    return sourceRows(availability(), latestCompleted(runs));
}

export { StageTransitionError };
