import { z } from "zod";
import { JudgmentSchema, type JudgeRequest } from "./contracts";
import { fingerprint, outputUnits } from "./input";

/** Internal transport revision, not a changed scoring rubric or evaluation DTO. */
export const JUDGE_EVIDENCE_TRANSPORT_VERSION = "exact-evidence-locations/v2" as const;

/**
 * Bind each evidence namespace to its actual input IDs before the model sees the
 * schema. No aliases, inferred IDs, or replacement citations are introduced.
 * Verbatim quote validation still runs after this structural constraint.
 */
export function judgmentSchemaFor(request: JudgeRequest) {
    if (fingerprint(request.outputUnits) !== fingerprint(outputUnits(request.input)))
        throw new Error("Judge output-unit locations do not match the actual input.");
    const exactIds = (ids: string[]) => z.enum([...new Set(ids)] as [string, ...string[]]);
    const sourceIds = request.input.scenario.documents.map(source => source.id);
    const outputIds = request.outputUnits.map(unit => unit.id);
    if (!sourceIds.length || !outputIds.length)
        throw new Error("Judge evidence requires actual source and output locations.");
    const quote = JudgmentSchema.shape.ratings.element.shape.evidence.element.shape.quote;
    const evidence = z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("source"), id: exactIds(sourceIds), quote }).strict(),
        z.object({ kind: z.literal("output"), id: exactIds(outputIds), quote }).strict(),
    ]);
    return JudgmentSchema.extend({
        expectations: z
            .array(
                JudgmentSchema.shape.expectations.element.extend({
                    expectationId: exactIds(
                        request.input.scenario.expectations.map(item => item.id)
                    ),
                    evidence: z.array(evidence).max(8),
                })
            )
            .max(16),
        ratings: z
            .array(
                JudgmentSchema.shape.ratings.element.extend({ evidence: z.array(evidence).max(8) })
            )
            .length(5),
    });
}

export const JUDGE_EVIDENCE_INSTRUCTIONS = `Evidence address rules:
- kind=source: id MUST be exactly a scenario.documents[].id, and quote MUST be a verbatim substring of that document's text.
- kind=output: id MUST be exactly an outputUnits[].id, and quote MUST be a verbatim substring of that unit's text.
- expectationId identifies an assessment target, not a source or output. Never use it as an evidence address unless that exact ID independently exists in the appropriate evidence collection.
- Never add a prefix, paraphrase a quotation, change whitespace, or infer an alias. An unknown address or non-verbatim quote invalidates the assessment. Use uncertain/null when evidence cannot support a judgment; do not invent evidence.
- Source availableAt is availability metadata, not proof of publication, event execution or policy validity. Recommendation confidence is not automatically confidence in the underlying business outcome.`;
