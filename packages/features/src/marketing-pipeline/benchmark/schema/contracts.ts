import type { CriterionId } from "./enums";
import type { Fixture, CompanyFixture, SourceFact } from "./fixture";
import type { CriterionScore, VariantOutput } from "./result";

/**
 * Scorer contracts — the interface boundary between the two owners.
 *
 * The runner (OWNER: lead) iterates a fixture's criteria, dispatches each to a
 * Scorer, and folds the returned CriterionScore into the CaseResult. It does
 * NOT care whether a score came from a deterministic assertion or a judge —
 * that's the whole point of this boundary. It lets:
 *   - the member build DeterministicAssertions (pure, no model calls), and
 *   - the lead build Judges (LLM-backed, sampled),
 * completely in parallel against the same shape.
 */

/** Everything a scorer needs to evaluate one generated result. */
export interface EvalContext {
    fixture: Fixture;
    company: CompanyFixture;
    /** Raw pipeline output under test (usually 1–3 variants). */
    variants: VariantOutput[];
    /** Resolved ground-truth facts for groundedness/citation scoring. */
    sourceFacts: SourceFact[];
}

/**
 * Deterministic assertion — pure and synchronous, NO model calls.
 * Must be stable across repeats. OWNER: member.
 */
export type DeterministicAssertion = (ctx: EvalContext) => CriterionScore;

/**
 * Model-based judge — async, may sample N times and aggregate (median) for
 * stability. Only for subjective criteria. OWNER: lead.
 */
export type Judge = (ctx: EvalContext) => Promise<CriterionScore>;

/**
 * A registered scorer for one criterion. The runner keeps a registry of these,
 * keyed by criterionId, and picks per the fixture's CriterionSpec.method.
 */
export type Scorer =
    | { kind: "deterministic"; criterionId: CriterionId; run: DeterministicAssertion }
    | { kind: "judge"; criterionId: CriterionId; run: Judge };

/**
 * Generation adapter — how the runner turns a fixture into raw variants.
 * Mode A calls the generator directly with fixture context; Mode B runs the
 * full pipeline against a seeded company. Both satisfy this signature so the
 * runner is mode-agnostic. OWNER: lead.
 */
export type GenerateFn = (args: { fixture: Fixture; company: CompanyFixture }) => Promise<{
    variants: VariantOutput[];
    latencyMs: number;
    tokenUsage: { prompt: number; completion: number; total: number };
    costUsd: number;
    failure: { failed: boolean; stage: string | null; message: string | null };
}>;
