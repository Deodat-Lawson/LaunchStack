/**
 * What AI work is worth, in one unit: chat-token equivalents.
 *
 * A chat token (in or out, on any route) is the unit and counts as one.
 * Everything else converts by what it costs: an embedding token at the
 * embedding model's price, a web search at the search provider's, each
 * divided by what one *standard* chat token costs. So a million embedded
 * tokens at $0.13 against a $1.00-per-million chat token counts as 130,000,
 * and one $0.007 search as 7,000. That keeps the cheap, bulky work (embedding
 * a whole document) from reading as if it ate the allowance, and the
 * expensive, small work (a search) from reading as free.
 *
 * The standard chat token's price is, in order: `AI_USAGE_CHAT_PRICE_PER_MTOK`;
 * the Standard (`default` route) model's declared price, blended three input
 * tokens to one output; or $1.00 per million. Embedding and search prices are
 * list prices below, overridable with `AI_USAGE_EMBEDDING_PRICE_PER_MTOK` and
 * `AI_USAGE_WEB_SEARCH_PRICE_PER_1K`.
 *
 * Weights are applied when usage is recorded (./record) and stored with it, so
 * a price change never rewrites what was already used.
 */

import type { ChatUsageEvent } from "@launchstack/llm";

import { env } from "~/env";
import { getAppChatModelsConfig } from "~/server/chat-models";

/** Standard chat token price when neither the operator nor the model sets one, USD per 1M. */
export const DEFAULT_CHAT_PRICE_PER_MTOK = 1;

/** Embedding list prices, USD per 1M tokens. Checked 2026-10-28. */
export const EMBEDDING_LIST_PRICES: Readonly<Record<string, number>> = {
    "text-embedding-3-large": 0.13,
    "text-embedding-3-small": 0.02,
    "text-embedding-ada-002": 0.1,
    "gemini-embedding-001": 0.15,
};

/** For a model not listed above: the default model's price. */
export const DEFAULT_EMBEDDING_PRICE_PER_MTOK = 0.13;

/**
 * Search list prices, USD per 1,000. Exa: search with contents (up to ten
 * results) $7; contents with a summary $1 + $1 a page. Serper: $1 on its
 * entry pack. Checked 2026-10-28.
 */
export const WEB_LIST_PRICES_PER_1K: Readonly<
    Record<string, { search: number; contents?: number }>
> = {
    exa: { search: 7, contents: 2 },
    serper: { search: 1 },
};

/** For a provider not listed above. */
const DEFAULT_SEARCH_PRICE_PER_1K = 7;

function priceFromEnv(raw: string | undefined): number | null {
    const value = Number(raw?.trim().replace(/[_,\s]/g, ""));
    return raw?.trim() && Number.isFinite(value) && value >= 0 ? value : null;
}

export interface ChatPrice {
    /** USD per 1M standard chat tokens. */
    perMillion: number;
    source: "setting" | "model" | "default";
}

/** What one standard chat token costs: the unit every other kind converts into. */
export function standardChatPrice(): ChatPrice {
    const configured = priceFromEnv(env.server.AI_USAGE_CHAT_PRICE_PER_MTOK);
    if (configured !== null && configured > 0) return { perMillion: configured, source: "setting" };
    try {
        const config = getAppChatModelsConfig(env.server);
        const pricing = config.models.get(config.routes.default)?.pricing;
        const blended = pricing ? (3 * pricing.input + pricing.output) / 4 : 0;
        if (blended > 0) return { perMillion: blended, source: "model" };
    } catch {
        // No readable model file (a test, a half-configured server): use the default.
    }
    return { perMillion: DEFAULT_CHAT_PRICE_PER_MTOK, source: "default" };
}

/** `openai/text-embedding-3-large`, `models/gemini-embedding-001` → the bare id. */
function bareModelId(modelId: string | undefined): string {
    return (modelId ?? "").trim().toLowerCase().split("/").pop() ?? "";
}

/** USD per 1M tokens to embed with `modelId`. */
export function embeddingPricePerMillion(modelId: string | undefined): number {
    const configured = priceFromEnv(env.server.AI_USAGE_EMBEDDING_PRICE_PER_MTOK);
    if (configured !== null) return configured;
    return EMBEDDING_LIST_PRICES[bareModelId(modelId)] ?? DEFAULT_EMBEDDING_PRICE_PER_MTOK;
}

/** USD for one search, or one page read, from `provider`. */
export function webUnitPrice(kind: "web_search" | "web_contents", provider?: string): number {
    const listed = WEB_LIST_PRICES_PER_1K[bareModelId(provider)];
    if (kind === "web_contents") return (listed?.contents ?? 0) / 1000;
    const configured = priceFromEnv(env.server.AI_USAGE_WEB_SEARCH_PRICE_PER_1K);
    if (configured !== null) return configured / 1000;
    return (listed?.search ?? DEFAULT_SEARCH_PRICE_PER_1K) / 1000;
}

export interface WeighedUsage {
    /** Chat-token equivalents. */
    weightedTokens: number;
    /** USD, when the event can be priced and the deployment pays for it. */
    costUsd?: number;
}

/**
 * The event in chat-token equivalents, and its cost. A chat call keeps the
 * price its model declared (or none); an embedding on a workspace's own
 * endpoint is weighed at list price but not priced, since that workspace's
 * provider bills it.
 */
export function weighUsage(
    event: ChatUsageEvent,
    chatPrice: ChatPrice = standardChatPrice()
): WeighedUsage {
    const kind = event.kind ?? "chat";
    const perToken = chatPrice.perMillion / 1_000_000;
    if (kind === "chat") {
        return {
            weightedTokens: event.inputTokens + event.outputTokens,
            ...(event.costUsd !== undefined ? { costUsd: event.costUsd } : {}),
        };
    }
    if (kind === "embedding") {
        const cost = (event.inputTokens * embeddingPricePerMillion(event.modelId)) / 1_000_000;
        return {
            weightedTokens: Math.ceil(cost / perToken),
            ...(event.owner === "deployment" ? { costUsd: cost } : {}),
        };
    }
    const cost = Math.max(0, event.calls ?? 1) * webUnitPrice(kind, event.modelId);
    return { weightedTokens: Math.round(cost / perToken), costUsd: cost };
}

/** Embedding tokens as chat-token equivalents, for the ledger's debit (a whole number, at least 1). */
export function embeddingTokensAsChat(tokens: number, modelId: string | undefined): number {
    return Math.max(
        1,
        weighUsage({
            kind: "embedding",
            modelId,
            owner: "deployment",
            inputTokens: tokens,
            outputTokens: 0,
        }).weightedTokens
    );
}
