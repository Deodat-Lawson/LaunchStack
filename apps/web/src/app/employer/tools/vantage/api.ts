/**
 * The Vantage client contract with `/api/vantage/*`. Types come from the
 * vertical (dates as ISO strings, ids opaque), so a field added there shows
 * up here without a second definition.
 */
import type {
    AgendaDto,
    AgendaV1Dto,
    TopicV1Dto,
    EnhancementDto,
    ReportPeriod,
    ExecutionRecord,
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
import { decisionKey, normalizeDecision, completeDecision } from "./_lib/submission";
import type { OverviewDto, TriageDto } from "~/server/vantage/service";

export type {
    AgendaDto,
    AgendaV1Dto,
    TopicV1Dto,
    EnhancementDto,
    ReportPeriod,
    ExecutionRecord,
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
    get code(): string | undefined {
        const body = this.body;
        return body && typeof body === "object" && "code" in body && typeof body.code === "string"
            ? body.code
            : undefined;
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
    evidenceById: (id: string) =>
        call<{ evidence: EvidenceDto }>(`/api/vantage/evidence/${encodeURIComponent(id)}`),
    addEvidence: (input: EvidenceInput) =>
        post<{ evidence: EvidenceDto }>("/api/vantage/evidence", input),
    patchEvidence: (id: string, patch: Partial<EvidenceInput>) =>
        post<{ evidence: EvidenceDto }>(
            `/api/vantage/evidence/${encodeURIComponent(id)}`,
            patch,
            "PATCH"
        ),
    deleteEvidence: (id: string) =>
        call<{ ok: true }>(`/api/vantage/evidence/${encodeURIComponent(id)}`, { method: "DELETE" }),

    metrics: () =>
        call<{ definitions: MetricDefinitionDto[]; observations: MetricObservationDto[] }>(
            "/api/vantage/metrics"
        ),
    defineMetric: (input: MetricDefinitionInput) =>
        post<{ definition: MetricDefinitionDto }>("/api/vantage/metrics", input),
    patchMetric: (id: string, patch: Partial<Omit<MetricDefinitionInput, "key">>) =>
        post<{ definition: MetricDefinitionDto }>(
            `/api/vantage/metrics/${encodeURIComponent(id)}`,
            patch,
            "PATCH"
        ),
    deleteMetric: (id: string) =>
        call<{ ok: true }>(`/api/vantage/metrics/${encodeURIComponent(id)}`, { method: "DELETE" }),
    addObservation: (input: ObservationInput) =>
        post<{ observations: MetricObservationDto[] }>("/api/vantage/metrics/observations", input),
    deleteObservation: (id: string) =>
        call<{ ok: true }>(`/api/vantage/metrics/observations/${encodeURIComponent(id)}`, {
            method: "DELETE",
        }),
    observationById: (id: string) =>
        call<{ observation: MetricObservationDto }>(
            `/api/vantage/metrics/observations/${encodeURIComponent(id)}`
        ),
    importMetrics: (csv: string, source?: string | null) =>
        post<ImportResult>("/api/vantage/metrics/import", { csv, source: source ?? null }),

    agendas: (week?: string) =>
        call<{ week: string; agenda: AgendaV1Dto | null; agendas: AgendaSummaryDto[] }>(
            `/api/vantage/agendas${q({ week })}`
        ),
    prepare: (
        weekStart?: string,
        generationMode: "configured-model" | "rules" = "configured-model",
        signal?: AbortSignal
    ) =>
        call<{ agenda: AgendaV1Dto }>("/api/vantage/agendas", {
            method: "POST",
            body: JSON.stringify({ weekStart, generationMode }),
            signal,
        }),
    agenda: (id: string) =>
        call<{ agenda: AgendaV1Dto }>(`/api/vantage/agendas/${encodeURIComponent(id)}`),
    setAgendaStatus: (id: string, status: VantageAgendaStatus) =>
        post<{ agenda: AgendaDto }>(
            `/api/vantage/agendas/${encodeURIComponent(id)}`,
            { status },
            "PATCH"
        ),
    addTopic: (agendaId: string, input: TopicInput) =>
        post<{ topic: TopicV1Dto }>(
            `/api/vantage/agendas/${encodeURIComponent(agendaId)}/topics`,
            input
        ),
    reorder: (agendaId: string, ids: string[]) =>
        post<{ agenda: AgendaDto }>(
            `/api/vantage/agendas/${encodeURIComponent(agendaId)}/reorder`,
            { ids }
        ),
    weeklyUpdate: (agendaId: string, includePrivate = false) =>
        call<{ markdown: string }>(
            `/api/vantage/agendas/${encodeURIComponent(agendaId)}/update${includePrivate ? "?private=1" : ""}`
        ),
    patchTopic: (id: string, patch: TopicPatch, expectedContentVersion = 1) =>
        post<{ topic: TopicV1Dto }>(
            `/api/vantage/topics/${encodeURIComponent(id)}`,
            {
                ...patch,
                expectedContentVersion:
                    Number.isInteger(expectedContentVersion) && expectedContentVersion > 0
                        ? expectedContentVersion
                        : 1,
            },
            "PATCH"
        ),
    deleteTopic: (id: string) =>
        call<{ ok: true }>(`/api/vantage/topics/${encodeURIComponent(id)}`, { method: "DELETE" }),
    decide: async (topicId: string, input: DecisionInput) => {
        const payload = normalizeDecision(input);
        const key = await decisionKey(topicId, payload);
        const result = await call<{ topic: TopicV1Dto }>(
            `/api/vantage/topics/${encodeURIComponent(topicId)}/decide`,
            {
                method: "POST",
                headers: { "Idempotency-Key": key },
                body: JSON.stringify(payload),
            }
        );
        completeDecision(topicId);
        return result;
    },
    reviewEnhancement: (
        topicId: string,
        enhancementId: string,
        status: "accepted" | "dismissed",
        baseTopicVersion: number
    ) =>
        post<{ enhancement: EnhancementDto; agendaVersion: number }>(
            `/api/vantage/topics/${encodeURIComponent(topicId)}/enhancements/${encodeURIComponent(enhancementId)}`,
            { status, baseTopicVersion },
            "PATCH"
        ),
    /** The Undo after a one-click commit: undecided again, that commitment removed. */
    undoDecision: (topicId: string, commitmentId: string | null) =>
        call<{ topic: TopicDto }>(
            `/api/vantage/topics/${encodeURIComponent(topicId)}/decide${q({ commitment: commitmentId ?? undefined })}`,
            { method: "DELETE" }
        ),

    commitments: (status?: string) =>
        call<{ commitments: CommitmentDto[] }>(`/api/vantage/commitments${q({ status })}`),
    commitmentById: (id: string) =>
        call<{ commitment: CommitmentDto }>(`/api/vantage/commitments/${encodeURIComponent(id)}`),
    addCommitment: (input: CommitmentInput) =>
        post<{ commitment: CommitmentDto }>("/api/vantage/commitments", input),
    patchCommitment: (id: string, patch: CommitmentPatch) =>
        post<{ commitment: CommitmentDto }>(
            `/api/vantage/commitments/${encodeURIComponent(id)}`,
            patch,
            "PATCH"
        ),
    deleteCommitment: (id: string) =>
        call<{ ok: true }>(`/api/vantage/commitments/${encodeURIComponent(id)}`, {
            method: "DELETE",
        }),

    deadlines: () => call<{ deadlines: DeadlineDto[] }>("/api/vantage/deadlines"),
    addDeadline: (input: { title: string; dueOn: string; note?: string | null }) =>
        post<{ deadline: DeadlineDto }>("/api/vantage/deadlines", input),
    deleteDeadline: (id: string) =>
        call<{ ok: true }>(`/api/vantage/deadlines/${encodeURIComponent(id)}`, {
            method: "DELETE",
        }),
};

export function vantageErrorMessage(error: unknown): string {
    if (error instanceof VantageApiError) {
        const messages: Record<string, string> = {
            generation_unavailable:
                "Generation is not available yet. The generation adapter has not been connected. Your saved report is unchanged.",
            generation_failed:
                "Generation failed. Your saved report is unchanged. You can try again.",
            stale_agenda:
                "The report changed during generation. Your saved edits are safe. Reload the report before generating again.",
            stale_topic:
                "This topic changed since you opened it. Reload to compare the saved version, then reapply your edit.",
            stale_content:
                "This topic changed since you opened it. Reload to compare the saved version, then reapply your edit.",
            stale_content_version:
                "This topic changed since you opened it. Reload to compare the saved version, then reapply your edit.",
            topic_version_conflict:
                "This topic changed since you opened it. Reload to compare the saved version, then reapply your edit.",
            enhancement_finalized:
                "This addition has already been reviewed. Reload to see its saved status.",
            idempotency_conflict:
                "This submission key was already used with different content. Reload and verify the saved decision before submitting a new change.",
            commitment_exists:
                "This topic already has a primary action. Edit the existing action from Weekly Actions.",
            commitment_ambiguous:
                "This topic has conflicting action links. Ask the test workspace administrator to resolve them.",
            future_week: "Choose the current week or an earlier week to generate a report.",
            pilot_access_denied:
                "This account is not a configured test operator in the isolated test workspace.",
        };
        if (error.code && messages[error.code]) return messages[error.code]!;
        if (error.status === 401)
            return "Your session has expired. Sign in again before continuing.";
        if (error.status === 403)
            return "You do not have access to this operation in the test workspace.";
        if (error.status === 404)
            return "This record is unavailable or you no longer have access to it.";
        if (error.status === 409)
            return "This record changed while you were editing. Reload to compare the saved version, then reapply your change.";
        return error.message;
    }
    return "The request could not be confirmed. Check your connection and retry.";
}
