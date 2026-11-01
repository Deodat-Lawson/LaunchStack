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
 * tokens to one output; its entry in `AI_USAGE_PRICES`; or $1.00 per million.
 *
 * A chat model with a price counts its blended price over the standard one
 * per token, so the Standard model itself stays one for one and a model at
 * four times its price counts four. Its price is the one it declared (the
 * model file, or a workspace's own settings), else its `AI_USAGE_PRICES`
 * entry; unpriced, it counts one for one. Embedding and search prices are, in
 * order: their `AI_USAGE_PRICES` entry, `AI_USAGE_EMBEDDING_PRICE_PER_MTOK` /
 * `AI_USAGE_WEB_SEARCH_PRICE_PER_1K` for every model or provider, the list
 * prices below. A `ratio` entry weighs without a price (./price-table).
 *
 * Weights are applied when usage is recorded (./record) and stored with it, so
 * a price change never rewrites what was already used.
 */

import { priceUsage, type ChatModelPricing, type ChatUsageEvent } from "@launchstack/llm";
import { configuredWebSearchProvider } from "@launchstack/tools/web-research";

import { env } from "~/env";
import { getAppChatModelsConfig } from "~/server/chat-models";

import { lookupRate, priceTable, type ChatRate, type UnitRate } from "./price-table";

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

/** A chat price as one number per 1M tokens: three input tokens to one output. */
export function blendedPerMillion(pricing: ChatModelPricing): number {
    return (3 * pricing.input + pricing.output) / 4;
}

/** What one standard chat token costs: the unit every other kind converts into. */
export function standardChatPrice(): ChatPrice {
    const configured = priceFromEnv(env.server.AI_USAGE_CHAT_PRICE_PER_MTOK);
    if (configured !== null && configured > 0) return { perMillion: configured, source: "setting" };
    try {
        const config = getAppChatModelsConfig(env.server);
        const standard = config.models.get(config.routes.default);
        const listed = lookupRate(priceTable().chat, standard?.id);
        const pricing =
            standard?.pricing ?? (listed && "pricing" in listed ? listed.pricing : undefined);
        const blended = pricing ? blendedPerMillion(pricing) : 0;
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

/** How an embedding with `modelId` is weighed: USD per 1M tokens, or a ratio from the operator's table. */
export function embeddingRate(modelId: string | undefined): UnitRate {
    const listed = lookupRate(priceTable().embedding, modelId);
    if (listed) return listed;
    const configured = priceFromEnv(env.server.AI_USAGE_EMBEDDING_PRICE_PER_MTOK);
    if (configured !== null) return { price: configured };
    return {
        price: EMBEDDING_LIST_PRICES[bareModelId(modelId)] ?? DEFAULT_EMBEDDING_PRICE_PER_MTOK,
    };
}

/** USD per 1M tokens to embed with `modelId` (a ratio entry as its price at today's chat rate). */
export function embeddingPricePerMillion(modelId: string | undefined): number {
    const rate = embeddingRate(modelId);
    return "price" in rate ? rate.price : rate.ratio * standardChatPrice().perMillion;
}

/** How one search from `provider` is weighed: USD per 1,000, or a ratio. Pages read keep Exa's list price. */
export function searchRate(provider: string | undefined): UnitRate {
    const listed = lookupRate(priceTable().search, provider);
    if (listed) return listed;
    const configured = priceFromEnv(env.server.AI_USAGE_WEB_SEARCH_PRICE_PER_1K);
    if (configured !== null) return { price: configured };
    return {
        price: WEB_LIST_PRICES_PER_1K[bareModelId(provider)]?.search ?? DEFAULT_SEARCH_PRICE_PER_1K,
    };
}

/** USD for one search, or one page read, from `provider` (a ratio entry as its price at today's chat rate). */
export function webUnitPrice(kind: "web_search" | "web_contents", provider?: string): number {
    if (kind === "web_contents") {
        return (WEB_LIST_PRICES_PER_1K[bareModelId(provider)]?.contents ?? 0) / 1000;
    }
    const rate = searchRate(provider);
    return "price" in rate
        ? rate.price / 1000
        : (rate.ratio * standardChatPrice().perMillion) / 1_000_000;
}

/**
 * How a chat call is weighed: its declared price, else the operator's table
 * entry for its model, else nothing (one for one).
 */
function chatRate(event: ChatUsageEvent): ChatRate | null {
    if (event.pricing) return { pricing: event.pricing };
    return lookupRate(priceTable().chat, event.modelId) ?? null;
}

/**
 * Up to a whole token, but not for floating-point noise: $0.13 over $0.000001
 * comes out as 130000.00000000001, which is 130,000 and not 130,001.
 */
function wholeTokensUp(value: number): number {
    const nearest = Math.round(value);
    return Math.abs(value - nearest) <= 1e-12 * Math.max(1, Math.abs(value))
        ? nearest
        : Math.ceil(value);
}

export interface WeighedUsage {
    /** Chat-token equivalents. */
    weightedTokens: number;
    /** USD, when the event can be priced and the deployment pays for it. */
    costUsd?: number;
}

/**
 * The event in chat-token equivalents, and its cost. A chat call counts its
 * tokens times its model's price over the standard one (one for one when
 * unpriced), and costs what its model's price says. An embedding on a
 * workspace's own endpoint is weighed but not priced, since that workspace's
 * provider bills it. A `ratio` entry weighs without inventing a cost.
 */
export function weighUsage(
    event: ChatUsageEvent,
    chatPrice: ChatPrice = standardChatPrice()
): WeighedUsage {
    const kind = event.kind ?? "chat";
    const perToken = chatPrice.perMillion / 1_000_000;
    if (kind === "chat") {
        const tokens = event.inputTokens + event.outputTokens;
        const rate = chatRate(event);
        if (!rate) {
            return {
                weightedTokens: tokens,
                ...(event.costUsd !== undefined ? { costUsd: event.costUsd } : {}),
            };
        }
        if ("ratio" in rate) {
            return {
                weightedTokens: wholeTokensUp(tokens * rate.ratio),
                ...(event.costUsd !== undefined ? { costUsd: event.costUsd } : {}),
            };
        }
        return {
            weightedTokens: wholeTokensUp(
                (tokens * blendedPerMillion(rate.pricing)) / chatPrice.perMillion
            ),
            costUsd: event.costUsd ?? priceUsage(event, rate.pricing),
        };
    }
    if (kind === "embedding") {
        const rate = embeddingRate(event.modelId);
        if ("ratio" in rate) {
            return { weightedTokens: wholeTokensUp(event.inputTokens * rate.ratio) };
        }
        const cost = (event.inputTokens * rate.price) / 1_000_000;
        return {
            weightedTokens: wholeTokensUp(cost / perToken),
            ...(event.owner === "deployment" ? { costUsd: cost } : {}),
        };
    }
    const units = Math.max(0, event.calls ?? 1);
    if (kind === "web_search") {
        const rate = searchRate(event.modelId);
        if ("ratio" in rate) return { weightedTokens: Math.round(units * rate.ratio) };
    }
    const cost = units * webUnitPrice(kind, event.modelId);
    return { weightedTokens: Math.round(cost / perToken), costUsd: cost };
}

/** What the conversion came to, for a page to say so. */
export interface ConversionRates {
    /** The standard chat token's price and where it came from. */
    chat: ChatPrice;
    /** A million embedded tokens, in chat-token equivalents. */
    embeddingPerMillion: number;
    /** One web search, in chat-token equivalents. */
    perSearch: number;
}

/**
 * The rates a window's rows were weighed at: what its embedded tokens and its
 * searches came to on average. A window with none of a kind gets today's rate
 * for the deployment's defaults.
 */
export function conversionRates(observed: {
    embeddedTokens: number;
    embeddedWeighted: number;
    searches: number;
    searchWeighted: number;
}): ConversionRates {
    const chat = standardChatPrice();
    const today = (event: ChatUsageEvent) => weighUsage(event, chat).weightedTokens;
    return {
        chat,
        embeddingPerMillion:
            observed.embeddedTokens > 0
                ? Math.round((observed.embeddedWeighted / observed.embeddedTokens) * 1_000_000)
                : today({
                      kind: "embedding",
                      owner: "deployment",
                      inputTokens: 1_000_000,
                      outputTokens: 0,
                  }),
        perSearch:
            observed.searches > 0
                ? Math.round(observed.searchWeighted / observed.searches)
                : today({
                      kind: "web_search",
                      modelId: configuredWebSearchProvider() ?? "exa",
                      owner: "deployment",
                      inputTokens: 0,
                      outputTokens: 0,
                  }),
    };
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
