import type {
    PreparedScopedEvidence,
    ScopedEvidenceRequest,
} from "@launchstack/pipelines/vantage/scoped-evidence";
import type { TopicSeed } from "./weekly-review-topic-types";
import type { SelectionDiagnostics } from "./weekly-review-internal-selection";
import type { WeeklyReviewRetrievalContext } from "@launchstack/pipelines/vantage/dynamic-retrieval-v3";
export type {
    WeeklyReviewFailureInput,
    WeeklyReviewFailureRecord,
    WeeklyReviewFailureStage,
    WeeklyReviewProviderAttemptInput,
    WeeklyReviewProviderOutcome,
} from "./weekly-review-failure-record";

export interface WeeklyReviewActor {
    companyId: string;
    userId: string;
    authorityEpoch?: string;
}
export type SourcePurpose =
    | "company-architecture"
    | "workspace-required"
    | "personal-star"
    | "retrieved";
export interface FrozenDependency {
    kind: "document" | "company" | "scoped-document";
    scope?: { request: ScopedEvidenceRequest; dependency: PreparedScopedEvidence["dependency"] };
    id: string;
    version: string;
    hash: string;
    purpose: SourcePurpose;
}
export type WeeklyReviewQuery = (
    text: string,
    parameters?: unknown[]
) => Promise<Record<string, unknown>[]>;
export interface WeeklyReviewDatabase {
    transaction<T>(work: (query: WeeklyReviewQuery) => Promise<T>): Promise<T>;
}
export type AssertWeeklyReviewAuthority = (
    query: WeeklyReviewQuery,
    actor: WeeklyReviewActor,
    dependencies: FrozenDependency[],
    phase?: "prepare" | "dispatch" | "activation" | "read" | "decision" | "recovery" | "exploration"
) => Promise<void>;
export class WeeklyReviewConflict extends Error {
    constructor(
        readonly code: string,
        readonly status = 409
    ) {
        super(code);
    }
}

export interface WeeklyReviewSource extends FrozenDependency {
    ref: string;
    text: string;
    audience: "company" | "actor";
    title: string;
}
export interface WeeklyReviewContext {
    actor: WeeklyReviewActor;
    week: string;
    sources: WeeklyReviewSource[];
    role: string;
    preferenceVersion: number;
    authorityEpoch: string;
    mandatoryCoverage: { required: number; included: number };
    dependencies?: FrozenDependency[];
    scopedEvidence?: PreparedScopedEvidence["dependency"][];
    inputIdentity?: { candidateId: string; asOf: string };
    selectionDiagnostics?: SelectionDiagnostics;
    retrievalContext?: WeeklyReviewRetrievalContext;
    topicSeed?: TopicSeed;
}
