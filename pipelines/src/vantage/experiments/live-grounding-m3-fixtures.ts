/** Deliberately authored HTTP fixtures for PREPARATION ONLY. Not model quality or independent semantic evidence. */
import type { M3GroundingInput } from "./live-grounding-m3";
import type { M3OfflineResponse } from "./live-grounding-m3-transport";
import { buildFinanceMilestoneCompound } from "./finance-milestone-v1";
export type M3OfflineVariant =
    | "corrected"
    | "paraphrase"
    | "omission"
    | "native-only-source"
    | "judge-wrong-id"
    | "judge-low-grounding"
    | "judge-timeout"
    | "generation-429"
    | "generation-500"
    | "generation-redirect"
    | "generation-malformed";
import { z } from "zod";
import {
    EvaluationInputSchema,
    RATED_CRITERIA,
    type EvaluationInput,
    type Evidence,
    type Judgment,
    type OutputUnit,
} from "../validation/contracts";
type Target = EvaluationInput["scenario"]["expectations"][number];
const judgePayloadSchema = z.object({
    scenario: EvaluationInputSchema.shape.scenario,
    outputUnits: z.array(
        z.object({ id: z.string(), text: z.string(), sourceIds: z.array(z.string()) })
    ),
});
function completion(model: string, result: unknown) {
    return {
        status: 200,
        body: {
            id: "m3-offline-fixture",
            object: "chat.completion",
            created: 0,
            model,
            choices: [
                {
                    index: 0,
                    message: { role: "assistant", content: JSON.stringify(result) },
                    finish_reason: "stop",
                },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
        },
    };
}
export function createM3OfflineProviderFixture(options: {
    input: M3GroundingInput;
    variant: M3OfflineVariant;
}) {
    return async (request: {
        kind: "generation" | "judge";
        requestId: string;
        body: Record<string, unknown>;
    }): Promise<M3OfflineResponse> => {
        const model = request.body.model;
        if (typeof model !== "string")
            throw new Error("Offline fixture requires the actual SDK wire model");
        if (request.kind === "generation") {
            if (options.variant === "generation-429" || options.variant === "generation-500")
                return {
                    status: options.variant === "generation-429" ? 429 : 500,
                    body: {
                        error: {
                            code: "synthetic-provider-failure",
                            message: "Synthetic offline fault",
                        },
                    },
                };
            if (options.variant === "generation-redirect")
                return {
                    status: 302,
                    body: { error: { code: "synthetic-redirect" } },
                    headers: { location: "https://blocked-external.invalid/never-follow" },
                };
            if (options.variant === "generation-malformed") {
                const response = completion(model, {});
                response.body.choices[0]!.message.content = "{invalid-json";
                return response;
            }
            const compound = buildFinanceMilestoneCompound(
                options.input.envelope,
                options.input.sourceRefs,
                options.variant === "omission" ? "omission" : "corrected"
            );
            if (options.variant === "paraphrase")
                compound.experimental.topics[0]!.facts[0]!.text =
                    "Finance reports provisional October revenue of USD 12,000; refunds remain unreconciled.";
            if (options.variant === "native-only-source") {
                const source = options.input.envelope.v1Input.data.currentEvidence.find(
                    item =>
                        item.body ===
                        options.input.envelope.evidenceSnapshot.entries.find(
                            entry =>
                                entry.source.id === options.input.sourceRefs.sales.id &&
                                entry.source.version === options.input.sourceRefs.sales.version
                        )?.excerpt
                );
                if (!source)
                    throw new Error("Native negative fixture requires the actual Sales copy");
                const text =
                    "Sales is the only supplied financial source; its October revenue is verified at USD 18,000.";
                compound.native = {
                    summary: text,
                    topics: [
                        {
                            title: "Use the Sales figure",
                            facts: [{ text, refs: [`ev:${source.id}`] }],
                            whyItMatters: "A revenue figure is needed.",
                            decisionQuestion: "Which revenue figure should be used?",
                            proposedNextStep: "Use the reported figure.",
                            proposedOwner: null,
                            proposedDueInDays: null,
                            helpRequested: null,
                            unknowns: [],
                            conflicts: [],
                            rationale: "Synthetic semantic negative control.",
                        },
                    ],
                    enhancements: [],
                };
            }
            return completion(model, compound);
        }
        if (options.variant === "judge-timeout")
            await new Promise(resolve => setTimeout(resolve, 30000));
        const payload = (request.body.messages as { content?: unknown }[])
            .flatMap(message => {
                if (typeof message.content !== "string") return [];
                try {
                    const parsed = judgePayloadSchema.safeParse(
                        JSON.parse(message.content) as unknown
                    );
                    return parsed.success ? [parsed.data] : [];
                } catch {
                    return [];
                }
            })
            .find(value => value.scenario && value.outputUnits);
        if (!payload)
            throw new Error("Offline Judge fixture requires actual scenario and output-unit IDs");
        const scenario = payload.scenario;
        const units = payload.outputUnits;
        const sourceEvidence = (target: Target): Evidence[] =>
            target.evidence.map(e => ({ kind: "source", id: e.sourceId, quote: e.quote }));
        const select = (predicate: (unit: OutputUnit) => boolean) =>
            units.find(predicate) ?? units[0]!;
        const ordinaryOutput = select(unit => unit.sourceIds?.length > 0);
        const nativeViolation = units.find(unit =>
            unit.text.includes("only supplied financial source")
        );
        const expectations: Judgment["expectations"] = scenario.expectations.map(target => {
            const missing =
                options.variant === "omission" &&
                ["finance-definition", "reconciliation"].includes(target.id);
            const violated =
                options.variant === "native-only-source" &&
                ["no-only-source-certainty", "no-verified-choice"].includes(target.id);
            const verdict = missing ? "missed" : violated ? "violated" : "met";
            const chosen = violated
                ? nativeViolation!
                : target.id === "finance-definition"
                  ? select(unit => unit.text.includes("12,000"))
                  : target.id === "sales-definition"
                    ? select(unit => unit.text.includes("18,000"))
                    : ordinaryOutput;
            const evidence = sourceEvidence(target);
            if ((target.kind === "must_include" && !missing) || violated)
                evidence.push({ kind: "output", id: chosen.id, quote: chosen.text });
            return {
                expectationId: target.id,
                verdict,
                reason: "Deliberately authored offline calibration verdict; not a live semantic assessment.",
                evidence,
            };
        });
        const source = scenario.documents.find(
            doc => doc.id === scenario.expectations[0]!.evidence[0]!.sourceId
        )!;
        const ratings: Judgment["ratings"] = RATED_CRITERIA.map(criterion => ({
            criterion,
            score: options.variant === "judge-low-grounding" && criterion === "grounding" ? 3 : 4,
            reason: "Authored offline calibration rating; no quality conclusion about a real model.",
            evidence: [
                { kind: "output" as const, id: ordinaryOutput.id, quote: ordinaryOutput.text },
                ...(["grounding", "temporal"].includes(criterion)
                    ? [{ kind: "source" as const, id: source.id, quote: source.text }]
                    : []),
            ],
        }));
        if (options.variant === "judge-wrong-id")
            ratings[0]!.evidence[1]!.id = scenario.expectations[0]!.id;
        return completion(model, { expectations, ratings });
    };
}
