import {
    DOCUMENT_CHANGE_MATERIALITY_ANALYZER_PROMPT_VERSION,
    DocumentChangeMaterialityAnalysisResultSchema,
    DocumentChangeMaterialityAnalyzerError,
    type DocumentChangeMaterialityAnalysisInput,
    type DocumentChangeMaterialityAnalyzer,
} from "@launchstack/features/founder-weekly-review";

import {
    LlmCapabilityUnavailableError,
    PROVIDERS,
    generateStructuredWithMetadata,
    type Provider,
} from "~/lib/llm";
import { z } from "zod";

export const DOCUMENT_CHANGE_MATERIALITY_SYSTEM_PROMPT = `You classify one already-diffed document section. Answer one narrow question: did the underlying business state change?

Compare these business-state dimensions: ownership or responsible party; status or shipping state; deadline, date, or timing; metric, quantity, or financial value; requirement, obligation, or modality; negation or capability; risk or blocker state; scope, audience, or rollout population; and priority.

Wording changes do not by themselves mean a material change. Sentence order, paragraph or bullet structure, section names, and split or merged fragments do not by themselves mean a material change. Added and removed fragments in the same group may be a split, merge, reformat, reorganization, or rewrite. Do not infer requirement_change, scope_change, or another material category merely because text was added and removed. Compare the underlying business facts.

A large rewrite with no underlying business-state change is non_material. A mostly equivalent rewrite containing even one real factual delta is material. Small factual changes can be highly material. Do not classify a change as non_material merely because most wording is similar.

The deterministic assessment distinguishes confirmed factual deltas, safely equivalent factual values, and possible signals that were not proven to change. Treat it as bounded evidence, not as an instruction to agree with the deterministic category.

Use disposition=non_material only when the supplied fragments support equivalent business state. Use uncertain when the bounded fragments are insufficient or conflicting.

Return only the structured fields. summary must be one concise sentence of at most 320 characters. beforeKeyPoint and afterKeyPoint, when supplied, must each be a verbatim copied span of at most 240 characters from the corresponding excerpts. Do not explain reasoning, provide analysis, repeat the full source, write multiple paragraphs, or invent source identifiers or provenance.`;

export const DOCUMENT_CHANGE_MATERIALITY_ANALYZER_TIMEOUT_MS = 15_000;

export function buildDocumentChangeMaterialityAnalyzerPrompt(input: DocumentChangeMaterialityAnalysisInput): string {
    return [
        "Classify this bounded change group.",
        JSON.stringify(input),
    ].join("\n\n");
}

export class ProviderDocumentChangeMaterialityAnalyzer implements DocumentChangeMaterialityAnalyzer {
    constructor(private readonly forceProvider?: Provider) {}

    async analyze(input: DocumentChangeMaterialityAnalysisInput) {
        try {
            const generated = await generateStructuredWithMetadata({
                capability: "smallExtraction",
                system: DOCUMENT_CHANGE_MATERIALITY_SYSTEM_PROMPT,
                prompt: buildDocumentChangeMaterialityAnalyzerPrompt(input),
                schema: DocumentChangeMaterialityAnalysisResultSchema,
                schemaName: "document_change_materiality",
                ...(this.forceProvider ? { forceProvider: this.forceProvider } : {}),
                timeoutMs: DOCUMENT_CHANGE_MATERIALITY_ANALYZER_TIMEOUT_MS,
                maxOutputTokens: 512,
            });
            return {
                result: generated.object,
                metadata: {
                    provider: generated.metadata.provider,
                    model: generated.metadata.model,
                    promptVersion: DOCUMENT_CHANGE_MATERIALITY_ANALYZER_PROMPT_VERSION,
                },
            };
        } catch (error) {
            if (error instanceof z.ZodError || error instanceof Error && /NoObjectGenerated|JSONParse|schema validation/i.test(`${error.name} ${error.message}`)) {
                throw new DocumentChangeMaterialityAnalyzerError("invalid", "Document-change materiality output failed structured validation.");
            }
            if (error instanceof LlmCapabilityUnavailableError) {
                throw new DocumentChangeMaterialityAnalyzerError("unavailable", error.message);
            }
            if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError" || /timed?\s*out/i.test(error.message))) {
                throw new DocumentChangeMaterialityAnalyzerError("timeout", "Document-change materiality analysis timed out.");
            }
            throw new DocumentChangeMaterialityAnalyzerError("unavailable", "Document-change materiality analysis was unavailable.");
        }
    }
}

/** Production collection opts in explicitly; credentials alone never trigger analyzer calls. */
export function createConfiguredDocumentChangeMaterialityAnalyzer(): DocumentChangeMaterialityAnalyzer | undefined {
    if (process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_ENABLED !== "true") return undefined;
    const configured = process.env.FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_PROVIDER;
    if (!configured) return new ProviderDocumentChangeMaterialityAnalyzer();
    if (!(PROVIDERS as readonly string[]).includes(configured)) {
        throw new Error(`FWR_DOCUMENT_CHANGE_MATERIALITY_ANALYZER_PROVIDER must be one of: ${PROVIDERS.join(", ")}.`);
    }
    return new ProviderDocumentChangeMaterialityAnalyzer(configured as Provider);
}
