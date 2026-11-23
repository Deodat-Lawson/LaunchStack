/**
 * The Vantage client contract with `/api/vantage/*`. Types come from the
 * vertical (dates as ISO strings, ids opaque), so a field added there shows
 * up here without a second definition.
 */
import type {
    AgendaDto,
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

/** Each kind is named and explained by `vantage.evidenceKind.label.<kind>` / `.hint.<kind>`. */
export const EVIDENCE_KINDS: readonly Exclude<VantageEvidenceKind, "document">[] = [
    "note",
    "interview",
    "link",
    "task",
    "claim",
];

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

export type TopicPatch = Partial<TopicInput> & {
    expectedContentVersion: number;
    status?: "kept" | "dismissed" | "suggested";
};

export interface DecisionInput {
    expectedContentVersion: number;
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
    expectedContentVersion: number;
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
        readonly body: unknown,
        /**
         * True when the message is this client's own "Request failed" rather
         * than the server's sentence, so a screen can say it in the reader's
         * language instead (`useErrorText` in ~/lib/tools/errorText).
         */
        readonly generated = false
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
        const server =
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
                ? body.error
                : null;
        throw new VantageApiError(
            server ?? `Request failed (${response.status})`,
            response.status,
            body,
            server === null
        );
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

    setAgendaStatus: (id: string, status: VantageAgendaStatus) =>
        post<{ agenda: AgendaDto }>(`/api/vantage/agendas/${id}`, { status }, "PATCH"),
    addTopic: (agendaId: string, input: TopicInput) =>
        post<{ topic: TopicDto }>(`/api/vantage/agendas/${agendaId}/topics`, input),
    patchTopic: (id: string, patch: TopicPatch) =>
        post<{ topic: TopicDto }>(`/api/vantage/topics/${id}`, patch, "PATCH"),
    decide: async (topicId: string, input: DecisionInput) => {
        const body = JSON.stringify(input);
        const digest = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(topicId + body)
        );
        const key = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join(
            ""
        );
        return call<{ topic: TopicDto }>(`/api/vantage/topics/${topicId}/decide`, {
            method: "POST",
            body,
            headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        });
    },

    commitments: (status?: string) =>
        call<{ commitments: CommitmentDto[] }>(`/api/vantage/commitments${q({ status })}`),
    addCommitment: async (input: CommitmentInput) => {
        const body = JSON.stringify(input);
        const slot = "vantage:commitment:" + body;
        const key = sessionStorage.getItem(slot) ?? crypto.randomUUID();
        sessionStorage.setItem(slot, key);
        const result = await call<{ commitment: CommitmentDto }>("/api/vantage/commitments", {
            method: "POST",
            body,
            headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        });
        sessionStorage.removeItem(slot);
        return result;
    },
    patchCommitment: (id: string, patch: CommitmentPatch) =>
        post<{ commitment: CommitmentDto }>(`/api/vantage/commitments/${id}`, patch, "PATCH"),

    addDeadline: (input: { title: string; dueOn: string; note?: string | null }) =>
        post<{ deadline: DeadlineDto }>("/api/vantage/deadlines", input),
    deleteDeadline: (id: string) =>
        call<{ ok: true }>(`/api/vantage/deadlines/${id}`, { method: "DELETE" }),
};

/** Weekly-review wire contracts are owned by the server and erased from client bundles. */
export type * from "~/server/vantage/weekly-review-client-types";
import type {
    WeeklyReviewDto,
    WeeklyReviewListDto,
    WeeklyReviewContextDto,
    WeeklyReviewRoleDto,
    WeeklyReviewSourceQuery,
    WeeklyReviewSourceInspectionDto,
    WeeklyReviewEvidenceDto,
    WeeklyReviewPolicyInput,
    WeeklyReviewStarsInput,
    WeeklyReviewRoleInput,
    WeeklyReviewDecisionInput,
    WeeklyReviewGenerateInput,
    WeeklyReviewEvent,
    WeeklyReviewStage,
} from "~/server/vantage/weekly-review-client-types";

const reviewRoot = "/api/vantage/reviews";
const reviewKey = (key?: string) => ({ "Idempotency-Key": key ?? crypto.randomUUID() });

/** Decode records across arbitrary byte/chunk boundaries, including split UTF-8 characters. */
export async function readWeeklyReviewStream(
    response: Response,
    onStage?: (stage: WeeklyReviewStage) => void
): Promise<WeeklyReviewDto> {
    if (!response.body) throw new VantageApiError("review_unavailable", 503, null);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let result: WeeklyReviewDto | undefined;
    const record = (line: string) => {
        if (!line.trim()) return;
        let event: WeeklyReviewEvent;
        try {
            event = JSON.parse(line) as WeeklyReviewEvent;
        } catch {
            throw new VantageApiError("review_unavailable", 503, null);
        }
        if (!event || typeof event !== "object" || result)
            throw new VantageApiError("review_unavailable", 503, event);
        if (event.type === "stage") {
            if (!["gathering", "exploring", "writing", "checking", "saving"].includes(event.stage))
                throw new VantageApiError("review_unavailable", 503, event);
            try {
                onStage?.(event.stage);
            } catch {
                /* Observation cannot cancel a completed request. */
            }
        } else if (event.type === "error") {
            if (
                typeof event.error !== "string" ||
                !Number.isInteger(event.status) ||
                event.status < 400 ||
                event.status > 599
            )
                throw new VantageApiError("review_unavailable", 503, event);
            throw new VantageApiError(event.error, event.status, { error: event.error });
        } else if (event.type === "result" && event.result) result = event.result;
        else throw new VantageApiError("review_unavailable", 503, event);
    };
    try {
        while (true) {
            const chunk = await reader.read();
            pending += decoder.decode(chunk.value, { stream: !chunk.done });
            let newline: number;
            while ((newline = pending.indexOf("\n")) >= 0) {
                record(pending.slice(0, newline));
                pending = pending.slice(newline + 1);
            }
            if (chunk.done) break;
        }
        record(pending);
        if (!result) throw new VantageApiError("review_unavailable", 503, null);
        return result;
    } finally {
        reader.releaseLock();
    }
}

export const weeklyReviewApi = {
    read: <T>(path: string) => call<T>(reviewRoot + path),
    list: (week?: string) => call<WeeklyReviewListDto>(reviewRoot + q({ weekStart: week })),
    get: (id: string) => call<WeeklyReviewDto>(`${reviewRoot}/${encodeURIComponent(id)}`),
    context: () => call<WeeklyReviewContextDto>(reviewRoot + "/context"),
    role: () => call<WeeklyReviewRoleDto>(reviewRoot + "/context/role"),
    savePolicy: (input: WeeklyReviewPolicyInput) =>
        post<{ version: number }>(reviewRoot + "/context", input),
    saveStars: (input: WeeklyReviewStarsInput) =>
        post<{ version: number }>(reviewRoot + "/context", input, "PATCH"),
    saveRole: (input: WeeklyReviewRoleInput) =>
        post<Pick<WeeklyReviewRoleDto, "role" | "version">>(
            reviewRoot + "/context/role",
            input,
            "PATCH"
        ),
    source: (query: WeeklyReviewSourceQuery) =>
        call<WeeklyReviewSourceInspectionDto>(reviewRoot + "/context/source" + q(query)),
    evidence: (reportId: string, ref: string) =>
        call<WeeklyReviewEvidenceDto>(
            `${reviewRoot}/${encodeURIComponent(reportId)}/evidence${q({ ref })}`
        ),
    decide: (reportId: string, input: WeeklyReviewDecisionInput, key?: string) =>
        call<{ version: number }>(`${reviewRoot}/${encodeURIComponent(reportId)}/decisions`, {
            method: "POST",
            body: JSON.stringify(input),
            headers: reviewKey(key),
        }),
    generate: async (
        input: WeeklyReviewGenerateInput,
        onStage?: (stage: WeeklyReviewStage) => void,
        key?: string
    ): Promise<WeeklyReviewDto> => {
        const response = await fetch(reviewRoot, {
            method: "POST",
            body: JSON.stringify(input),
            headers: {
                "Content-Type": "application/json",
                Accept: "application/x-ndjson",
                ...reviewKey(key),
            },
        });
        if (!response.ok) {
            const body: unknown = await response.json().catch(() => null);
            const code =
                body &&
                typeof body === "object" &&
                "error" in body &&
                typeof body.error === "string"
                    ? body.error
                    : "review_unavailable";
            throw new VantageApiError(code, response.status, body);
        }
        return readWeeklyReviewStream(response, onStage);
    },
};
