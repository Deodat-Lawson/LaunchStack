/** Content-free, closed vocabulary. Never derive a code from provider or source text. */
export const WEEKLY_REVIEW_DIAGNOSTIC_RULE_CODES = [
    "report_schema_invalid",
    "generation_validation_failed",
    "evaluation_input_invalid",
    "evaluation_input_budget_exceeded",
    "evaluation_input_schema_invalid",
    "required_scoped_expectation_missing",
    "required_source_expectation_missing",
    "critical_expectation_source_invalid",
    "evaluation_ids_duplicate",
    "enhancement_ids_duplicate",
    "expectation_source_citation_invalid",
    "invalid_source_citation",
    "unsupported_proposal_detail",
    "derivation_reference_mismatch",
    "unsupported_derivation_input",
    "invalid_numeric_derivation",
    "required_context_incomplete",
    "scoped_evidence_required",
    "duplicate_source_ref",
    "duplicate_scoped_parent",
    "scoped_authority_identity_mismatch",
    "authority_audience_mismatch",
    "required_context_audience",
    "future_parent_version",
    "required_scope_incomplete",
    "duplicate_unit",
    "scope_hash_mismatch",
    "invalid_scope_range",
    "required_unit_mismatch",
    "invalid_scoped_ref",
    "scoped_source_mismatch",
    "scoped_source_date_mismatch",
    "invalid_chunk_anchors",
    "invalid_full_document_coverage",
    "parent_hash_mismatch",
    "unbound_scoped_source",
    "report_budget_exceeded",
    "judge_input_budget_exceeded",
    "context_budget_exceeded",
    "judge_setup_invalid",
    "judge_configuration_mismatch",
    "judge_timeout_invalid",
    "judge_evaluation_failed",
    "judge_admission_failed",
    "judge_schema_invalid",
    "judge_coverage_invalid",
    "judge_evidence_quote_invalid",
    "judge_expectation_verdict_invalid",
    "judge_source_evidence_missing",
    "judge_output_evidence_missing",
    "judge_rating_output_evidence_missing",
    "judge_rating_source_evidence_missing",
    "judge_critical_expectation_missed",
    "judge_metric_grounding_below_threshold",
    "judge_metric_coverage_below_threshold",
    "judge_metric_temporal_below_threshold",
    "judge_metric_relevance_below_threshold",
    "judge_metric_actionability_below_threshold",
    "judge_metric_readability_below_threshold",
    "judge_status_partial",
    "judge_status_unavailable",
    "judge_verdict_fail",
    "judge_verdict_needs_review",
    "no-judge",
    "timeout",
    "cancelled",
    "provider-error",
    "invalid-judgment",
    "judge-setup",
    "unknown-citation",
    "future-citation",
    "uncited-fact",
    "marked-unsupported",
    "empty-output",
] as const;
export type WeeklyReviewRuleCode = (typeof WEEKLY_REVIEW_DIAGNOSTIC_RULE_CODES)[number];
export type WeeklyReviewDiagnosticStage = "generation_validation" | "evaluation_input" | "judge";
export type WeeklyReviewDiagnosticCounts = Record<
    "sourceUnits" | "evidenceBytes" | "messageBytes" | "citationsChecked" | "citationsFailed",
    number | null
>;
export interface WeeklyReviewDiagnosticSnapshot {
    stage: WeeklyReviewDiagnosticStage;
    ruleCodes: WeeklyReviewRuleCode[];
    counts: WeeklyReviewDiagnosticCounts;
}
const codes = new Set<string>(WEEKLY_REVIEW_DIAGNOSTIC_RULE_CODES);
const snapshots = new WeakMap<object, WeeklyReviewDiagnosticSnapshot>();
function sanitize(snapshot: WeeklyReviewDiagnosticSnapshot): WeeklyReviewDiagnosticSnapshot {
    const counts = {} as WeeklyReviewDiagnosticCounts;
    for (const key of [
        "sourceUnits",
        "evidenceBytes",
        "messageBytes",
        "citationsChecked",
        "citationsFailed",
    ] as const) {
        const value = snapshot.counts[key];
        counts[key] =
            typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
    }
    return {
        stage: ["generation_validation", "evaluation_input", "judge"].includes(snapshot.stage)
            ? snapshot.stage
            : "generation_validation",
        ruleCodes: [...new Set(snapshot.ruleCodes.filter(code => codes.has(code)))],
        counts,
    };
}
/** Message stays compatible with callers; only the private safe snapshot is persisted. */
export class WeeklyReviewDiagnosticError extends Error {
    constructor(message: string, snapshot: WeeklyReviewDiagnosticSnapshot) {
        super(message);
        snapshots.set(this, sanitize(snapshot));
    }
}
export function weeklyReviewDiagnosticSnapshot(
    error: unknown
): WeeklyReviewDiagnosticSnapshot | null {
    const snapshot = error !== null && typeof error === "object" ? snapshots.get(error) : undefined;
    return snapshot ? sanitize(snapshot) : null;
}
const fixedMessages: Readonly<Record<string, WeeklyReviewRuleCode>> = {
    "Invalid validation judge limits or configuration identity.": "judge_setup_invalid",
    "Judge configuration does not match the evaluation/rubric version.":
        "judge_configuration_mismatch",
    "Scoped Judge input exceeds 14000 bytes.": "judge_input_budget_exceeded",
    "Invalid evaluator timeout.": "judge_timeout_invalid",
    "Evaluation input exceeds 14000 bytes; explicitly prepare smaller scenario excerpts. Nothing was truncated.":
        "evaluation_input_budget_exceeded",
    "Invalid evaluation input. Use the versioned scenario/expectation/output schema.":
        "evaluation_input_schema_invalid",
    "Every required scoped unit needs a critical semantic coverage expectation.":
        "required_scoped_expectation_missing",
    "Every company-required source needs a critical semantic coverage expectation.":
        "required_source_expectation_missing",
    "Critical semantic coverage expectations require a company-required source.":
        "critical_expectation_source_invalid",
    "Evaluation IDs must be unique within each collection.": "evaluation_ids_duplicate",
    "Enhancement IDs must be unique.": "enhancement_ids_duplicate",
    "Expectation evidence must quote an available source at the scenario cutoff.":
        "expectation_source_citation_invalid",
    "Invalid judgment schema.": "judge_schema_invalid",
    "Judgment must assess every expectation and criterion exactly once.": "judge_coverage_invalid",
    "Judge evidence does not match supplied text.": "judge_evidence_quote_invalid",
    "Judgment expectation verdict is invalid.": "judge_expectation_verdict_invalid",
    "Expectation assessment needs source evidence.": "judge_source_evidence_missing",
    "A claimed output match or violation requires an exact output quote.":
        "judge_output_evidence_missing",
    "A numeric rating requires output evidence.": "judge_rating_output_evidence_missing",
    "Grounding and temporal ratings require source evidence.":
        "judge_rating_source_evidence_missing",
};
/** Match exact known literals only; neither prefixes nor unknown messages can escape. */
export function weeklyReviewRuleForError(
    error: unknown,
    fallback: WeeklyReviewRuleCode
): WeeklyReviewRuleCode {
    if (!(error instanceof Error)) return fallback;
    if (Object.hasOwn(fixedMessages, error.message)) return fixedMessages[error.message]!;
    return codes.has(error.message) ? (error.message as WeeklyReviewRuleCode) : fallback;
}
export interface JudgeDiagnosticEvent {
    ruleCodes: WeeklyReviewRuleCode[];
    citationsChecked?: number;
    citationsFailed?: number;
}
