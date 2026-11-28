/** Content-free operational records. Never retain provider messages, source refs,
 * document identifiers, validation paths, quotes, or arbitrary error strings. */
import { WEEKLY_REVIEW_DIAGNOSTIC_RULE_CODES } from "@launchstack/pipelines/vantage/weekly-review-v21";
export const REVIEW_FAILURE_STAGES = [
    "prepare",
    "digest",
    "exploration",
    "generation",
    "generation_validation",
    "evaluation_input",
    "judge",
    "admission",
    "recovery",
    "unknown",
] as const;
export type WeeklyReviewFailureStage = (typeof REVIEW_FAILURE_STAGES)[number];
export const REVIEW_FAILURE_CLASSES = [
    "authority",
    "budget",
    "timeout",
    "provider",
    "validation",
    "conflict",
    "internal",
    "unknown",
] as const;
export type WeeklyReviewFailureClass = (typeof REVIEW_FAILURE_CLASSES)[number];
export const REVIEW_VALIDATOR_CODES = [
    ...WEEKLY_REVIEW_DIAGNOSTIC_RULE_CODES,
    "invalid_source_citation",
    "required_context_incomplete",
    "required_context_audience",
    "independent_judge_required",
    "context_budget_exceeded",
    "unsupported_proposal_detail",
    "invalid_numeric_derivation",
    "candidate_admission_invalid",
    "invalid_report_schema",
    "unknown-citation",
    "future-citation",
    "uncited-fact",
    "marked-unsupported",
    "empty-output",
    "duplicate-task",
] as const;
export const REVIEW_JUDGE_CODES = [
    ...WEEKLY_REVIEW_DIAGNOSTIC_RULE_CODES,
    "judge_admission_failed",
    "judge_schema_invalid",
    "judge_evidence_invalid",
    "judge_coverage_incomplete",
    "grounding",
    "completeness",
    "relevance",
    "actionability",
    "temporal",
    "unsupported",
    "uncertain",
] as const;
export const REVIEW_FAILURE_CODES = [
    "candidate_not_admitted",
    "dispatch_uncertain_expired",
    "review_deadline_exceeded",
    "review_access_denied",
    "review_mutation_denied",
    "review_configuration_denied",
    "source_access_denied",
    "source_context_unavailable",
    "source_authority_changed",
    "topic_authority_revoked",
    "weekly_review_disabled",
    "active_review_changed",
    "review_concurrent_update",
    "review_lock_unavailable",
    "review_model_unavailable",
    "provider_failure",
    "provider_attempt_failed",
    "provider_timeout",
    "provider_attempt_timeout",
    "validation_or_provider_failure",
    "topic_exploration_failed:timeout",
    "topic_exploration_failed:model_unavailable",
    "topic_exploration_failed:evidence_budget_invalid",
    "topic_exploration_failed:catalogue_limit",
    "topic_exploration_failed:trace_limit",
    "topic_exploration_failed:invalid_response",
    "topic_exploration_failed:provider_failure",
    "topic_exploration_failed:tool_limit",
    "topic_exploration_failed:byte_limit",
    "topic_exploration_failed:turn_limit",
    "topic_exploration_failed:incomplete",
    "topic_digest_failed:timeout",
    "topic_digest_failed:provider",
    "topic_exploration_failed:provider",
    "topic_exploration_failed:http_429",
    "topic_exploration_failed:http_503",
    "topic_exploration_failed:call_limit",
    "topic_exploration_failed:not_offered",
    "topic_exploration_failed:range_invalid",
    "topic_exploration_failed:transport_no_http",
    "topic_exploration_failed:provider_response_invalid",
    "topic_exploration_failed:submission_invalid",
    "topic_exploration_failed:submission_missing",
    ...Array.from({ length: 200 }, (_, index) => `topic_exploration_failed:http_${400 + index}`),
    ...REVIEW_VALIDATOR_CODES,
    ...REVIEW_JUDGE_CODES,
] as const;
export interface WeeklyReviewFailureCounts {
    sourceUnits: number | null;
    evidenceBytes: number | null;
    messageBytes: number | null;
    citationsChecked: number | null;
    citationsFailed: number | null;
    providerAttempts: number | null;
    providerFailures: number | null;
}
export interface WeeklyReviewFailureInput {
    stage?: WeeklyReviewFailureStage;
    statusClass?: WeeklyReviewFailureClass;
    validatorCodes?: readonly string[];
    judgeCodes?: readonly string[];
    counts?: Partial<WeeklyReviewFailureCounts>;
    provider?: unknown;
}
export interface WeeklyReviewFailureRecord {
    schemaVersion: "vantage-failure/v1";
    stage: WeeklyReviewFailureStage;
    code: string;
    statusClass: WeeklyReviewFailureClass;
    validatorCodes: string[];
    judgeCodes: string[];
    counts: WeeklyReviewFailureCounts;
    provider: WeeklyReviewProviderOutcome;
}
export const safeReviewCount = (value: unknown): number | null =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
const member = <T extends string>(value: unknown, values: readonly T[], fallback: T): T =>
    typeof value === "string" && (values as readonly string[]).includes(value)
        ? (value as T)
        : fallback;
const codes = (value: unknown, allowed: readonly string[]): string[] =>
    Array.isArray(value)
        ? [
              ...new Set(
                  value.filter(
                      (item): item is string => typeof item === "string" && allowed.includes(item)
                  )
              ),
          ].slice(0, 32)
        : [];
export function safeWeeklyReviewFailureCode(value: unknown): string {
    return member(value, REVIEW_FAILURE_CODES, "candidate_not_admitted");
}
function failureClass(code: string): WeeklyReviewFailureClass {
    if (/access_denied|authority|mutation_denied|configuration_denied|disabled/.test(code))
        return "authority";
    if (/expired|timeout|deadline/.test(code)) return "timeout";
    if (/budget|byte_limit|catalogue_limit|trace_limit|call_limit/.test(code)) return "budget";
    if (/provider|model_unavailable|transport_no_http|:http_[45][0-9]{2}$/.test(code))
        return "provider";
    if (/changed|concurrent|lock_unavailable/.test(code)) return "conflict";
    if ([...REVIEW_VALIDATOR_CODES, ...REVIEW_JUDGE_CODES].includes(code as never))
        return "validation";
    return "unknown";
}
/** Also decodes historical/corrupt records, returning a stable safe fallback. */
export function weeklyReviewFailureRecord(
    code: unknown,
    input?: unknown
): WeeklyReviewFailureRecord {
    const value = object(input),
        count = object(value.counts);
    const safeCode = safeWeeklyReviewFailureCode(code);
    return {
        schemaVersion: "vantage-failure/v1",
        stage: member(
            value.stage,
            REVIEW_FAILURE_STAGES,
            safeCode === "dispatch_uncertain_expired" ? "recovery" : "unknown"
        ),
        code: safeCode,
        statusClass: member(value.statusClass, REVIEW_FAILURE_CLASSES, failureClass(safeCode)),
        validatorCodes: codes(value.validatorCodes, REVIEW_VALIDATOR_CODES),
        judgeCodes: codes(value.judgeCodes, REVIEW_JUDGE_CODES),
        counts: {
            sourceUnits: safeReviewCount(count.sourceUnits),
            evidenceBytes: safeReviewCount(count.evidenceBytes),
            messageBytes: safeReviewCount(count.messageBytes),
            citationsChecked: safeReviewCount(count.citationsChecked),
            citationsFailed: safeReviewCount(count.citationsFailed),
            providerAttempts: safeReviewCount(count.providerAttempts),
            providerFailures: safeReviewCount(count.providerFailures),
        },
        provider: safeWeeklyReviewProviderOutcome(value.provider),
    };
}

export const PROVIDER_ATTEMPT_STAGES = ["digest", "exploration", "generation", "judge"] as const;
export type WeeklyReviewProviderStage = (typeof PROVIDER_ATTEMPT_STAGES)[number];
export const VANTAGE_V2_MODEL_STAGES = ["decomposition", "task_execution"] as const;
export type VantageV2ModelStage = (typeof VANTAGE_V2_MODEL_STAGES)[number];
export interface WeeklyReviewProviderAttemptInput {
    stage: WeeklyReviewProviderStage;
    /** One based within a logical provider operation; concurrent digests may share it. */
    attempt: number;
    messageBytes: number | null;
    deadlineAt?: number | string;
    snapshotHash?: string;
    expectedActiveId?: string | null;
}

export const PROVIDER_STATUS_CLASSES = [
    "success",
    "rate_limited",
    "unavailable",
    "connection_failed",
    "rejected",
    "unknown",
    "aborted",
    "deadline",
] as const;
export type WeeklyReviewProviderStatusClass = (typeof PROVIDER_STATUS_CLASSES)[number];
export interface WeeklyReviewProviderOutcome {
    statusClass: WeeklyReviewProviderStatusClass;
    httpStatus: number | null;
    retryAfterMs: number | null;
    usage: {
        inputTokens: number | null;
        outputTokens: number | null;
        totalTokens: number | null;
        reasoningTokens: number | null;
        cachedInputTokens: number | null;
    };
}
export function safeWeeklyReviewProviderOutcome(input: unknown): WeeklyReviewProviderOutcome {
    const value = object(input),
        usage = object(value.usage),
        status = safeReviewCount(value.httpStatus);
    return {
        statusClass: member(value.statusClass, PROVIDER_STATUS_CLASSES, "unknown"),
        httpStatus: status !== null && status >= 100 && status <= 599 ? status : null,
        retryAfterMs: safeReviewCount(value.retryAfterMs),
        usage: {
            inputTokens: safeReviewCount(usage.inputTokens),
            outputTokens: safeReviewCount(usage.outputTokens),
            totalTokens: safeReviewCount(usage.totalTokens),
            reasoningTokens: safeReviewCount(usage.reasoningTokens),
            cachedInputTokens: safeReviewCount(usage.cachedInputTokens),
        },
    };
}
const date = (value: unknown): string | null => {
    const time =
        value instanceof Date
            ? value.getTime()
            : typeof value === "string"
              ? Date.parse(value)
              : NaN;
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
export interface WeeklyReviewProviderAttempt {
    id: string;
    stage: WeeklyReviewProviderStage | VantageV2ModelStage | "unknown";
    attempt: number | null;
    messageBytes: number | null;
    startedAt: string | null;
    settledAt: string | null;
    status: "pending" | "settled";
    outcome: WeeklyReviewProviderOutcome;
}
/** A positive field list prevents accidental exposure after future schema additions. */
export function weeklyReviewProviderAttempt(input: unknown): WeeklyReviewProviderAttempt {
    const value = object(input);
    return {
        id:
            typeof value.id === "string" && /^[a-f0-9-]{36}$/i.test(value.id)
                ? value.id
                : "unavailable",
        stage: member(
            value.stage,
            [...PROVIDER_ATTEMPT_STAGES, ...VANTAGE_V2_MODEL_STAGES, "unknown"],
            "unknown"
        ),
        attempt: safeReviewCount(value.attempt_ordinal),
        messageBytes: safeReviewCount(value.message_bytes),
        startedAt: date(value.started_at),
        settledAt: date(value.settled_at),
        status: value.settled_at == null ? "pending" : "settled",
        outcome: safeWeeklyReviewProviderOutcome(value.outcome),
    };
}
