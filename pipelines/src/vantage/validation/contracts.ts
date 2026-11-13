import { z } from "zod";
import type { ChatTokenUsage } from "@launchstack/llm";

export const EVALUATION_VERSION = "vantage-evaluation/v1" as const;
export const RUBRIC_VERSION = "vantage-quality/1.0" as const;
export const SCOPED_EVALUATION_VERSION = "vantage-evaluation/v2" as const;
export const SCOPED_RUBRIC_VERSION = "vantage-quality/2.0-scoped" as const;
export const RATED_CRITERIA = [
    "grounding",
    "temporal",
    "relevance",
    "actionability",
    "readability",
] as const;
export const CRITERIA = [
    "grounding",
    "coverage",
    "temporal",
    "relevance",
    "actionability",
    "readability",
] as const;
export type Criterion = (typeof CRITERIA)[number];
// Canonical V0 keys use '~' and backslash escaping; retain their exact identity.
const id = z.string().regex(/^[!-~]{1,300}$/);
const text = z
    .string()
    .min(1)
    .max(6000)
    .refine(value => value.trim().length > 0);
const date = z.string().datetime({ offset: true });
const evidence = z.object({ kind: z.enum(["source", "output"]), id, quote: text }).strict();

export const EvaluationInputSchema = z
    .object({
        version: z.literal(EVALUATION_VERSION),
        scenario: z
            .object({
                id,
                version: id,
                title: text,
                asOf: date,
                contextCompleteness: z.enum(["complete", "excerpted"]),
                documents: z
                    .array(z.object({ id, version: id, availableAt: date, text }).strict())
                    .max(20),
                expectations: z
                    .array(
                        z
                            .object({
                                id,
                                description: text,
                                kind: z.enum(["must_include", "must_not_claim"]),
                                importance: z.enum(["normal", "important", "critical"]),
                                evidence: z
                                    .array(z.object({ sourceId: id, quote: text }).strict())
                                    .min(1)
                                    .max(6),
                            })
                            .strict()
                    )
                    .min(1)
                    .max(16),
            })
            .strict(),
        actual: z
            .object({
                id,
                pipelineVersion: id,
                summary: z.string().max(4000),
                enhancements: z
                    .array(
                        z
                            .object({
                                id,
                                topicId: id,
                                kind: z.enum(["evidence", "idea", "question"]),
                                text,
                                rationale: z.string().max(2000),
                                sourceIds: z.array(id).max(12),
                            })
                            .strict()
                    )
                    .max(30)
                    .default([]),
                tasks: z
                    .array(
                        z
                            .object({
                                id,
                                title: z.string().max(1000),
                                facts: z
                                    .array(
                                        z
                                            .object({
                                                text,
                                                sourceIds: z.array(id).max(12),
                                                unsupported: z.boolean().optional(),
                                            })
                                            .strict()
                                    )
                                    .max(12),
                                whyItMatters: z.string().max(2000),
                                decisionQuestion: z.string().max(1500),
                                nextStep: z.string().max(2000),
                                rationale: z.string().max(2000),
                                owner: z.string().max(300).nullable(),
                                dueOn: z.string().max(100).nullable(),
                                dueInDays: z.number().int().min(0).max(3650).nullable().optional(),
                                helpRequested: z.string().max(1000).nullable(),
                                unknowns: z.array(text).max(12),
                                conflicts: z
                                    .array(
                                        z.object({ text, sourceIds: z.array(id).max(12) }).strict()
                                    )
                                    .max(12),
                            })
                            .strict()
                    )
                    .max(10),
            })
            .strict(),
    })
    .strict();
// Server-generated provenance. A descriptor is never authorization by itself. The host
// must revalidate its actor, current ACL, administrator scope and full parent hash.
const scopedId = z.string().min(1).max(200);
const scopedHash = z.string().regex(/^[a-f0-9]{64}$/);
const scopedRange = z
    .object({
        id: scopedId,
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
        excerptHash: scopedHash,
    })
    .strict();
export const ScopedEvidenceDependencySchema = z
    .object({
        version: z.literal("vantage-scoped-evidence/v2"),
        actorId: scopedId,
        companyId: scopedId,
        documentId: scopedId,
        parentVersion: scopedId,
        parentHash: scopedHash,
        parentChars: z.number().int().positive().max(128000),
        scopeHash: scopedHash,
        authorityRevision: scopedId,
        aclRevision: scopedId,
        purpose: z.enum([
            "company-architecture",
            "workspace-required",
            "personal-star",
            "retrieved",
        ]),
        audience: z.enum(["company", "actor"]),
        companyReadable: z.boolean(),
        versionDate: date,
        availableAt: date,
        offsetEncoding: z.literal("utf16_half_open"),
        requiredUnits: z.array(scopedRange).min(1).max(16),
        units: z
            .array(
                scopedRange
                    .extend({
                        ref: z.string().regex(/^unit:[a-f0-9]{64}$/),
                        anchors: z
                            .array(
                                z
                                    .object({
                                        chunkId: scopedId,
                                        ordinal: z.number().int().min(0).max(1023),
                                        start: z.number().int().nonnegative(),
                                        end: z.number().int().positive(),
                                    })
                                    .strict()
                            )
                            .min(1)
                            .max(1024),
                    })
                    .strict()
            )
            .min(1)
            .max(16),
        coverage: z
            .object({
                state: z.enum([
                    "full_document_reviewed",
                    "relevant_spans_reviewed",
                    "insufficient_evidence",
                ]),
                qualification: z.string().min(1).max(500),
                requiredUnits: z.number().int().min(1).max(16),
                includedUnits: z.number().int().min(1).max(16),
                reviewedRepresentation: z.literal("canonical_indexed_text"),
                originalCompleteness: z.enum(["verified_complete", "unknown"]),
            })
            .strict(),
    })
    .strict();
export const ScopedEvaluationInputSchema = EvaluationInputSchema.extend({
    version: z.literal(SCOPED_EVALUATION_VERSION),
    scenario: EvaluationInputSchema.shape.scenario
        .extend({
            contextCompleteness: z.literal("scoped"),
            scopedEvidence: z.array(ScopedEvidenceDependencySchema).min(1).max(16),
            documents: z
                .array(
                    EvaluationInputSchema.shape.scenario.shape.documents.element
                        .extend({
                            hash: scopedHash,
                            purpose: z.enum([
                                "company-architecture",
                                "workspace-required",
                                "personal-star",
                                "retrieved",
                            ]),
                        })
                        .strict()
                )
                .max(16),
        })
        .strict(),
}).strict();
export const VersionedEvaluationInputSchema = z.discriminatedUnion("version", [
    EvaluationInputSchema,
    ScopedEvaluationInputSchema,
]);
export type ScopedEvidenceDependency = z.infer<typeof ScopedEvidenceDependencySchema>;
export type EvaluationInput = z.infer<typeof VersionedEvaluationInputSchema>;
export type Evidence = z.infer<typeof evidence>;

export const JudgmentSchema = z
    .object({
        expectations: z
            .array(
                z
                    .object({
                        expectationId: id,
                        verdict: z.enum(["met", "partial", "missed", "violated", "uncertain"]),
                        reason: text,
                        evidence: z.array(evidence).max(8),
                    })
                    .strict()
            )
            .max(16),
        ratings: z
            .array(
                z
                    .object({
                        criterion: z.enum(RATED_CRITERIA),
                        score: z.number().int().min(0).max(4).nullable(),
                        reason: text,
                        evidence: z.array(evidence).max(8),
                    })
                    .strict()
            )
            .length(5),
    })
    .strict();
export type Judgment = z.infer<typeof JudgmentSchema>;
export interface OutputUnit {
    id: string;
    text: string;
    sourceIds: string[];
    unsupported?: boolean;
}
export interface JudgeRequest {
    rubricVersion: typeof RUBRIC_VERSION | typeof SCOPED_RUBRIC_VERSION;
    input: EvaluationInput;
    outputUnits: OutputUnit[];
}
export interface ValidationJudge {
    kind: "model" | "fixture-replay" | "human";
    /** Pin model/prompt/config or human-review batch identity; used for comparable runs. */
    id: string;
    evaluate(
        request: JudgeRequest,
        signal: AbortSignal
    ): Promise<{ judgment: unknown; usage?: ChatTokenUsage }>;
}
export interface IntegrityIssue {
    code:
        | "unknown-citation"
        | "future-citation"
        | "uncited-fact"
        | "marked-unsupported"
        | "empty-output"
        | "duplicate-task";
    severity: "error" | "warning";
    outputId: string;
    sourceId?: string;
}
export interface MetricResult {
    criterion: Criterion;
    score: number | null;
    method: "judge" | "judge+integrity" | "weighted-expectations";
    reason: string;
    evidence: Evidence[];
}
export interface EvaluationReport {
    version: typeof EVALUATION_VERSION | typeof SCOPED_EVALUATION_VERSION;
    rubricVersion: typeof RUBRIC_VERSION | typeof SCOPED_RUBRIC_VERSION;
    scenarioId: string;
    scenarioVersion: string;
    scenarioFingerprint: string;
    candidateId: string;
    pipelineVersion: string;
    inputFingerprint: string;
    contextCompleteness: EvaluationInput["scenario"]["contextCompleteness"];
    scopedEvidence?: ScopedEvidenceDependency[];
    judge: { kind: ValidationJudge["kind"] | "none"; id: string | null };
    status: "assessed" | "partial" | "unavailable";
    verdict: "pass" | "fail" | "needs-review";
    metrics: MetricResult[];
    expectations: Array<
        | Judgment["expectations"][number]
        | {
              expectationId: string;
              verdict: "unassessed";
              reason: string;
              evidence: Evidence[];
          }
    >;
    integrityIssues: IntegrityIssue[];
    overallScore: number | null;
    error:
        | "no-judge"
        | "timeout"
        | "cancelled"
        | "provider-error"
        | "invalid-judgment"
        | "judge-setup"
        | null;
    usage: ChatTokenUsage | null;
    durationMs: number;
}
