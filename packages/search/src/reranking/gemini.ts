import type { ProviderResult } from "@launchstack/llm/providers";
import type { RerankProvider, RerankResult } from "./index";
import { getCapabilityConfig, resolveEndpoint, resolveModel } from "@launchstack/llm/providers/registry";
import { GEMINI_FAST_MODEL } from "@launchstack/llm/types";

/**
 * Reranking on a chat model.
 *
 * Google serves no `/rerank` endpoint — not on the Gemini API, not on the
 * OpenAI-compatibility layer — so relevance is scored by asking a fast chat
 * model directly. This is slower and costlier per query than a purpose-built
 * cross-encoder like the ones dedicated rerank APIs run, and the scores are a
 * model's judgement rather than a calibrated distance.
 *
 * It is the default because it needs no second vendor. Deployments that care
 * about rerank latency should point RERANK_API_BASE_URL at a dedicated
 * `/v1/rerank` service, which {@link ./rerank-api} handles.
 */

/** Billing rate per query; the chat response's own usage is preferred when present. */
const RERANK_TOKENS_PER_QUERY = 200;

/**
 * Documents are truncated before scoring. Relevance is nearly always decided
 * by the opening of a chunk, and sending whole documents would make a rerank
 * cost more than the generation it feeds.
 */
const MAX_DOCUMENT_CHARS = 1_200;

const SYSTEM_PROMPT =
    "You score how well each document answers a query. Respond with JSON " +
    'only: {"scores":[n, ...]} where each n is between 0 and 1, 1 meaning ' +
    "the document fully answers the query and 0 meaning it is irrelevant. " +
    "Return exactly one score per document, in the order the documents were " +
    "given. Do not explain.";

const SCORES_SCHEMA = {
    type: "object",
    properties: {
        scores: { type: "array", items: { type: "number" } },
    },
    required: ["scores"],
    additionalProperties: false,
} as const;

export class GeminiRerankProvider implements RerankProvider {
    name: string;
    private baseUrl: string;
    private apiKey: string;
    private model: string;

    constructor() {
        // RERANK_API_* values arrive through configureProviders() — this
        // module reads no process.env (ADR-002).
        const rerank = getCapabilityConfig("rerank");
        const endpoint = resolveEndpoint(rerank.baseUrl, rerank.apiKey);
        this.baseUrl = endpoint.baseUrl;
        this.apiKey = endpoint.apiKey;
        this.model = resolveModel(rerank.model, GEMINI_FAST_MODEL);
        this.name = `rerank:${this.model}`;

        if (!this.apiKey) {
            console.warn(
                "[Rerank] No API key found. Set GOOGLE_AI_API_KEY, or " +
                    "RERANK_API_KEY alongside RERANK_API_BASE_URL."
            );
        }
    }

    async rerank(query: string, documents: string[]): Promise<ProviderResult<RerankResult>> {
        if (documents.length === 0) {
            return { data: { scores: [] }, usage: { tokensUsed: 0, details: { documents: 0 } } };
        }

        const numbered = documents
            .map(
                (doc, i) =>
                    `[${i + 1}] ${doc.slice(0, MAX_DOCUMENT_CHARS).replace(/\s+/g, " ").trim()}`
            )
            .join("\n\n");

        const resp = await fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    {
                        role: "user",
                        content: `Query: ${query}\n\nDocuments (${documents.length}):\n${numbered}`,
                    },
                ],
                response_format: {
                    type: "json_schema",
                    json_schema: { name: "rerank_scores", schema: SCORES_SCHEMA },
                },
            }),
        });

        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Rerank failed (${resp.status}): ${text}`);
        }

        const payload = (await resp.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: { total_tokens?: number };
        };

        const scores = parseScores(payload.choices?.[0]?.message?.content, documents.length);

        return {
            data: { scores },
            usage: {
                tokensUsed: payload.usage?.total_tokens ?? RERANK_TOKENS_PER_QUERY,
                details: { documents: documents.length },
            },
        };
    }
}

/**
 * A wrong-length or unparseable reply must not reorder results arbitrarily.
 * Falling back to a uniform score leaves the caller's existing order intact,
 * which is the honest outcome when the model told us nothing usable.
 */
function parseScores(content: string | undefined, expected: number): number[] {
    const neutral = (): number[] => new Array<number>(expected).fill(0.5);

    if (!content) return neutral();

    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        console.warn("[Rerank] Model reply was not valid JSON; keeping input order.");
        return neutral();
    }

    const raw = (parsed as { scores?: unknown })?.scores;
    if (!Array.isArray(raw) || raw.length !== expected) {
        console.warn(
            `[Rerank] Expected ${expected} scores, got ${
                Array.isArray(raw) ? raw.length : "none"
            }; keeping input order.`
        );
        return neutral();
    }

    return raw.map(value => {
        const n = typeof value === "number" ? value : Number(value);
        return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
    });
}
