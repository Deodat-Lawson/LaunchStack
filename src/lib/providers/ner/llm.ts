import type { ProviderResult } from "../types";
import type { NERProvider, NERResult, ChunkEntities } from "./index";
import { TOKEN_COSTS } from "~/lib/credits/costs";
import { resolveBaseUrl, resolveApiKey, resolveModel } from "../registry";
import OpenAI from "openai";

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
 * Works with OpenAI, SiliconFlow (Qwen3.5-4B free), DeepSeek, etc.
 */
export class LLMNERProvider implements NERProvider {
    name: string;
    private client: OpenAI;
    private model: string;

    constructor() {
        const baseURL = resolveBaseUrl(
            process.env.NER_API_BASE_URL,
            "https://api.openai.com/v1",
        );
        const apiKey = resolveApiKey(
            process.env.NER_API_KEY,
            process.env.OPENAI_API_KEY,
        );
        this.model = resolveModel(
            process.env.NER_MODEL,
            "gpt-4o-mini",
        );
        this.name = `ner:${this.model}`;

        this.client = new OpenAI({ apiKey, baseURL });
    }

    async extract(chunks: string[]): Promise<ProviderResult<NERResult>> {
        const results: ChunkEntities[] = [];
        let totalEntities = 0;

        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);
            const batchResults = await this.extractBatch(batch);
            results.push(...batchResults);
            totalEntities += batchResults.reduce(
                (sum, r) => sum + r.entities.length,
                0
            );
        }

        return {
            data: { results, totalEntities },
            usage: {
                tokensUsed: chunks.length * TOKEN_COSTS.ner,
                details: { chunks: chunks.length, totalEntities },
            },
        };
    }

    private async extractBatch(chunks: string[]): Promise<ChunkEntities[]> {
        const numberedChunks = chunks
            .map((c, i) => `--- Chunk ${i + 1} ---\n${c.slice(0, 2048)}`)
            .join("\n\n");

        const userPrompt =
            chunks.length === 1
                ? `Extract entities from this text:\n\n${chunks[0]!.slice(0, 2048)}`
                : `Extract entities from each chunk below. Return a JSON array where each element corresponds to a chunk and contains an "entities" array.\n\n${numberedChunks}`;

        const response = await this.client.chat.completions.create({
            model: this.model,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: NER_SYSTEM_PROMPT },
                { role: "user", content: userPrompt },
            ],
        });

        const usage = response.usage;
        if (usage) {
            console.log(
                `[NER] ${this.name}: ${chunks.length} chunks, ${usage.prompt_tokens} prompt + ${usage.completion_tokens} completion = ${usage.total_tokens} tokens`
            );
        }

        const content = response.choices[0]?.message?.content ?? "{}";

        try {
            const parsed = JSON.parse(content) as
                | { entities: Array<{ text: string; label: string; score: number }> }
                | { chunks: Array<{ entities: Array<{ text: string; label: string; score: number }> }> }
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
            return chunks.map((text) => ({ text, entities: [] }));
        }
    }
}
