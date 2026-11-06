/** Read-only semantic diagnostic transport; it can never validate or repair a Generation result. */
import { z } from "zod";
import { GenerationOutputSchemaV2 } from "../generation-v2-schema";
import { contextSourceKeyV0, type ContextSourceRefV0 } from "../proposals/context-v0";
import type { ContextGenerationEnvelopeV0 } from "../context-v0/ports";
import type {
    PreparedJosephScenario,
    JosephSemanticCase,
} from "../evaluation-integration/joseph-adapter";
import type { EvaluationInput } from "../validation/contracts";
import { checkOutputIntegrity } from "../validation/evaluate";
import { fingerprint, parseEvaluationInput } from "../validation/input";
import { attachLivePilotEvaluation } from "./pilot-context";

export const DIAGNOSTIC_EVALUATION_VERSION = "vantage-observed-v21-semantic-diagnostic/v1" as const;
const reference = z.union([
    z.string().min(1).max(300),
    z
        .object({
            kind: z.enum(["ev", "obs", "cm", "doc", "company", "public"]),
            id: z.string().min(1),
            version: z.string().min(1),
        })
        .strict(),
]);
const observedText = z.string().max(6000);
const rawSchema = z
    .object({
        headline: observedText.optional(),
        brief: observedText.optional(),
        keyFigures: z
            .array(
                z
                    .object({
                        refs: z.array(reference).max(12).optional(),
                        derivation: z
                            .object({
                                inputs: z.array(z.object({ ref: reference }).passthrough()).max(8),
                            })
                            .passthrough()
                            .optional(),
                    })
                    .passthrough()
            )
            .max(30)
            .optional(),
        topics: z
            .array(
                z
                    .object({
                        whyNow: observedText.optional(),
                        recommendation: z
                            .object({
                                call: observedText.optional(),
                                confidence: observedText.optional(),
                                because: observedText.optional(),
                                wouldChangeIf: observedText.optional(),
                                refs: z.array(reference).max(12).optional(),
                            })
                            .passthrough()
                            .nullable()
                            .optional(),
                    })
                    .passthrough()
            )
            .max(10),
    })
    .passthrough();

type Reference = z.infer<typeof reference>;
export interface DiagnosticUnit {
    fieldPath: string;
    outputId: string;
    category: "presentation" | "factual" | "temporal-relevance" | "recommendation";
    text: string;
    sourceIds: string[];
}
const sourceId = (ref: Reference) =>
    typeof ref === "string" ? ref : contextSourceKeyV0(ref as ContextSourceRefV0);

/**
 * Keep parseable observed text assessable even when delivery constraints failed.
 * No trimming, citation inference, ref repair, retry or model invocation occurs.
 * Unknown/unversioned refs stay unknown so Sophia's deterministic checks reject them.
 */
export function buildDiagnosticEvaluation(
    prepared: PreparedJosephScenario,
    scenario: JosephSemanticCase,
    rawExperimental: unknown,
    envelope: ContextGenerationEnvelopeV0,
    identity: { id: string; pipelineVersion: string }
) {
    const rawText = JSON.stringify(rawExperimental);
    if (!rawText || Buffer.byteLength(rawText, "utf8") > 64000)
        throw new Error("Diagnostic raw output exceeds 64000 bytes; nothing was truncated.");
    const observed = rawSchema.parse(rawExperimental);
    const originalFigures = (rawExperimental as { keyFigures?: unknown[] }).keyFigures ?? [];
    const structural = GenerationOutputSchemaV2.safeParse(rawExperimental);
    // The unchanged legacy adapter selects the original V1 fields; it does not
    // assert that the original V2 delivery or semantic checks passed.
    const base = attachLivePilotEvaluation(prepared, scenario, rawExperimental, envelope, identity);
    const actual = structuredClone(base.input.actual);
    const units: DiagnosticUnit[] = [];
    const add = (
        fieldPath: string,
        category: DiagnosticUnit["category"],
        text: string | undefined,
        refs: readonly Reference[] = [],
        topicId = actual.tasks[0]?.id ?? "report"
    ) => {
        if (text === undefined) return;
        const id = `v21-observed-${fieldPath.replace(/[^a-zA-Z0-9-]/g, "-")}`;
        const kind = category === "factual" ? "evidence" : "idea";
        const sourceIds = refs.map(sourceId);
        actual.enhancements.push({ id, topicId, kind, text, rationale: "", sourceIds });
        units.push({
            fieldPath,
            outputId: `enhancement/${id}/${kind}`,
            category,
            text,
            sourceIds: [...sourceIds],
        });
    };
    add("headline", "presentation", observed.headline);
    add("brief", "presentation", observed.brief);
    observed.keyFigures?.forEach((figure, index) =>
        add(`keyFigures[${index}]`, "factual", JSON.stringify(originalFigures[index]), [
            ...(figure.refs ?? []),
            ...(figure.derivation?.inputs.map(item => item.ref) ?? []),
        ])
    );
    observed.topics.forEach((topic, index) => {
        const topicId = actual.tasks[index]?.id ?? `observed-topic-${index + 1}`;
        add(`topics[${index}].whyNow`, "temporal-relevance", topic.whyNow, [], topicId);
        if (topic.recommendation) {
            for (const field of ["call", "confidence", "because", "wouldChangeIf"] as const)
                add(
                    `topics[${index}].recommendation.${field}`,
                    "recommendation",
                    topic.recommendation[field],
                    topic.recommendation.refs ?? [],
                    topicId
                );
        }
    });
    if (actual.enhancements.length > 30)
        throw new Error(
            "Diagnostic projection exceeds 30 evaluation enhancement units; nothing was truncated."
        );
    const input: EvaluationInput = parseEvaluationInput({ ...base.input, actual });
    return {
        diagnosticOnly: true as const,
        generationValidated: false as const,
        input,
        sidecar: {
            ...base.sidecar,
            diagnostic: {
                version: DIAGNOSTIC_EVALUATION_VERSION,
                diagnosticOnly: true as const,
                generationValidated: false as const,
                originalRawExperimental: structuredClone(rawExperimental),
                originalRawFingerprint: fingerprint(rawExperimental),
                originalLegacyInputFingerprint: fingerprint(base.input),
                diagnosticInputFingerprint: fingerprint(input),
                structuralSchemaIssues: structural.success
                    ? []
                    : structuredClone(structural.error.issues),
                schemaIssueScope:
                    "GenerationOutputSchemaV2 structural constraints only; not full Generation normalization, event-state, numerical grounding or successful delivery validation.",
                citationIntegrityIssues: checkOutputIntegrity(input),
                units,
                limitations: [
                    "This is an observed-output semantic diagnostic, never validated Generation or fallback success.",
                    "Exact original text is preserved; overlong fields and unknown references were not repaired.",
                    "Only declared references are transported. No citations are invented for headline/brief/whyNow or missing refs.",
                    "Evaluation-only enhancement addresses are not new product suggestions or accepted commitments.",
                    "A semantic Judge can assess the observed content independently; that does not erase delivery failures.",
                ],
            },
        },
    };
}
