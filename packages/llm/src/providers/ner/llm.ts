import type { ProviderResult } from "../types";
import type { NERProvider, NERResult, ChunkEntities } from "./index";
import { getCapabilityConfig, resolveEndpoint, resolveModel } from "../registry";
import { GEMINI_FAST_MODEL } from "../../types";
import {
    auxiliaryRequestFields,
    resolveAuxiliaryModel,
    type AuxiliaryModel,
} from "../../auxiliary-model";
import { getChatModelsSource } from "../../chat-scope";
import { extractJson } from "../../structured-output";
import OpenAI from "openai";

/**
 * Token cost per NER chunk (~500 tokens of prompt + completion averaged).
 * LLM responses do return usage, but we bill a flat rate per chunk for
 * predictability and to match the historical cost table.
 */
const NER_TOKENS_PER_CHUNK = 500;

const NER_SYSTEM_PROMPT = `You are a named entity recognition (NER) system. Extract entities from the given text.

For each entity found, provide:
- "text": the entity text as it appears
- "label": one of PER, ORG, LOC, DATE, MONEY, EVENT, PRODUCT, LAW, MISC
- "score": your confidence from 0.0 to 1.0

Return a JSON array of entities. If no entities are found, return an empty array.
Only return the JSON array, no other text.`;

const BATCH_SIZE = 5;

/**
 * LLM-based NER provider using OpenAI-compatible chat completions.
 * Defaults to Gemini; works equally against SiliconFlow, DeepSeek, OpenAI or
 * anything else implementing the protocol, via NER_API_BASE_URL.
 *
 * That is the deployment's setting. Extraction run in the scope of a
 * workspace that brought its own model goes to the workspace's fast model
 * instead, bills no LaunchStack credits (the workspace pays its provider),
 * and fails when that model can't be used rather than falling back here.
 */
export class LLMNERProvider implements NERProvider {
    private deploymentName: string;
    private client: OpenAI;
    private model: string;

    /** Names whose model a call here would use, so the logs never claim the server's. */
    get name(): string {
        return getChatModelsSource() === "workspace" ? "ner:workspace" : this.deploymentName;
    }

    constructor() {
        // Endpoint and credential come back as a pair, so a key is never sent
        // to a service it does not belong to. Defaults to Gemini when the
        // operator names no endpoint. The NER_API_* values arrive through
        // configureProviders() — this module reads no process.env (ADR-002).
        const ner = getCapabilityConfig("ner");
        const { baseUrl: baseURL, apiKey } = resolveEndpoint(ner.baseUrl, ner.apiKey);
        this.model = resolveModel(ner.model, GEMINI_FAST_MODEL);
        this.deploymentName = `ner:${this.model}`;

        this.client = new OpenAI({ apiKey, baseURL });
    }

    /** The deployment's NER model, or the workspace's fast model when its scope is in force. */
    private modelForThisWork(): AuxiliaryModel {
        const own = resolveAuxiliaryModel("fast");
        if (own.owner === "deployment") {
            return { owner: "deployment", client: this.client, modelId: this.model };
        }
        if (!own.model) {
            throw new Error(`Entity extraction can't use the workspace's own model: ${own.reason}`);
        }
        return own.model;
    }

    async extract(chunks: string[]): Promise<ProviderResult<NERResult>> {
        const model = this.modelForThisWork();
        const label = model.owner === "workspace" ? "ner:workspace" : this.deploymentName;
        const results: ChunkEntities[] = [];
        let totalEntities = 0;

        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);
            const batchResults = await this.extractBatch(batch, model, label);
            results.push(...batchResults);
            totalEntities += batchResults.reduce((sum, r) => sum + r.entities.length, 0);
        }

        return {
            data: { results, totalEntities },
            usage: {
                // Zero skips the credit debit: the workspace's provider bills it.
                tokensUsed: model.owner === "workspace" ? 0 : chunks.length * NER_TOKENS_PER_CHUNK,
                details: { chunks: chunks.length, totalEntities },
            },
        };
    }

    private async extractBatch(
        chunks: string[],
        model: AuxiliaryModel,
        label: string
    ): Promise<ChunkEntities[]> {
        const numberedChunks = chunks
            .map((c, i) => `--- Chunk ${i + 1} ---\n${c.slice(0, 2048)}`)
            .join("\n\n");

        const userPrompt =
            chunks.length === 1
                ? `Extract entities from this text:\n\n${chunks[0]!.slice(0, 2048)}`
                : `Extract entities from each chunk below. Return a JSON array where each element corresponds to a chunk and contains an "entities" array.\n\n${numberedChunks}`;

        const response = await model.client.chat.completions.create({
            model: model.modelId,
            ...auxiliaryRequestFields(model, { temperature: 0, json: true }),
            messages: [
                { role: "system", content: NER_SYSTEM_PROMPT },
                { role: "user", content: userPrompt },
            ],
        });

        const usage = response.usage;
        if (usage) {
            console.log(
                `[NER] ${label}: ${chunks.length} chunks, ${usage.prompt_tokens} prompt + ${usage.completion_tokens} completion = ${usage.total_tokens} tokens`
            );
        }

        const content = response.choices[0]?.message?.content ?? "{}";

        try {
            // Lenient: a workspace's model without JSON mode may fence its answer.
            const parsed = extractJson(content) as
                | { entities: Array<{ text: string; label: string; score: number }> }
                | {
                      chunks: Array<{
                          entities: Array<{ text: string; label: string; score: number }>;
                      }>;
                  }
                | Array<{ text: string; label: string; score: number }>;

            if (chunks.length === 1) {
                const entities = Array.isArray(parsed)
                    ? parsed
                    : "entities" in parsed
                      ? parsed.entities
                      : [];
                return [{ text: chunks[0]!, entities }];
            }

            if ("chunks" in parsed && Array.isArray(parsed.chunks)) {
                return chunks.map((text, i) => ({
                    text,
                    entities: parsed.chunks[i]?.entities ?? [],
                }));
            }

            const allEntities = Array.isArray(parsed)
                ? parsed
                : "entities" in parsed
                  ? parsed.entities
                  : [];
            return chunks.map((text, i) => ({
                text,
                entities: i === 0 ? allEntities : [],
            }));
        } catch {
            console.warn("[LLM-NER] Failed to parse response, returning empty entities");
            return chunks.map(text => ({ text, entities: [] }));
        }
    }
}
