/**
 * Prospects over today's Distribution data: pure mappings from the pipeline's
 * records (programs, partner organisations, relationships, evidence, runs) to
 * the Prospects contract in `~/app/employer/tools/growth/prospects/api`.
 *
 * This is the bridge until the pipeline reframe lands. It never invents data
 * the backend does not have: people are the dossier's public mailboxes,
 * sources are the three the gather stage really has, and figures the backend
 * cannot attribute are null rather than zero.
 */
import type { PartnerListItem } from "@launchstack/pipelines/distribution/db";
import { ALLOWED_TRANSITIONS, stageRequirements } from "@launchstack/pipelines/distribution/stages";
import {
    RUN_STATUSES,
    type EvidenceRecord,
    type PartnerOrgRecord,
    type ProgramRecord,
    type RelationshipEventRecord,
    type RelationshipRecord,
    type RelationshipStage,
    type RunRecord,
    type SourceCount,
} from "@launchstack/pipelines/distribution/types";

import type {
    Claim,
    CompaniesSort,
    CompaniesView,
    CompanyDetail,
    CompanyRow,
    DealDto,
    EvidenceItem,
    FitBreakdown,
    FoundVia,
    PersonRow,
    RunDto,
    RunStep,
    SalesStage,
    SegmentDto,
    SegmentField,
    SegmentSummary,
    Signal,
    SourceRow,
    SourceYield,
    StageMove,
    StepStatus,
} from "~/app/employer/tools/growth/prospects/api";

export const FIT_THRESHOLD = 70;
const DAY = 86_400_000;

// ── Stages ────────────────────────────────────────────────────────────────

export const SALES_STAGES: SalesStage[] = [
    "lead",
    "qualified",
    "contacted",
    "meeting",
    "proposal",
    "negotiating",
    "won",
    "lost",
    "nurture",
];

/** The pipeline's ten relationship stages folded onto the sales funnel. */
export const SALES_OF: Record<RelationshipStage, SalesStage> = {
    candidate: "lead",
    researched: "lead",
    qualified: "qualified",
    contacted: "contacted",
    in_conversation: "meeting",
    negotiating: "negotiating",
    contracted: "won",
    active: "won",
    declined: "lost",
    dormant: "nurture",
};

const STAGE_WORD: Record<SalesStage, string> = {
    lead: "Lead",
    qualified: "Qualified",
    contacted: "Contacted",
    meeting: "Meeting",
    proposal: "Proposal",
    negotiating: "Negotiating",
    won: "Won",
    lost: "Not a fit",
    nurture: "Nurture",
};

const IN_MOTION = new Set<SalesStage>(["contacted", "meeting", "proposal", "negotiating"]);

/** Which relationship stage a sales-stage move lands on, from where the deal is now. */
export function relationshipTarget(
    current: RelationshipStage,
    to: SalesStage
): RelationshipStage | null {
    switch (to) {
        case "lead":
            return (
                (["researched", "candidate"] as const).find(s =>
                    ALLOWED_TRANSITIONS[current].includes(s)
                ) ?? null
            );
        case "qualified":
            return "qualified";
        case "contacted":
            return "contacted";
        case "meeting":
            return "in_conversation";
        case "negotiating":
            return "negotiating";
        case "won":
            return "contracted";
        case "lost":
            return "declined";
        case "nurture":
            return "dormant";
        case "proposal":
            return null;
    }
}

export const REQUIREMENT_WORDS: Record<string, string> = {
    owner_required: "Needs an owner",
    next_action_required: "Needs a next step",
    agreement_required: "Needs an agreement recorded in Distribution",
};

export function moveReason(
    rel: Pick<RelationshipRecord, "stage" | "ownerUserId" | "nextAction">,
    hasAgreement: boolean,
    to: SalesStage
): string | null {
    const current = SALES_OF[rel.stage];
    if (to === current) return "Current stage";
    if (to === "proposal") return "Not a stage in this workspace yet";
    const target = relationshipTarget(rel.stage, to);
    if (!target || !ALLOWED_TRANSITIONS[rel.stage].includes(target)) {
        if (current === "won") return "Won deals stay won";
        const nextForward = ALLOWED_TRANSITIONS[rel.stage]
            .map(s => SALES_OF[s])
            .find(s => s !== current && s !== "lost" && s !== "nurture");
        return nextForward
            ? `Move to ${STAGE_WORD[nextForward]} first`
            : `Not available from ${STAGE_WORD[current]}`;
    }
    const missing = stageRequirements(target, {
        ownerUserId: rel.ownerUserId,
        nextAction: rel.nextAction,
        hasAgreement,
    });
    if (missing.length === 0) return null;
    return REQUIREMENT_WORDS[missing[0]!.code] ?? missing[0]!.message;
}

export function allowedMoves(
    rel: Pick<RelationshipRecord, "stage" | "ownerUserId" | "nextAction">,
    hasAgreement: boolean
): StageMove[] {
    return SALES_STAGES.map(stage => ({ stage, reason: moveReason(rel, hasAgreement, stage) }));
}

// ── Small helpers ─────────────────────────────────────────────────────────

export function initials(name: string): string {
    const parts = name.split(/[\s.@_-]+/).filter(Boolean);
    if (parts.length === 0) return "•";
    return parts
        .slice(0, 2)
        .map(w => w[0]!.toUpperCase())
        .join("");
}

export function ownerName(
    rel: Pick<RelationshipRecord, "ownerUserId">,
    viewerId: string
): string | null {
    if (!rel.ownerUserId) return null;
    return rel.ownerUserId === viewerId ? "You" : rel.ownerUserId;
}

export function staleDays(
    item: Pick<PartnerListItem, "relationship" | "stale">,
    now = new Date()
): number | null {
    if (!item.stale) return null;
    const last = item.relationship.lastActivityAt ?? item.relationship.stageChangedAt;
    return Math.max(1, Math.floor((now.getTime() - last.getTime()) / DAY));
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function hostOf(url: string): string {
    return url
        .replace(/^https?:\/\//, "")
        .split("?")[0]!
        .replace(/\/$/, "");
}

const GENERIC_LOCAL =
    /^(info|sales|hello|contact|office|purchasing|einkauf|import|export|mail|team|support|admin|kontakt|verkoop|inkoop)$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isExcluded(
    org: Pick<PartnerOrgRecord, "domain">,
    rel: Pick<RelationshipRecord, "stage">,
    excludedDomains: ReadonlySet<string>
): boolean {
    return rel.stage === "declined" && org.domain !== null && excludedDomains.has(org.domain);
}

// ── Evidence and claims ───────────────────────────────────────────────────

export function numberEvidence(evidence: EvidenceRecord[]): {
    items: EvidenceItem[];
    numberOf: (id: number) => number | null;
} {
    const sorted = [...evidence].sort((a, b) => a.id - b.id);
    const map = new Map<number, number>();
    const items = sorted.map((e, i) => {
        map.set(e.id, i + 1);
        return {
            n: i + 1,
            title: e.claim.length > 90 ? `${e.claim.slice(0, 87)}…` : e.claim,
            url: e.sourceUrl,
            host: hostOf(e.sourceUrl),
            quote: e.quote ?? e.claim,
            sourceId: null,
        };
    });
    return { items, numberOf: id => map.get(id) ?? null };
}

function cites(ids: number[], numberOf: (id: number) => number | null): number[] {
    return [...new Set(ids.map(numberOf).filter((n): n is number => n !== null))].sort(
        (a, b) => a - b
    );
}

export function profileClaims(
    rel: RelationshipRecord,
    evidence: EvidenceRecord[]
): { about: Claim[]; whyFit: Claim[]; openQuestions: string[]; evidence: EvidenceItem[] } {
    const { items, numberOf } = numberEvidence(evidence);
    const d = rel.dossier;
    const about: Claim[] = [];
    if (d) {
        about.push({ text: d.summary, cites: [] });
        if (d.brandsCarried.length > 0)
            about.push({
                text: `Carries ${d.brandsCarried.map(b => b.brand).join(", ")}.`,
                cites: cites(
                    d.brandsCarried.flatMap(b => b.evidenceIds),
                    numberOf
                ),
            });
        if (d.territories.length > 0)
            about.push({
                text: `Active in ${d.territories.map(t => t.territory).join(", ")}.`,
                cites: cites(
                    d.territories.flatMap(t => t.evidenceIds),
                    numberOf
                ),
            });
        if (d.retailCoverage.length > 0)
            about.push({
                text: `Sells into ${d.retailCoverage.map(r => r.account).join(", ")}.`,
                cites: cites(
                    d.retailCoverage.flatMap(r => r.evidenceIds),
                    numberOf
                ),
            });
        if (d.certifications.length > 0)
            about.push({
                text: `Certified: ${d.certifications.map(c => c.certification).join(", ")}.`,
                cites: cites(
                    d.certifications.flatMap(c => c.evidenceIds),
                    numberOf
                ),
            });
    }
    const whyFit: Claim[] = [];
    if (rel.fitRationale) whyFit.push({ text: rel.fitRationale, cites: [] });
    for (const flag of rel.riskFlags) whyFit.push({ text: `Risk: ${flag}`, cites: [] });
    if (rel.screening?.status === "flagged")
        whyFit.push({
            text: `Risk: compliance screening flagged ${rel.screening.flags?.map(f => f.matchedName).join(", ") ?? "a match"} (advisory).`,
            cites: [],
        });
    return { about, whyFit, openQuestions: d?.openQuestions ?? [], evidence: items };
}

const SIGNAL_TYPES = new Set([
    "researched",
    "meeting",
    "reply_logged",
    "document_shared",
    "agreement_signed",
    "imported",
]);

export function signalsFromEvents(events: RelationshipEventRecord[]): Signal[] {
    const text = (v: unknown) => (typeof v === "string" && v ? v : null);
    const scalar = (v: unknown, fallback = "?") =>
        typeof v === "number" ? String(v) : typeof v === "string" && v ? v : fallback;
    return events
        .filter(e => SIGNAL_TYPES.has(e.type))
        .slice(0, 6)
        .map(e => {
            const p = e.payload;
            const when = e.occurredAt.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
            });
            switch (e.type) {
                case "researched":
                    return {
                        when,
                        text: `Researched: fit ${scalar(p.fitScore)}, ${scalar(p.evidence, "0")} pieces of evidence`,
                        cites: [],
                    };
                case "meeting":
                    return {
                        when,
                        text: `Meeting${text(p.summary) ? `: ${text(p.summary)}` : ""}`,
                        cites: [],
                    };
                case "reply_logged":
                    return {
                        when,
                        text: `Reply received${text(p.summary) ? `: ${text(p.summary)}` : ""}`,
                        cites: [],
                    };
                case "document_shared":
                    return {
                        when,
                        text: `Document shared${text(p.title) ? `: ${text(p.title)}` : ""}`,
                        cites: [],
                    };
                case "agreement_signed":
                    return { when, text: "Agreement recorded", cites: [] };
                default:
                    return {
                        when,
                        text: `Imported at ${text(p.stage) ?? "an existing"} stage`,
                        cites: [],
                    };
            }
        });
}

export function fitBreakdownOf(rel: RelationshipRecord): FitBreakdown | null {
    const b = rel.fitBreakdown;
    if (!b) return null;
    return {
        archetype: [b.roleMatch + b.categoryOverlap, 45],
        size: [b.sizeFit, 5],
        geography: [b.territoryMatch, 20],
        signals: [b.evidenceDepth + b.freshness + b.knownSignal, 30],
        disqualifiers: b.excludedBecause ? [b.excludedBecause] : [],
    };
}

// ── People (the dossier's public mailboxes) ───────────────────────────────

export function contactPeople(
    rel: RelationshipRecord,
    org: PartnerOrgRecord,
    blockedReason: string | null
): PersonRow[] {
    const channels = rel.dossier?.contactChannels ?? [];
    return channels
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => EMAIL.test(c.value.trim()))
        .map(({ c, i }) => {
            const email = c.value.trim();
            const local = email.split("@")[0]!;
            const generic = GENERIC_LOCAL.test(local);
            const name = generic ? `${local.toLowerCase()}@ inbox` : local.replace(/[._-]+/g, " ");
            return {
                id: `${rel.id}:${i}`,
                companyId: rel.id,
                companyName: org.name,
                name,
                initials: generic ? "@" : initials(name),
                title: generic ? "Shared inbox" : c.channel,
                seniority: "—",
                email,
                emailStatus: generic ? "generic" : "found",
                source: "Dossier",
                sourceUrl: null,
                blockedReason,
            } satisfies PersonRow;
        });
}

// ── Companies ─────────────────────────────────────────────────────────────

const FOUND_VIA: Record<RelationshipRecord["source"], Omit<FoundVia, "url" | "at">> = {
    discovery: { sourceId: "discovery", label: "Discovery run", kind: "api" },
    import: { sourceId: "import", label: "Imported", kind: "api" },
    manual: { sourceId: "manual", label: "Added by you", kind: "api" },
};

export interface RowContext {
    latestRunId: string | null;
    excludedDomains: ReadonlySet<string>;
    now?: Date;
}

export function whyOf(item: PartnerListItem): string {
    const summary = item.relationship.dossier?.summary;
    if (summary) {
        const first = /^[^.!?]+[.!?]/.exec(summary)?.[0];
        return (first ?? summary).trim();
    }
    return item.org.description ?? item.relationship.fitRationale ?? "Not profiled yet";
}

export function toCompanyRow(item: PartnerListItem, ctx: RowContext): CompanyRow {
    const { relationship: rel, org } = item;
    const excluded = isExcluded(org, rel, ctx.excludedDomains);
    const people = contactPeople(rel, org, null).length;
    return {
        id: rel.id,
        name: org.name,
        domain: org.domain,
        hq:
            [org.city ?? org.region, org.country].filter(Boolean).join(", ") ||
            (org.country ?? "—"),
        country: org.country ?? rel.territory?.country ?? "—",
        sizeBand: org.sizeBand,
        archetype: rel.dossier?.roles.join(", ") ?? rel.kind,
        why: whyOf(item),
        fit: rel.fitScore,
        fitThreshold: FIT_THRESHOLD,
        stage: SALES_OF[rel.stage],
        staleDays: staleDays(item, ctx.now),
        people,
        lastActivityAt: iso(rel.lastActivityAt),
        foundVia: [
            {
                ...FOUND_VIA[rel.source],
                url: org.domain ? `https://${org.domain}` : null,
                at: rel.createdAt.toISOString(),
            },
        ],
        isNew: ctx.latestRunId !== null && org.firstSeenRunId === ctx.latestRunId,
        excluded,
        excludedReason: excluded ? "Excluded from runs" : null,
    };
}

export function toCompanyDetail(
    item: PartnerListItem,
    evidence: EvidenceRecord[],
    events: RelationshipEventRecord[],
    hasAgreement: boolean,
    viewerId: string,
    ctx: RowContext
): CompanyDetail {
    const row = toCompanyRow(item, ctx);
    const claims = profileClaims(item.relationship, evidence);
    const blocked = row.excluded ? `Company excluded: ${row.excludedReason ?? "by you"}` : null;
    return {
        ...row,
        about: claims.about,
        whyFit: claims.whyFit,
        openQuestions: claims.openQuestions,
        signals: signalsFromEvents(events),
        evidence: claims.evidence,
        people: contactPeople(item.relationship, item.org, blocked),
        deal: toDeal(item, hasAgreement, viewerId, ctx.now),
        fitBreakdown: fitBreakdownOf(item.relationship),
        profileDocumentTitle: item.relationship.dossierDocumentId
            ? `${item.org.name} — dossier`
            : null,
        profiledAt: iso(item.org.lastEnrichedAt),
    };
}

export function toDeal(
    item: PartnerListItem,
    hasAgreement: boolean,
    viewerId: string,
    now?: Date
): DealDto {
    const rel = item.relationship;
    const owner = ownerName(rel, viewerId);
    return {
        id: rel.id,
        companyId: rel.id,
        stage: SALES_OF[rel.stage],
        ownerName: owner,
        ownerInitials: owner ? (owner === "You" ? "ME" : initials(owner)) : null,
        nextStep: rel.nextAction,
        nextStepAt: iso(rel.nextActionAt),
        stageChangedAt: rel.stageChangedAt.toISOString(),
        lastActivityAt: iso(rel.lastActivityAt),
        staleDays: staleDays(item, now),
        allowedMoves: allowedMoves(rel, hasAgreement),
    };
}

export function viewMatches(row: CompanyRow, view: CompaniesView): boolean {
    switch (view) {
        case "all":
            return !row.excluded;
        case "new":
            return !row.excluded && row.isNew;
        case "highfit":
            return !row.excluded && (row.fit ?? 0) >= FIT_THRESHOLD;
        case "uncontacted":
            return !row.excluded && (row.stage === "lead" || row.stage === "qualified");
        case "excluded":
            return row.excluded;
    }
}

export function sortRows(rows: CompanyRow[], sort: CompaniesSort): CompanyRow[] {
    const activity = (r: CompanyRow) =>
        r.lastActivityAt ? new Date(r.lastActivityAt).getTime() : 0;
    return [...rows].sort((a, b) =>
        sort === "name"
            ? a.name.localeCompare(b.name)
            : sort === "activity"
              ? activity(b) - activity(a)
              : (b.fit ?? -1) - (a.fit ?? -1) || a.name.localeCompare(b.name)
    );
}

export function searchMatches(row: CompanyRow, q: string): boolean {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return [row.name, row.domain ?? "", row.hq, row.why, row.archetype].some(t =>
        t.toLowerCase().includes(needle)
    );
}

// ── Segments (programs) ───────────────────────────────────────────────────

const KIND_WORD: Record<string, string> = {
    importer: "Importers",
    distributor: "Distributors",
    wholesaler: "Wholesalers",
    retailer: "Retailers",
    agent: "Agents",
    reseller: "Resellers",
    supplier: "Suppliers",
};

export function segmentCounts(rows: CompanyRow[], sourcesOn: number): SegmentSummary["counts"] {
    const live = rows.filter(r => !r.excluded);
    return {
        companies: live.length,
        people: live.reduce((n, r) => n + r.people, 0),
        deals: live.filter(r => r.stage !== "lead").length,
        sources: sourcesOn,
    };
}

export function toSegmentSummary(
    program: ProgramRecord,
    rows: CompanyRow[],
    sourcesOn: number
): SegmentSummary {
    const countries = program.targetTerritories.map(t => t.country);
    return {
        id: program.id,
        name: program.name,
        subtitle: `${countries.join(", ")} · ${program.partnerKinds.map(k => KIND_WORD[k] ?? k).join(", ")}`,
        headline: `${program.partnerKinds.map(k => KIND_WORD[k] ?? k).join(", ")} in ${joinNatural(countries)}`,
        status: program.status === "active" ? "confirmed" : "draft",
        counts: segmentCounts(rows, sourcesOn),
    };
}

export function segmentFields(program: ProgramRecord): SegmentField[] {
    return [
        {
            key: "offering",
            label: "What you sell",
            value: program.offering,
            sources: ["from the program"],
            editable: true,
        },
        {
            key: "archetype",
            label: "Buyer type",
            value: program.partnerKinds.map(k => KIND_WORD[k] ?? k),
            sources: ["from the program · partner kinds"],
            editable: false,
        },
        {
            key: "industries",
            label: "Industries",
            value: program.categories,
            sources: ["from the program · categories"],
            editable: true,
        },
        {
            key: "geographies",
            label: "Where",
            value: program.targetTerritories.map(t =>
                t.region ? `${t.country}:${t.region}` : t.country
            ),
            sources: ["from the program · territories"],
            editable: true,
        },
        {
            key: "disqualifiers",
            label: "Not a fit",
            value: program.constraints ?? "",
            sources: program.constraints ? ["from the program · constraints"] : [],
            editable: true,
        },
        {
            key: "exclusions",
            label: "Already partners",
            value:
                program.knownPartnerDomains.length > 0
                    ? `${program.knownPartnerDomains.length} domains excluded from every run`
                    : "None",
            sources: ["from the program and imports"],
            editable: false,
        },
    ];
}

export function toSegment(
    program: ProgramRecord,
    rows: CompanyRow[],
    sourcesOn: number
): SegmentDto {
    return {
        ...toSegmentSummary(program, rows, sourcesOn),
        derivedAt: program.createdAt.toISOString(),
        confirmedAt: program.status === "active" ? program.createdAt.toISOString() : null,
        basis: { documents: 0, hasProfile: true },
        fields: segmentFields(program),
    };
}

export function joinNatural(items: string[]): string {
    if (items.length <= 1) return items.join("");
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// ── Sources (what the gather stage really has) ────────────────────────────

export interface SourceAvailability {
    web: boolean;
    place: boolean;
    trade: boolean;
    screening: boolean;
}

const SOURCE_LABEL: Record<SourceCount["source"], string> = {
    web: "Web search",
    place: "Places",
    trade: "Trade data",
};
const KEYLESS_LABEL: Record<SourceCount["source"], string> = {
    web: "Public directories (YC)",
    place: "OpenStreetMap",
    trade: "Trade data",
};
const FIXTURE_LABEL: Record<SourceCount["source"], string> = {
    web: "Sample web search",
    place: "Sample places",
    trade: "Sample trade data",
};

export function sourceLabel(
    source: SourceCount["source"],
    mode: RunRecord["options"]["mode"]
): string {
    return mode === "keyless"
        ? KEYLESS_LABEL[source]
        : mode === "fixture"
          ? FIXTURE_LABEL[source]
          : SOURCE_LABEL[source];
}

export function sourceRows(avail: SourceAvailability, latest: RunRecord | null): SourceRow[] {
    const mode = latest?.options.mode ?? null;
    const yieldFor = (id: SourceCount["source"], forMode: RunRecord["options"]["mode"]) => {
        const s = latest?.summary?.sources.find(x => x.source === id);
        if (!latest || mode !== forMode || !s || s.status === "skipped") return null;
        return {
            found: s.results,
            newCompanies: 0,
            cost: "included",
            at: (latest.startedAt ?? latest.createdAt).toISOString(),
        };
    };
    return [
        {
            id: "osm",
            label: "OpenStreetMap",
            kind: "api",
            description:
                "Organisations with a website, by country or city and by what they are. Free, no key; used whenever no search provider is configured.",
            enabled: true,
            available: true,
            requires: null,
            cost: "free",
            locked: true,
            lastYield: yieldFor("place", "keyless"),
        },
        {
            id: "yc",
            label: "Y Combinator directory",
            kind: "api",
            description:
                "Active YC companies in the segment's countries whose blurb matches its words. Free, no key.",
            enabled: true,
            available: true,
            requires: null,
            cost: "free",
            locked: true,
            lastYield: yieldFor("web", "keyless"),
        },
        {
            id: "web",
            label: "Web search",
            kind: "api",
            description:
                "Exa or Serper search for organisations in each territory; needs a model for the research agent.",
            enabled: avail.web,
            available: avail.web,
            requires: "EXA_API_KEY or SERPER_API_KEY",
            cost: "credits per run",
            locked: true,
            lastYield: yieldFor("web", "live"),
        },
        {
            id: "place",
            label: "Places",
            kind: "api",
            description: "Foursquare place search around each city territory.",
            enabled: avail.place,
            available: avail.place,
            requires: "FOURSQUARE_SERVICE_KEY",
            cost: "included",
            locked: true,
            lastYield: yieldFor("place", "live"),
        },
        {
            id: "trade",
            label: "Trade data",
            kind: "api",
            description: "Import shipment records by HS code, when a provider is configured.",
            enabled: avail.trade,
            available: avail.trade,
            requires: "TRADE_DATA_PROVIDER",
            cost: "provider rates",
            locked: true,
            lastYield: yieldFor("trade", "live"),
        },
        {
            id: "screening",
            label: "Sanctions screening",
            kind: "signal",
            description: "OpenSanctions match on every shortlisted organisation. Advisory only.",
            enabled: avail.screening,
            available: avail.screening,
            requires: "OPENSANCTIONS_API_URL",
            cost: "free",
            locked: true,
            lastYield: null,
        },
        {
            id: "sample",
            label: "Sample data",
            kind: "api",
            description:
                "Deterministic stand-ins for every provider. No keys, no credits. Use the switch on Runs.",
            enabled: true,
            available: true,
            requires: null,
            cost: "free",
            locked: true,
            lastYield: null,
        },
    ];
}

export function toYield(s: SourceCount, mode: RunRecord["options"]["mode"] = "live"): SourceYield {
    return {
        sourceId: `${mode}:${s.source}`,
        label: sourceLabel(s.source, mode),
        kind: "api",
        found: s.results,
        newCompanies: null,
        inDeals: null,
        status: s.status,
        detail: s.detail ?? null,
    };
}

// ── Runs ──────────────────────────────────────────────────────────────────

const rank = (status: string) => RUN_STATUSES.indexOf(status as (typeof RUN_STATUSES)[number]);

function statusOf(run: RunRecord, startsAt: string, endsBefore: string): StepStatus {
    if (run.status === "failed") return "failed";
    const r = rank(run.status);
    if (run.status === "completed" || r >= rank(endsBefore)) return "done";
    if (r >= rank(startsAt)) return "running";
    return "waiting";
}

/** Where a running run's profiling has got to: shortlist members enriched since it started. */
export interface RunProgress {
    profiled: number;
    shortlisted: number;
}

export function toRunDto(run: RunRecord, progress: RunProgress | null = null): RunDto {
    const summary = run.summary;
    const sourceChildren: RunStep[] = (
        summary?.sources ??
        (["web", "place", "trade"] as const).map(source => ({
            source,
            queries: 0,
            results: 0,
            status: "skipped" as const,
            detail: undefined,
        }))
    ).map(s => ({
        id: s.source,
        label: sourceLabel(s.source, run.options.mode),
        detail: s.detail ?? (s.status === "skipped" && !summary ? null : null),
        status: !summary
            ? statusOf(run, "gathering", "resolving")
            : s.status === "skipped"
              ? "skipped"
              : s.status === "failed"
                ? "failed"
                : "done",
        right: summary && s.status !== "skipped" ? `${s.results} found` : null,
    }));
    const steps: RunStep[] = [
        { id: "segment", label: "Segment confirmed", detail: null, status: "done", right: null },
        {
            id: "sources",
            label: "Sources",
            detail: summary
                ? `${summary.sources.filter(s => s.status === "ok").length} of ${summary.sources.filter(s => s.status !== "skipped").length} done`
                : null,
            status: statusOf(run, "profiling", "resolving"),
            right: null,
            children: sourceChildren,
        },
        {
            id: "shortlist",
            label: "Shortlist",
            detail: summary
                ? `${summary.shortlisted} of ${summary.resolved} companies`
                : run.candidateOrgIds
                  ? `${run.candidateOrgIds.length} companies`
                  : null,
            status: statusOf(run, "resolving", "enriching"),
            right: summary?.excluded ? `${summary.excluded} excluded` : null,
        },
        {
            id: "profiles",
            label: "Profiles",
            detail: summary
                ? `${summary.enriched} of ${summary.shortlisted}`
                : progress
                  ? `${progress.profiled} of ${progress.shortlisted}`
                  : `0 of ${run.candidateOrgIds?.length ?? run.options.maxCandidates}`,
            status: statusOf(run, "enriching", "completed"),
            right: summary?.gateRejections ? `${summary.gateRejections} failed grounding` : null,
        },
        {
            id: "people",
            label: "People",
            detail: "arrives with people lookup",
            status: "skipped",
            right: null,
        },
    ];
    const startedAt = run.startedAt ?? run.createdAt;
    const durationMs =
        summary?.wallMs ??
        (run.completedAt
            ? run.completedAt.getTime() - startedAt.getTime()
            : Date.now() - startedAt.getTime());
    return {
        id: run.id,
        segmentId: run.programId,
        status:
            run.status === "completed"
                ? "completed"
                : run.status === "failed"
                  ? "failed"
                  : run.status === "queued"
                    ? "queued"
                    : "running",
        startedAt: startedAt.toISOString(),
        completedAt: iso(run.completedAt),
        steps,
        spend: { usd: 0, usdCap: 0, credits: run.creditsUsed },
        caps: `${run.options.maxCandidates} candidates${run.options.mode === "fixture" ? " · sample data" : run.options.mode === "keyless" ? " · public sources, no keys" : ""}`,
        summary: summary
            ? {
                  found: summary.mentions,
                  newCompanies: summary.resolved,
                  profiled: summary.enriched,
                  people: 0,
                  durationMs,
                  sources: summary.sources.map(s => toYield(s, run.options.mode)),
              }
            : null,
        errorMessage: run.errorMessage,
    };
}

export function latestCompleted(runs: RunRecord[]): RunRecord | null {
    return (
        [...runs]
            .filter(r => r.status === "completed")
            .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))[0] ??
        null
    );
}

export function inMotion(stage: SalesStage): boolean {
    return IN_MOTION.has(stage);
}
