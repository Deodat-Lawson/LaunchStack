/**
 * `AI_USAGE_PRICES`: the operator's own prices, for models and search
 * providers the built-in list doesn't know (a new release, a model served by
 * Ollama or vLLM, a search engine added since) or knows at a different price.
 *
 * The value is inline JSON, or a path to a JSON file (relative paths from the
 * app's working directory). Three optional sections, each keyed by model id or
 * provider, matched without case and with or without a vendor prefix
 * (`openai/gpt-5-mini` also matches `gpt-5-mini`):
 *
 *     {
 *       "chat":      { "gpt-5-mini": { "input": 0.25, "output": 2 },
 *                      "llama3.1:8b": { "ratio": 0 } },
 *       "embedding": { "nomic-embed-text": 0, "voyage-3": 0.06 },
 *       "search":    { "brave": 5, "searxng": 0 }
 *     }
 *
 * A chat entry is a price in US dollars per 1M tokens (`input`, `output`,
 * optional `cachedInput`). An embedding entry is US dollars per 1M tokens and
 * a search entry US dollars per 1,000 searches, as bare numbers. Any entry
 * can instead be `{ "ratio": n }`: chat-token equivalents per token (chat,
 * embedding) or per search, for a model with no dollar price — a local model
 * at 0, say. A ratio weighs usage but never invents a cost.
 *
 * Read once per value (a change takes effect on restart, like the model
 * file). An invalid table is reported once, naming the entry, and ignored:
 * usage falls back to the built-in prices rather than stopping AI work.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ChatModelPricing } from "@launchstack/llm";

import { env } from "~/env";

/** Generous: no published model or search price comes near it, and a typo in the thousands still fails. */
const amount = z.number().finite().min(0).max(100_000);
const ratioEntry = z.object({ ratio: amount }).strict();
const chatEntry = z.union([
    z.object({ input: amount, output: amount, cachedInput: amount.optional() }).strict(),
    ratioEntry,
]);
const unitEntry = z.union([amount, ratioEntry]);

const tableSchema = z
    .object({
        chat: z.record(chatEntry).optional(),
        embedding: z.record(unitEntry).optional(),
        search: z.record(unitEntry).optional(),
    })
    .strict();

/** A chat model's price, or its weight when it has none. */
export type ChatRate = { pricing: ChatModelPricing } | { ratio: number };
/** An embedding model's (per 1M tokens) or a search provider's (per 1,000) price, or its weight. */
export type UnitRate = { price: number } | { ratio: number };

export interface PriceTable {
    chat: ReadonlyMap<string, ChatRate>;
    embedding: ReadonlyMap<string, UnitRate>;
    search: ReadonlyMap<string, UnitRate>;
}

const EMPTY: PriceTable = { chat: new Map(), embedding: new Map(), search: new Map() };

export class PriceTableError extends Error {
    override readonly name = "PriceTableError";
}

const keyOf = (id: string) => id.trim().toLowerCase();

/** Inline JSON, or a path to a JSON file. Throws {@link PriceTableError} naming what is wrong. */
export function parsePriceTable(raw: string, cwd: string = process.cwd()): PriceTable {
    const value = raw.trim();
    let text = value;
    if (!value.startsWith("{")) {
        const file = path.resolve(cwd, value);
        try {
            text = fs.readFileSync(file, "utf8");
        } catch {
            throw new PriceTableError(`AI_USAGE_PRICES: can't read the file ${file}.`);
        }
    }
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch (error) {
        throw new PriceTableError(
            `AI_USAGE_PRICES isn't valid JSON (${error instanceof Error ? error.message : "parse error"}).`
        );
    }
    const parsed = tableSchema.safeParse(json);
    if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        const where = issue.path.length > 0 ? issue.path.join(".") : "the table";
        throw new PriceTableError(
            `AI_USAGE_PRICES: ${where} — ${issue.message}. Prices are non-negative numbers; ` +
                `a chat entry is { "input", "output" } or { "ratio" }, an embedding or search entry a number or { "ratio" }.`
        );
    }
    const { chat = {}, embedding = {}, search = {} } = parsed.data;
    return {
        chat: new Map(
            Object.entries(chat).map(([id, entry]) => [
                keyOf(id),
                "ratio" in entry ? { ratio: entry.ratio } : { pricing: entry },
            ])
        ),
        embedding: new Map(
            Object.entries(embedding).map(([id, entry]) => [
                keyOf(id),
                typeof entry === "number" ? { price: entry } : { ratio: entry.ratio },
            ])
        ),
        search: new Map(
            Object.entries(search).map(([id, entry]) => [
                keyOf(id),
                typeof entry === "number" ? { price: entry } : { ratio: entry.ratio },
            ])
        ),
    };
}

let cached: { raw: string; table: PriceTable } | undefined;

/** The operator's table, or an empty one when unset or invalid (reported once). */
export function priceTable(): PriceTable {
    const raw = env.server.AI_USAGE_PRICES?.trim() ?? "";
    if (!raw) return EMPTY;
    if (cached?.raw === raw) return cached.table;
    let table = EMPTY;
    try {
        table = parsePriceTable(raw);
    } catch (error) {
        console.error(
            `[ai-usage] ${error instanceof Error ? error.message : String(error)} Using the built-in prices.`
        );
    }
    cached = { raw, table };
    return table;
}

/** An entry for `id`: the full id first (`openai/gpt-5-mini`), then without its vendor prefix. */
export function lookupRate<T>(map: ReadonlyMap<string, T>, id: string | undefined): T | undefined {
    const full = keyOf(id ?? "");
    if (!full) return undefined;
    return map.get(full) ?? map.get(full.split("/").pop()!);
}
