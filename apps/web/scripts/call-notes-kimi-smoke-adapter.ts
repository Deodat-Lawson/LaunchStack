/**
 * Developer-only Kimi adapter for the opt-in Call Notes live smoke.
 * This file intentionally does not participate in production dependency
 * injection or the configured reasoning route.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
    createChatModelsConfig,
    invokeStructured,
    resolveChatModel,
    type ResolvedChatModel,
} from "@launchstack/core/llm";
import {
    EnrichedNoteProposalSchema,
    EnrichmentInputSchema,
    EnrichmentResultSchema,
    type EnrichmentInput,
    type EnrichmentModel,
    type EnrichmentResult,
} from "@launchstack/features/call-notes";

import {
    buildCallNotesEnrichmentPrompt,
    CALL_NOTES_ENRICHMENT_PROMPT_VERSION,
    CALL_NOTES_ENRICHMENT_SYSTEM_PROMPT,
} from "../src/server/call-notes/enrichment-prompts";
import { validateEnrichmentProvenance } from "../src/server/call-notes/enrichment-validation";

export const KIMI_SMOKE_DEFAULT_BASE_URL = "https://api.moonshot.ai/v1" as const;
export const KIMI_SMOKE_DEFAULT_MODEL = "kimi-k2.6" as const;

export interface KimiSmokeConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
}

function nonEmpty(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    return trimmed;
}

export function readKimiSmokeConfig(environment: NodeJS.ProcessEnv = process.env): KimiSmokeConfig {
    const apiKey = nonEmpty(environment.KIMI_API_KEY);
    if (!apiKey) {
        throw new Error("KIMI_API_KEY is required for the Kimi smoke.");
    }

    return {
        baseUrl: nonEmpty(environment.KIMI_BASE_URL) ?? KIMI_SMOKE_DEFAULT_BASE_URL,
        apiKey,
        model: nonEmpty(environment.KIMI_MODEL) ?? KIMI_SMOKE_DEFAULT_MODEL,
    };
}

function createKimiChatConfig(config: KimiSmokeConfig) {
    const yaml = `version: 1
models:
  kimi:
    id: ${JSON.stringify(config.model)}
    behavior:
      input: [text]
      reasoning:
        mode: always
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: unsupported
        maxOutputTokens: supported
routes:
  default: kimi
  reasoning: kimi
`;

    return createChatModelsConfig({
        yaml,
        endpoint: { baseUrl: config.baseUrl, apiKey: config.apiKey },
        sourceLabel: "developer Kimi Call Notes smoke configuration",
    });
}

export class KimiSmokeEnrichmentModel implements EnrichmentModel {
    readonly providerLabel = "kimi-smoke" as const;
    readonly modelId: string;
    readonly structuredOutputPath = "validated JSON fallback" as const;
    private readonly resolved: ResolvedChatModel;
    private _providerRequestAttempted = false;

    constructor(config: KimiSmokeConfig) {
        this.resolved = resolveChatModel({
            route: "reasoning",
            config: createKimiChatConfig(config),
        });
        this.modelId = this.resolved.modelId;
    }

    get providerRequestAttempted(): boolean {
        return this._providerRequestAttempted;
    }

    async generate(rawInput: EnrichmentInput): Promise<EnrichmentResult> {
        const input = EnrichmentInputSchema.parse(rawInput);
        this._providerRequestAttempted = true;

        const proposal = await invokeStructured(
            this.resolved,
            EnrichedNoteProposalSchema,
            [
                new SystemMessage(CALL_NOTES_ENRICHMENT_SYSTEM_PROMPT),
                new HumanMessage(buildCallNotesEnrichmentPrompt(input)),
            ],
            { name: "call_notes_enrichment_v1" }
        );
        const validatedProposal = validateEnrichmentProvenance(input, proposal);

        return EnrichmentResultSchema.parse({
            proposal: validatedProposal,
            modelMetadata: {
                model: this.modelId,
                promptVersion: CALL_NOTES_ENRICHMENT_PROMPT_VERSION,
            },
        });
    }
}
