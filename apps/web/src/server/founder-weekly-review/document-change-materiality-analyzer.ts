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

const MATERIALITY_SYSTEM_PROMPT = `You classify one already-diffed document section. Answer only this question: did the underlying business meaning materially change?

Pay special attention to ownership, status or shipping, dates and deadlines, metrics, requirements or modality, negation, blockers or risks, scope, priority, customer or rollout scope, and meaning-preserving paraphrases or editorial rewrites.

Do not classify a rewrite as material merely because wording changed.
Do not classify a change as non-material merely because wording is similar.
Small factual changes can be highly material.

Use disposition=non_material only when the supplied fragments support meaning-preserving editorial or formatting change. Use uncertain when the fragments are insufficient. Keep summary factual and concise. beforeKeyPoint and afterKeyPoint, when supplied, must be copied verbatim from the corresponding input excerpts. Never invent source identifiers or provenance.`;

export const DOCUMENT_CHANGE_MATERIALITY_ANALYZER_TIMEOUT_MS = 15_000;

function promptFor(input: DocumentChangeMaterialityAnalysisInput): string {
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
                system: MATERIALITY_SYSTEM_PROMPT,
                prompt: promptFor(input),
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
