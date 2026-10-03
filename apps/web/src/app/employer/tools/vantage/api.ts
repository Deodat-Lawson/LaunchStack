/**
 * The Vantage client contract with `/api/vantage/*`. Types come from the
 * vertical (dates as ISO strings, ids opaque), so a field added there shows
 * up here without a second definition.
 */
import type {
    AgendaDto,
    AgendaSummaryDto,
    CommitmentDto,
    DeadlineDto,
    EvidenceDto,
    MetricDefinitionDto,
    MetricObservationDto,
    TopicDto,
    VantageAgendaStatus,
    VantageCommitmentStatus,
    VantageConflict,
    VantageEvidenceKind,
    VantageEvidenceRef,
    VantageFact,
    VantageVisibility,
    WeeklySignals,
} from "@launchstack/pipelines/vantage";
import type { OverviewDto, TriageDto } from "~/server/vantage/service";

export type {
    AgendaDto,
    AgendaSummaryDto,
    CommitmentDto,
    DeadlineDto,
    EvidenceDto,
    MetricDefinitionDto,
    MetricObservationDto,
    OverviewDto,
    TopicDto,
    TriageDto,
    VantageAgendaStatus,
    VantageCommitmentStatus,
    VantageConflict,
    VantageEvidenceKind,
    VantageEvidenceRef,
    VantageFact,
    VantageVisibility,
    WeeklySignals,
};

export const EVIDENCE_KINDS: readonly VantageEvidenceKind[] = [
    "note",
    "interview",
    "link",
    "task",
    "claim",
    "document",
];

export const EVIDENCE_KIND_LABEL: Record<VantageEvidenceKind, string> = {
    note: "Note",
    interview: "Interview",
    link: "Link",
    task: "Task",
    claim: "Claim",
    document: "Document",
};

export const EVIDENCE_KIND_HINT: Record<VantageEvidenceKind, string> = {
    note: "A short update or observation",
    interview: "What a customer or user said",
    link: "A page, thread or dashboard worth keeping",
    task: "Something that got done, or did not",
    claim: "A number or statement from a deck, application or update",
    document: "A file or report; paste the part that matters",
};

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

export interface MetricDefinitionInput {
    key?: string;
    name: string;
    definition: string;
    unit?: string;
}

export interface ObservationInput {
    metricId: string;
    value: number;
    periodStart: string;
    periodEnd: string;
    source?: string | null;
    note?: string | null;
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
    shared?: boolean;
}

export type TopicPatch = Partial<TopicInput> & { status?: "kept" | "dismissed" | "suggested" };

export interface DecisionInput {
    decision: string;
    commitment: {
        title: string;
        owner: string;
        dueOn: string;
        test?: string | null;
        shared?: boolean;
    } | null;
}

export interface CommitmentInput {
    title: string;
    owner: string;
    dueOn: string;
    test?: string | null;
    shared?: boolean;
}

export type CommitmentPatch = Partial<CommitmentInput> & {
    status?: VantageCommitmentStatus;
    outcome?: string | null;
};

export interface ImportResult {
    imported: number;
    problems: { line: number; message: string }[];
    createdMetrics: string[];
}

export class VantageApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly body: unknown
    ) {
        super(message);
        this.name = "VantageApiError";
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
        throw new VantageApiError(message, response.status, body);
    }
    return body as T;
}

const post = <T>(url: string, payload: unknown, method = "POST") =>
    call<T>(url, { method, body: JSON.stringify(payload) });

const q = (params: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
    const s = search.toString();
    return s ? `?${s}` : "";
};

export const vantageApi = {
    overview: () => call<OverviewDto>("/api/vantage/overview"),
    triage: () => call<TriageDto>("/api/vantage/triage"),

    evidence: (params: { kind?: string; since?: string } = {}) =>
        call<{ evidence: EvidenceDto[] }>(`/api/vantage/evidence${q(params)}`),
    addEvidence: (input: EvidenceInput) =>
        post<{ evidence: EvidenceDto }>("/api/vantage/evidence", input),
    patchEvidence: (id: string, patch: Partial<EvidenceInput>) =>
        post<{ evidence: EvidenceDto }>(`/api/vantage/evidence/${id}`, patch, "PATCH"),
    deleteEvidence: (id: string) =>
        call<{ ok: true }>(`/api/vantage/evidence/${id}`, { method: "DELETE" }),

    metrics: () =>
        call<{ definitions: MetricDefinitionDto[]; observations: MetricObservationDto[] }>(
            "/api/vantage/metrics"
        ),
    defineMetric: (input: MetricDefinitionInput) =>
        post<{ definition: MetricDefinitionDto }>("/api/vantage/metrics", input),
    patchMetric: (id: string, patch: Partial<Omit<MetricDefinitionInput, "key">>) =>
        post<{ definition: MetricDefinitionDto }>(`/api/vantage/metrics/${id}`, patch, "PATCH"),
    deleteMetric: (id: string) =>
        call<{ ok: true }>(`/api/vantage/metrics/${id}`, { method: "DELETE" }),
    addObservation: (input: ObservationInput) =>
        post<{ observations: MetricObservationDto[] }>("/api/vantage/metrics/observations", input),
    deleteObservation: (id: string) =>
        call<{ ok: true }>(`/api/vantage/metrics/observations/${id}`, { method: "DELETE" }),
    importMetrics: (csv: string, source?: string | null) =>
        post<ImportResult>("/api/vantage/metrics/import", { csv, source: source ?? null }),

    agendas: (week?: string) =>
        call<{ week: string; agenda: AgendaDto | null; agendas: AgendaSummaryDto[] }>(
            `/api/vantage/agendas${q({ week })}`
        ),
    prepare: (weekStart?: string) =>
        post<{ agenda: AgendaDto }>("/api/vantage/agendas", { weekStart }),
    agenda: (id: string) => call<{ agenda: AgendaDto }>(`/api/vantage/agendas/${id}`),
    setAgendaStatus: (id: string, status: VantageAgendaStatus) =>
        post<{ agenda: AgendaDto }>(`/api/vantage/agendas/${id}`, { status }, "PATCH"),
    addTopic: (agendaId: string, input: TopicInput) =>
        post<{ topic: TopicDto }>(`/api/vantage/agendas/${agendaId}/topics`, input),
    reorder: (agendaId: string, ids: string[]) =>
        post<{ agenda: AgendaDto }>(`/api/vantage/agendas/${agendaId}/reorder`, { ids }),
    weeklyUpdate: (agendaId: string, includePrivate = false) =>
        call<{ markdown: string }>(
            `/api/vantage/agendas/${agendaId}/update${includePrivate ? "?private=1" : ""}`
        ),
    patchTopic: (id: string, patch: TopicPatch) =>
        post<{ topic: TopicDto }>(`/api/vantage/topics/${id}`, patch, "PATCH"),
    deleteTopic: (id: string) =>
        call<{ ok: true }>(`/api/vantage/topics/${id}`, { method: "DELETE" }),
    decide: (topicId: string, input: DecisionInput) =>
        post<{ topic: TopicDto }>(`/api/vantage/topics/${topicId}/decide`, input),

    commitments: (status?: string) =>
        call<{ commitments: CommitmentDto[] }>(`/api/vantage/commitments${q({ status })}`),
    addCommitment: (input: CommitmentInput) =>
        post<{ commitment: CommitmentDto }>("/api/vantage/commitments", input),
    patchCommitment: (id: string, patch: CommitmentPatch) =>
        post<{ commitment: CommitmentDto }>(`/api/vantage/commitments/${id}`, patch, "PATCH"),
    deleteCommitment: (id: string) =>
        call<{ ok: true }>(`/api/vantage/commitments/${id}`, { method: "DELETE" }),

    deadlines: () => call<{ deadlines: DeadlineDto[] }>("/api/vantage/deadlines"),
    addDeadline: (input: { title: string; dueOn: string; note?: string | null }) =>
        post<{ deadline: DeadlineDto }>("/api/vantage/deadlines", input),
    deleteDeadline: (id: string) =>
        call<{ ok: true }>(`/api/vantage/deadlines/${id}`, { method: "DELETE" }),
};
