/**
 * Prospects — client contract for `/api/prospects/*`.
 *
 * This is the shape the UI is built against. Today the only implementation
 * is the in-memory simulator behind `/dev/prospects`; the real routes land
 * with the pipeline reframe and must answer with these exact JSON shapes.
 * Every DTO is the user's vocabulary (segment, company, person, deal, source,
 * run), never the pipeline's.
 */

export type SalesStage =
    | "lead"
    | "qualified"
    | "contacted"
    | "meeting"
    | "proposal"
    | "negotiating"
    | "won"
    | "lost"
    | "nurture";

export type EmailStatusKind = "verified" | "found" | "generic" | "guess";

export type CompaniesView = "all" | "new" | "highfit" | "uncontacted" | "excluded";
export type CompaniesSort = "fit" | "activity" | "name";

export interface SegmentCounts {
    companies: number;
    people: number;
    deals: number;
    sources: number;
}

export interface SegmentSummary {
    id: string;
    name: string;
    subtitle: string;
    /** "Fulfilment operators in NL, DE and the UK" — the headline on Home. */
    headline: string;
    status: "draft" | "confirmed";
    counts: SegmentCounts;
}

export interface SegmentField {
    key: string;
    label: string;
    value: string | string[];
    /** Where the value came from, in words: "from company profile". */
    sources: string[];
    editable: boolean;
}

export interface SegmentDto extends SegmentSummary {
    derivedAt: string;
    confirmedAt: string | null;
    basis: { documents: number; hasProfile: boolean };
    fields: SegmentField[];
}

export type SourceKind = "api" | "recipe" | "signal";

export interface SourceRow {
    id: string;
    label: string;
    kind: SourceKind;
    description: string;
    enabled: boolean;
    /** False when a required key is missing from the environment. */
    available: boolean;
    requires: string | null;
    cost: string;
    /** True when the switch is not available yet (settings arrive with the source registry). */
    locked?: boolean;
    lastYield: { found: number; newCompanies: number; cost: string; at: string } | null;
}

export type SourceStatus = "ok" | "degraded" | "failed" | "skipped" | "off";

export interface SourceYield {
    sourceId: string;
    label: string;
    kind: SourceKind;
    found: number;
    /** Null when the backend cannot attribute new companies or deals to a source yet. */
    newCompanies: number | null;
    inDeals: number | null;
    status: SourceStatus;
    detail: string | null;
}

export interface FoundVia {
    sourceId: string;
    label: string;
    kind: SourceKind;
    url: string | null;
    at: string;
}

export interface CompanyRow {
    id: string;
    name: string;
    domain: string | null;
    hq: string;
    country: string;
    sizeBand: string | null;
    archetype: string;
    /** The profile's first sentence, for triage without opening. */
    why: string;
    fit: number | null;
    fitThreshold: number;
    stage: SalesStage;
    staleDays: number | null;
    people: number;
    lastActivityAt: string | null;
    foundVia: FoundVia[];
    isNew: boolean;
    excluded: boolean;
    excludedReason: string | null;
}

export interface EvidenceItem {
    n: number;
    title: string;
    url: string;
    host: string;
    quote: string;
    sourceId: string | null;
}

export interface Claim {
    text: string;
    cites: number[];
}

export interface Signal {
    when: string;
    text: string;
    cites: number[];
}

export interface PersonRow {
    id: string;
    companyId: string;
    companyName: string;
    name: string;
    initials: string;
    title: string;
    seniority: string;
    email: string | null;
    emailStatus: EmailStatusKind;
    source: string;
    sourceUrl: string | null;
    /** Set when the person's company is excluded; outreach is refused. */
    blockedReason: string | null;
}

export interface StageMove {
    stage: SalesStage;
    /** Null when the move is allowed; otherwise why it is not. */
    reason: string | null;
}

export interface DealDto {
    id: string;
    companyId: string;
    stage: SalesStage;
    ownerName: string | null;
    ownerInitials: string | null;
    nextStep: string | null;
    nextStepAt: string | null;
    stageChangedAt: string;
    lastActivityAt: string | null;
    staleDays: number | null;
    allowedMoves: StageMove[];
}

export interface DealRow extends DealDto {
    companyName: string;
    domain: string | null;
    fit: number | null;
    fitThreshold: number;
}

export interface FitBreakdown {
    archetype: [number, number];
    size: [number, number];
    geography: [number, number];
    signals: [number, number];
    disqualifiers: string[];
}

export interface CompanyDetail extends Omit<CompanyRow, "people"> {
    about: Claim[];
    whyFit: Claim[];
    openQuestions: string[];
    signals: Signal[];
    evidence: EvidenceItem[];
    people: PersonRow[];
    deal: DealDto;
    fitBreakdown: FitBreakdown | null;
    profileDocumentTitle: string | null;
    profiledAt: string | null;
}

export interface TodoItem {
    id: string;
    title: string;
    detail: string;
    action: { label: string; href: string };
}

export interface HomeDto {
    segment: SegmentSummary;
    lastRunAt: string | null;
    todo: TodoItem[];
    funnel: Array<{ stage: SalesStage; count: number }>;
    medianDays: { from: SalesStage; to: SalesStage; days: number } | null;
    yield: SourceYield[];
    fresh: CompanyRow[];
}

export type RunStatus = "queued" | "running" | "completed" | "failed" | "stopped";
export type StepStatus = "done" | "running" | "waiting" | "skipped" | "failed";

export interface RunStep {
    id: string;
    label: string;
    detail: string | null;
    status: StepStatus;
    /** Right-aligned figure: "41 found · 9 new", "1 min 40 s". */
    right: string | null;
    children?: RunStep[];
}

/** How the next run will execute: live providers, or public directories when no key is configured. */
export type NextRunMode = "live" | "keyless";

export interface RunDto {
    id: string;
    segmentId: string;
    status: RunStatus;
    startedAt: string;
    completedAt: string | null;
    steps: RunStep[];
    spend: { usd: number; usdCap: number; credits: number };
    caps: string;
    summary: {
        found: number;
        newCompanies: number;
        profiled: number;
        people: number;
        durationMs: number;
        sources: SourceYield[];
    } | null;
    errorMessage: string | null;
}

export interface OutreachResult {
    campaignId: string;
    people: number;
    skipped: Array<{ personId: string; reason: string }>;
}

export interface NewSegmentInput {
    name: string;
    /** What you sell, in your words. */
    offering: string;
    industries: string[];
    /** ISO-3166 alpha-2 codes. */
    countries: string[];
}

// ─── Client ─────────────────────────────────────────────────────────────────

export class ProspectsApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly body: unknown
    ) {
        super(message);
        this.name = "ProspectsApiError";
    }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
        try {
            body = JSON.parse(text);
        } catch {
            body = text;
        }
    }
    if (!response.ok) {
        const message =
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
                ? body.error
                : `Request failed (${response.status})`;
        throw new ProspectsApiError(message, response.status, body);
    }
    return body as T;
}

const q = (params: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
    const s = search.toString();
    return s ? `?${s}` : "";
};

export const prospectsApi = {
    segments: () => call<{ segments: SegmentSummary[] }>("/api/prospects/segments"),
    segment: (id: string) => call<{ segment: SegmentDto }>(`/api/prospects/segments/${id}`),
    confirmSegment: (id: string) =>
        call<{ segment: SegmentDto }>(`/api/prospects/segments/${id}/confirm`, { method: "POST" }),
    deriveSegment: (id: string) =>
        call<{ segment: SegmentDto }>(`/api/prospects/segments/${id}/derive`, { method: "POST" }),
    createSegment: (input: NewSegmentInput) =>
        call<{ segment: SegmentDto }>("/api/prospects/segments", {
            method: "POST",
            body: JSON.stringify(input),
        }),
    patchSegment: (id: string, fields: Record<string, string | string[]>) =>
        call<{ segment: SegmentDto }>(`/api/prospects/segments/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ fields }),
        }),

    home: (segmentId: string) => call<HomeDto>(`/api/prospects/home${q({ segmentId })}`),

    companies: (params: {
        segmentId: string;
        view?: CompaniesView;
        q?: string;
        sort?: CompaniesSort;
    }) =>
        call<{ companies: CompanyRow[]; counts: Record<CompaniesView, number> }>(
            `/api/prospects/companies${q({
                segmentId: params.segmentId,
                view: params.view,
                q: params.q,
                sort: params.sort,
            })}`
        ),
    company: (id: string) => call<{ company: CompanyDetail }>(`/api/prospects/companies/${id}`),
    setExcluded: (ids: string[], excluded: boolean) =>
        call<{ updated: number }>("/api/prospects/companies/exclude", {
            method: "POST",
            body: JSON.stringify({ ids, excluded }),
        }),

    patchDeal: (
        id: string,
        patch: Partial<Pick<DealDto, "stage" | "ownerName" | "nextStep" | "nextStepAt">>
    ) =>
        call<{ deal: DealDto }>(`/api/prospects/deals/${id}`, {
            method: "PATCH",
            body: JSON.stringify(patch),
        }),
    deals: (segmentId: string) =>
        call<{ deals: DealRow[] }>(`/api/prospects/deals${q({ segmentId })}`),

    people: (params: { segmentId: string; q?: string; status?: EmailStatusKind }) =>
        call<{ people: PersonRow[] }>(
            `/api/prospects/people${q({
                segmentId: params.segmentId,
                q: params.q,
                status: params.status,
            })}`
        ),
    /**
     * People first; companies as the fallback for backends that do not have
     * people yet (they pick the best public mailbox per company).
     */
    outreach: (input: { personIds?: string[]; companyIds?: string[] }) =>
        call<OutreachResult>("/api/prospects/outreach", {
            method: "POST",
            body: JSON.stringify(input),
        }),

    runs: (segmentId: string) =>
        call<{ runs: RunDto[]; nextMode?: NextRunMode }>(`/api/prospects/runs${q({ segmentId })}`),
    run: (id: string) => call<{ run: RunDto }>(`/api/prospects/runs/${id}`),
    startRun: (segmentId: string, options: { sample?: boolean } = {}) =>
        call<{ run: RunDto }>("/api/prospects/runs", {
            method: "POST",
            body: JSON.stringify({ segmentId, ...options }),
        }),
    stopRun: (id: string) =>
        call<{ run: RunDto }>(`/api/prospects/runs/${id}/stop`, { method: "POST" }),

    sources: (segmentId: string) =>
        call<{ sources: SourceRow[] }>(`/api/prospects/sources${q({ segmentId })}`),
    setSourceEnabled: (id: string, enabled: boolean, segmentId: string) =>
        call<{ source: SourceRow }>(`/api/prospects/sources/${id}${q({ segmentId })}`, {
            method: "PATCH",
            body: JSON.stringify({ enabled }),
        }),
};

export type ProspectsApi = typeof prospectsApi;
