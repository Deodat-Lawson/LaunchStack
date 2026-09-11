/**
 * Client types and fetch helpers for the Distribution tool. Records come
 * back JSON-serialised: bigint → string, Date → ISO string.
 */
import type {
    Dossier,
    FitBreakdown,
    PartnerKind,
    RelationshipEventType,
    RelationshipStage,
    RunStatus,
    RunSummary,
    ScreeningState,
    Territory,
} from "@launchstack/pipelines/distribution/types";

export type { PartnerKind, RelationshipStage, Territory };

export interface ProgramDto {
    id: string;
    name: string;
    offering: string;
    categories: string[];
    hsCodes: string[];
    targetTerritories: Territory[];
    partnerKinds: PartnerKind[];
    constraints: string | null;
    knownPartnerDomains: string[];
    status: "active" | "archived";
    createdAt: string;
}

export interface RunDto {
    id: string;
    programId: string;
    status: RunStatus;
    options: { maxCandidates: number };
    plan: {
        adjacentBrands: string[];
        strategy: string;
        queries: Array<{ kind: string; label: string; query: string }>;
    } | null;
    summary: RunSummary | null;
    candidateOrgIds: string[] | null;
    creditsUsed: number;
    errorMessage: string | null;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
}

export interface OrgDto {
    id: string;
    name: string;
    domain: string | null;
    country: string | null;
    region: string | null;
    city: string | null;
    roles: string[];
    categories: string[];
    sizeBand: string | null;
    description: string | null;
    kgEntityId: number | null;
    lastEnrichedAt: string | null;
}

export interface RelationshipDto {
    id: string;
    programId: string;
    orgId: string;
    kind: PartnerKind;
    territory: Territory | null;
    stage: RelationshipStage;
    fitScore: number | null;
    fitRationale: string | null;
    fitBreakdown: FitBreakdown | null;
    riskFlags: string[];
    screening: ScreeningState | null;
    dossier: Dossier | null;
    ownerUserId: string | null;
    nextAction: string | null;
    nextActionAt: string | null;
    lastActivityAt: string | null;
    dossierDocumentId: number | null;
    source: "discovery" | "manual" | "import";
    stageChangedAt: string;
    createdAt: string;
}

export interface PartnerItemDto {
    relationship: RelationshipDto;
    org: OrgDto;
    evidenceCount: number;
    stale: boolean;
}

export interface EvidenceDto {
    id: number;
    kind: string;
    claim: string;
    sourceUrl: string;
    quote: string | null;
    confidence: number;
    capturedAt: string;
}

export interface EventDto {
    id: number;
    type: RelationshipEventType;
    payload: Record<string, unknown>;
    actorUserId: string | null;
    ref: string | null;
    occurredAt: string;
}

export interface AgreementDto {
    id: string;
    territory: Territory[] | null;
    exclusivity: "none" | "exclusive" | "semi";
    startsOn: string | null;
    endsOn: string | null;
    terms: Record<string, unknown>;
    documentId: number | null;
    renewalReminderAt: string | null;
}

export interface PartnerDetailDto {
    relationship: RelationshipDto;
    org: OrgDto;
    evidence: EvidenceDto[];
    events: EventDto[];
    agreements: AgreementDto[];
}

export interface CoverageCellDto {
    country: string;
    kind: PartnerKind;
    covered: number;
    inPipeline: number;
    candidates: number;
    targeted: boolean;
}

export interface DashboardDto {
    programId: string;
    counts: Record<RelationshipStage, number>;
    funnel: Array<{ stage: RelationshipStage; count: number }>;
    inPipeline: number;
    stale: number;
    dueThisWeek: number;
    renewalsDue: number;
    coverage: CoverageCellDto[];
    coveredCells: number;
    targetedCells: number;
    medianDaysInStage: Partial<Record<RelationshipStage, number>>;
    attention: PartnerItemDto[];
}

export class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly body: unknown
    ) {
        super(message);
        this.name = "ApiError";
    }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
        const message =
            body &&
            typeof body === "object" &&
            "error" in body &&
            typeof (body as { error: unknown }).error === "string"
                ? (body as { error: string }).error
                : `Request failed (${response.status})`;
        throw new ApiError(message, response.status, body);
    }
    return body as T;
}

export const api = {
    listPrograms: () => call<{ programs: ProgramDto[] }>("/api/distribution/programs"),
    createProgram: (input: unknown) =>
        call<{ program: ProgramDto }>("/api/distribution/programs", {
            method: "POST",
            body: JSON.stringify(input),
        }),
    updateProgram: (id: string, patch: unknown) =>
        call<{ program: ProgramDto }>(`/api/distribution/programs/${id}`, {
            method: "PATCH",
            body: JSON.stringify(patch),
        }),
    dashboard: (programId: string) =>
        call<{ dashboard: DashboardDto }>(
            `/api/distribution/dashboard?programId=${encodeURIComponent(programId)}`
        ),
    listRuns: (programId: string) =>
        call<{ runs: RunDto[] }>(
            `/api/distribution/runs?programId=${encodeURIComponent(programId)}`
        ),
    startRun: (programId: string, maxCandidates: number) =>
        call<{ run: RunDto }>("/api/distribution/runs", {
            method: "POST",
            body: JSON.stringify({ programId, options: { maxCandidates } }),
        }),
    listPartners: (params: URLSearchParams) =>
        call<{ partners: PartnerItemDto[] }>(`/api/distribution/partners?${params.toString()}`),
    partner: (id: string) => call<PartnerDetailDto>(`/api/distribution/partners/${id}`),
    patchRelationship: (id: string, patch: unknown) =>
        call<{ relationship: RelationshipDto }>(`/api/distribution/relationships/${id}`, {
            method: "PATCH",
            body: JSON.stringify(patch),
        }),
    logEvent: (id: string, input: unknown) =>
        call<{ event: EventDto }>(`/api/distribution/relationships/${id}/events`, {
            method: "POST",
            body: JSON.stringify(input),
        }),
    createAgreement: (id: string, input: unknown) =>
        call<{ agreement: AgreementDto }>(`/api/distribution/relationships/${id}/agreements`, {
            method: "POST",
            body: JSON.stringify(input),
        }),
    importPartners: (programId: string, rows: unknown[]) =>
        call<{ created: number; existing: number }>("/api/distribution/import", {
            method: "POST",
            body: JSON.stringify({ programId, rows }),
        }),
    outreach: (programId: string, relationshipIds: string[], goal?: string) =>
        call<{
            campaignId: number;
            status: string;
            included: string[];
            skipped: Array<{ relationshipId: string; reason: string }>;
        }>("/api/distribution/outreach", {
            method: "POST",
            body: JSON.stringify({ programId, relationshipIds, goal }),
        }),
};

export const STAGE_LABELS: Record<RelationshipStage, string> = {
    candidate: "Candidate",
    researched: "Researched",
    contacted: "Contacted",
    in_conversation: "In conversation",
    qualified: "Qualified",
    negotiating: "Negotiating",
    contracted: "Contracted",
    active: "Active",
    declined: "Declined",
    dormant: "Dormant",
};

export const KIND_LABELS: Record<PartnerKind, string> = {
    importer: "Importer",
    distributor: "Distributor",
    wholesaler: "Wholesaler",
    retailer: "Retailer",
    agent: "Agent",
    reseller: "Reseller",
    supplier: "Supplier",
};

export function formatDate(iso: string | null | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
        ? "—"
        : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function daysAgo(iso: string | null | undefined): string {
    if (!iso) return "never";
    const ms = Date.now() - new Date(iso).getTime();
    const days = Math.floor(ms / 86_400_000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    return `${days} days ago`;
}
