import type { ResolvedChatModel } from "@launchstack/llm";
import type { PreviousVantageContext } from "./previous-context-v1";
export type {
    PreviousVantageContext,
    PreviousVantageTopic,
    PreviousVantageSource,
} from "./previous-context-v1";
import type {
    AgendaDto,
    AgendaDraft,
    CommitmentDto,
    EvidenceDto,
    MetricDefinitionDto,
    MetricObservationDto,
    TopicDto,
    VantageEvidenceRef,
    WeeklySignals,
} from "./types";

export interface ReportPeriod {
    weekStart: string;
    timeZone: "America/New_York";
    startInclusive: string;
    endExclusive: string;
    asOf: string;
    kind: "completed-week" | "week-to-date";
}
export interface ExecutionRecord {
    outcome: "generated" | "empty";
    mode: "ai" | "rules";
    fallbackReason: "no-model" | "timeout" | "provider-error" | "invalid-output" | null;
    modelId: string | null;
    promptVersion: string;
    attempts: number;
    durationMs: number;
}
export interface EnhancementCandidate {
    topicId: string;
    baseTopicVersion: number;
    kind: "evidence" | "idea" | "question";
    text: string;
    refs: VantageEvidenceRef[];
    rationale: string;
}
export interface EnhancementDto extends EnhancementCandidate {
    id: string;
    status: "suggested" | "accepted" | "dismissed";
    createdAt: string;
}
export interface GenerationInput {
    contractVersion: "v1";
    runId: string;
    inputVersion: string;
    reportPeriod: ReportPeriod;
    generationMode: "configured-model" | "rules";
    data: {
        metricDefinitions: MetricDefinitionDto[];
        currentEvidence: EvidenceDto[];
        currentObservations: MetricObservationDto[];
        comparisonObservations: MetricObservationDto[];
        resolvedCommitments: CommitmentDto[];
        carryForwardCommitments: CommitmentDto[];
    };
    reviewedTopics: { topic: TopicDto; contentVersion: number }[];
    /** Additive internal context only; previous AI prose is never current evidence. */
    previousVantageContext?: PreviousVantageContext | null;
}
export interface GenerationResult {
    runId: string;
    inputVersion: string;
    draft: AgendaDraft;
    signals: WeeklySignals;
    enhancements: EnhancementCandidate[];
    execution: ExecutionRecord;
}
export interface GenerationRuntime {
    resolveModel: () => ResolvedChatModel | null;
    signal: AbortSignal;
    budgets: { attemptTimeoutMs: 20000; maxAttempts: 2; retryWaitMs: 1000; totalMs: 45000 };
}
/** Implemented by Member B; no database or web authentication dependencies. */
export type GenerationPort = (
    input: GenerationInput,
    runtime: GenerationRuntime
) => Promise<GenerationResult>;
export type TopicV1Dto = TopicDto & { contentVersion: number };
export type AgendaV1Dto = Omit<AgendaDto, "topics"> & {
    topics: TopicV1Dto[];
    reportPeriod: ReportPeriod | null;
    version: number;
    enhancements: EnhancementDto[];
    execution: ExecutionRecord | null;
};
