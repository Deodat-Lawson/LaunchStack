/**
 * Proposals — client contract for `/api/proposals/*`.
 *
 * This is the shape the UI is built against; the routes answer with these
 * exact JSON shapes and the preview harness answers the same paths from
 * memory. Every DTO is the user's vocabulary — profile, funder,
 * application, section, checklist, library, run — never the pipeline's.
 */

export type ApplicationStatus =
    | "draft"
    | "in_progress"
    | "in_review"
    | "ready"
    | "submitted"
    | "awarded"
    | "declined"
    | "withdrawn";

export type SectionStatus = "empty" | "drafted" | "edited" | "approved";
export type FunderStatus = "candidate" | "saved" | "dismissed" | "applied";
export type FunderSource = "grants_gov" | "web" | "manual";
export type ProfileStatus = "empty" | "building" | "ready" | "failed";
export type ApplicantType = "nonprofit" | "small_business" | "for_profit" | "individual" | "any";
export type RequirementKind =
    | "eligibility"
    | "section"
    | "attachment"
    | "format"
    | "deadline"
    | "budget";
export type FindingSeverity = "blocker" | "warning" | "note";
export type RunKind = "profile" | "funders" | "extract" | "draft" | "rewrite" | "review";
export type RewritePreset = "tighten" | "specific" | "plainer" | "stronger" | "custom";
export type RunStatus = "queued" | "running" | "completed" | "failed";
export type StepStatus = "waiting" | "running" | "done" | "failed" | "skipped";

export interface EvidenceDto {
    n: number;
    documentId: number | null;
    title: string;
    page: number | null;
    quote: string;
    url: string | null;
    /** Where the source opens in the Studio; null for web evidence. */
    href: string | null;
}

export interface ProfileFactDto {
    key: string;
    label: string;
    value: string;
    cites: number[];
    source: "documents" | "profile" | "manual";
}

export interface ProfileDto {
    status: ProfileStatus;
    error: string | null;
    builtAt: string | null;
    summary: string | null;
    applicantType: ApplicantType | null;
    focusAreas: string[];
    geography: string[];
    facts: ProfileFactDto[];
    evidence: EvidenceDto[];
    builtFrom: { documents: number; snippets: number } | null;
    /** How many sources the workspace has to read from. */
    sources: number;
}

export interface FunderRow {
    id: string;
    source: FunderSource;
    title: string;
    funder: string;
    url: string | null;
    summary: string | null;
    closesOn: string | null;
    /** Whole days to the close; negative when past; null when unknown. */
    daysLeft: number | null;
    status: FunderStatus;
    amountMin: number | null;
    amountMax: number | null;
    eligibility: string | null;
    fit: number | null;
    why: string[];
    concerns: string[];
    /** The application started from this funder, when there is one. */
    applicationId: string | null;
    foundAt: string;
}

export interface RequirementDto {
    id: string;
    kind: RequirementKind;
    text: string;
    done: boolean;
    sectionKey: string | null;
}

export interface SectionDto {
    id: string;
    key: string;
    question: string;
    guidance: string | null;
    wordLimit: number | null;
    required: boolean;
    status: SectionStatus;
    draft: string | null;
    words: number;
    cites: number[];
    gaps: string[];
    evidence: EvidenceDto[];
    libraryItemIds: string[];
    draftedAt: string | null;
}

export interface FindingDto {
    id: string;
    severity: FindingSeverity;
    kind: string;
    sectionKey: string | null;
    message: string;
    suggestion: string | null;
}

export interface ReviewDto {
    readiness: number;
    summary: string;
    findings: FindingDto[];
    reviewedAt: string;
}

export interface ApplicationRow {
    id: string;
    title: string;
    funder: string | null;
    status: ApplicationStatus;
    deadline: string | null;
    daysLeft: number | null;
    readiness: number;
    sections: { total: number; written: number; approved: number };
    blockers: number;
    updatedAt: string;
}

export interface ApplicationDetail extends ApplicationRow {
    opportunityId: string | null;
    requestText: string | null;
    requestUrl: string | null;
    requestDocumentId: number | null;
    requestSummary: string | null;
    amountMin: number | null;
    amountMax: number | null;
    requirements: RequirementDto[];
    sectionList: SectionDto[];
    review: ReviewDto | null;
    notes: string | null;
    exportedDocumentId: number | null;
    exportedHref: string | null;
}

export interface LibraryItemDto {
    id: string;
    question: string;
    answer: string;
    tags: string[];
    evidence: EvidenceDto[];
    sourceApplicationId: string | null;
    sourceApplicationTitle: string | null;
    uses: number;
    updatedAt: string;
}

export interface RunStepDto {
    id: string;
    label: string;
    status: StepStatus;
    detail: string | null;
}

export interface RunDto {
    id: string;
    kind: RunKind;
    status: RunStatus;
    applicationId: string | null;
    startedAt: string;
    completedAt: string | null;
    steps: RunStepDto[];
    headline: string | null;
    error: string | null;
    credits: number;
}

export interface TodoItem {
    id: string;
    title: string;
    detail: string;
    action: { label: string; href: string };
}

export interface HomeDto {
    profile: { status: ProfileStatus; builtAt: string | null; facts: number; documents: number };
    todo: TodoItem[];
    deadlines: ApplicationRow[];
    inProgress: ApplicationRow[];
    funders: { saved: number; candidates: number; strong: number; top: FunderRow[] };
    library: number;
    lastRunAt: string | null;
}

export interface CountsDto {
    profileReady: boolean;
    funders: number;
    applications: number;
    library: number;
}

export interface SourceOption {
    id: number;
    title: string;
    folder: string;
    updatedAt: string;
}

export interface FunderSearchInput {
    keywords?: string[];
    geography?: string;
    applicantType?: ApplicantType;
    includeWeb?: boolean;
}

export interface NewApplicationInput {
    title: string;
    funder?: string | null;
    deadline?: string | null;
    opportunityId?: string | null;
    requestText?: string | null;
    requestUrl?: string | null;
    requestDocumentId?: number | null;
}

export interface ApplicationPatch {
    title?: string;
    funder?: string | null;
    status?: ApplicationStatus;
    deadline?: string | null;
    notes?: string | null;
    requestText?: string | null;
    requestUrl?: string | null;
    requirement?: { id: string; done: boolean };
}

export interface SectionPatch {
    draft?: string | null;
    status?: SectionStatus;
    question?: string;
    guidance?: string | null;
    wordLimit?: number | null;
}

export interface NewFunderInput {
    title: string;
    funder: string;
    url?: string | null;
    summary?: string | null;
    closesOn?: string | null;
    amountMin?: number | null;
    amountMax?: number | null;
}

// ─── Client ─────────────────────────────────────────────────────────────────

export class ProposalsApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly body: unknown
    ) {
        super(message);
        this.name = "ProposalsApiError";
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
        throw new ProposalsApiError(message, response.status, body);
    }
    return body as T;
}

const q = (params: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
    const s = search.toString();
    return s ? `?${s}` : "";
};

const post = (body?: unknown): RequestInit => ({
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
});
const patch = (body: unknown): RequestInit => ({ method: "PATCH", body: JSON.stringify(body) });

export const proposalsApi = {
    home: () => call<HomeDto>("/api/proposals/home"),
    counts: () => call<CountsDto>("/api/proposals/counts"),
    sources: (query?: string) =>
        call<{ sources: SourceOption[] }>(`/api/proposals/sources${q({ q: query })}`),

    profile: () => call<{ profile: ProfileDto }>("/api/proposals/profile"),
    buildProfile: () => call<{ run: RunDto }>("/api/proposals/profile", post()),
    patchFact: (fact: { key: string; label?: string; value: string }) =>
        call<{ profile: ProfileDto }>("/api/proposals/profile", patch(fact)),

    funders: (status?: FunderStatus | "all") =>
        call<{ funders: FunderRow[]; sources: { grantsGov: boolean; web: boolean } }>(
            `/api/proposals/funders${q({ status: status && status !== "all" ? status : undefined })}`
        ),
    findFunders: (input: FunderSearchInput = {}) =>
        call<{ run: RunDto }>("/api/proposals/funders/search", post(input)),
    addFunder: (input: NewFunderInput) =>
        call<{ funder: FunderRow }>("/api/proposals/funders", post(input)),
    setFunderStatus: (id: string, status: FunderStatus) =>
        call<{ funder: FunderRow }>(`/api/proposals/funders/${id}`, patch({ status })),
    removeFunder: (id: string) =>
        call<{ ok: true }>(`/api/proposals/funders/${id}`, { method: "DELETE" }),

    applications: () => call<{ applications: ApplicationRow[] }>("/api/proposals/applications"),
    createApplication: (input: NewApplicationInput) =>
        call<{ application: ApplicationDetail; run: RunDto | null }>(
            "/api/proposals/applications",
            post(input)
        ),
    application: (id: string) =>
        call<{ application: ApplicationDetail }>(`/api/proposals/applications/${id}`),
    patchApplication: (id: string, input: ApplicationPatch) =>
        call<{ application: ApplicationDetail }>(`/api/proposals/applications/${id}`, patch(input)),
    deleteApplication: (id: string) =>
        call<{ ok: true }>(`/api/proposals/applications/${id}`, { method: "DELETE" }),
    extract: (id: string) =>
        call<{ run: RunDto }>(`/api/proposals/applications/${id}/extract`, post()),
    draftAll: (id: string, sectionIds?: string[]) =>
        call<{ run: RunDto }>(`/api/proposals/applications/${id}/draft`, post({ sectionIds })),
    review: (id: string) =>
        call<{ run: RunDto }>(`/api/proposals/applications/${id}/review`, post()),
    exportApplication: (id: string) =>
        call<{ application: ApplicationDetail }>(
            `/api/proposals/applications/${id}/export`,
            post()
        ),

    addSection: (
        applicationId: string,
        input: { question: string; guidance?: string | null; wordLimit?: number | null }
    ) =>
        call<{ section: SectionDto }>(
            `/api/proposals/applications/${applicationId}/sections`,
            post(input)
        ),
    patchSection: (applicationId: string, sectionId: string, input: SectionPatch) =>
        call<{ section: SectionDto }>(
            `/api/proposals/applications/${applicationId}/sections/${sectionId}`,
            patch(input)
        ),
    deleteSection: (applicationId: string, sectionId: string) =>
        call<{ ok: true }>(`/api/proposals/applications/${applicationId}/sections/${sectionId}`, {
            method: "DELETE",
        }),
    draftSection: (applicationId: string, sectionId: string) =>
        call<{ run: RunDto }>(
            `/api/proposals/applications/${applicationId}/draft`,
            post({ sectionIds: [sectionId] })
        ),
    rewriteSection: (
        applicationId: string,
        sectionId: string,
        input: { preset: RewritePreset; instruction?: string }
    ) =>
        call<{ run: RunDto }>(
            `/api/proposals/applications/${applicationId}/sections/${sectionId}/rewrite`,
            post(input)
        ),
    markdown: (applicationId: string) =>
        call<{ markdown: string; filename: string }>(
            `/api/proposals/applications/${applicationId}/markdown`
        ),
    saveToLibrary: (applicationId: string, sectionId: string, tags: string[] = []) =>
        call<{ item: LibraryItemDto }>(
            `/api/proposals/applications/${applicationId}/sections/${sectionId}/library`,
            post({ tags })
        ),

    library: () => call<{ items: LibraryItemDto[] }>("/api/proposals/library"),
    createLibraryItem: (input: { question: string; answer: string; tags?: string[] }) =>
        call<{ item: LibraryItemDto }>("/api/proposals/library", post(input)),
    patchLibraryItem: (
        id: string,
        input: { question?: string; answer?: string; tags?: string[] }
    ) => call<{ item: LibraryItemDto }>(`/api/proposals/library/${id}`, patch(input)),
    deleteLibraryItem: (id: string) =>
        call<{ ok: true }>(`/api/proposals/library/${id}`, { method: "DELETE" }),

    runs: (applicationId?: string) =>
        call<{ runs: RunDto[] }>(`/api/proposals/runs${q({ applicationId })}`),
    run: (id: string) => call<{ run: RunDto }>(`/api/proposals/runs/${id}`),
};

export type ProposalsApi = typeof proposalsApi;

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
    draft: "Draft",
    in_progress: "In progress",
    in_review: "In review",
    ready: "Ready",
    submitted: "Submitted",
    awarded: "Awarded",
    declined: "Declined",
    withdrawn: "Withdrawn",
};

export const SECTION_STATUS_LABEL: Record<SectionStatus, string> = {
    empty: "Not written",
    drafted: "Drafted",
    edited: "Edited",
    approved: "Approved",
};

export const RUN_KIND_LABEL: Record<RunKind, string> = {
    profile: "Building your profile",
    funders: "Finding funders",
    extract: "Reading the request",
    draft: "Drafting",
    rewrite: "Rewriting",
    review: "Reviewing",
};

export const REWRITE_PRESET_LABEL: Record<RewritePreset, string> = {
    tighten: "Tighten to the limit",
    specific: "Make it more specific",
    plainer: "Make it plainer",
    stronger: "Make it stronger",
    custom: "Rewrite with instructions…",
};
