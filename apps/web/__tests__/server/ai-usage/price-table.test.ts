/**
 * AI_USAGE_PRICES: inline JSON or a file, three optional sections, entries
 * matched without case and with or without a vendor prefix; anything invalid
 * fails with a sentence naming the entry.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

jest.mock("~/env", () => ({ env: { server: {} } }));

import { lookupRate, parsePriceTable, PriceTableError } from "~/server/ai-usage/price-table";

describe("parsePriceTable", () => {
    it("reads every kind of entry from inline JSON", () => {
        const table = parsePriceTable(
            JSON.stringify({
                chat: {
                    "GPT-5-mini": { input: 0.25, output: 2, cachedInput: 0.025 },
                    local: { ratio: 0 },
                },
                embedding: { "voyage-3": 0.06, "nomic-embed-text": { ratio: 0 } },
                search: { brave: 5 },
            })
        );
        expect(lookupRate(table.chat, "openai/gpt-5-mini")).toEqual({
            pricing: { input: 0.25, output: 2, cachedInput: 0.025 },
        });
        expect(lookupRate(table.chat, "local")).toEqual({ ratio: 0 });
        expect(lookupRate(table.embedding, "VOYAGE-3")).toEqual({ price: 0.06 });
        expect(lookupRate(table.embedding, "nomic-embed-text")).toEqual({ ratio: 0 });
        expect(lookupRate(table.search, "brave")).toEqual({ price: 5 });
        expect(lookupRate(table.search, "exa")).toBeUndefined();
    });

    it("reads a file when the value is a path", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prices-"));
        fs.writeFileSync(path.join(dir, "prices.json"), JSON.stringify({ search: { tavily: 8 } }));
        const table = parsePriceTable("prices.json", dir);
        expect(lookupRate(table.search, "tavily")).toEqual({ price: 8 });
        fs.rmSync(dir, { recursive: true });
    });

    it.each([
        ["not JSON", "{ chat: ", /isn't valid JSON/],
        ["a negative price", JSON.stringify({ embedding: { x: -1 } }), /embedding\.x/],
        ["half a chat price", JSON.stringify({ chat: { m: { input: 1 } } }), /chat\.m/],
        ["an unknown section", JSON.stringify({ ocr: {} }), /the table/],
        ["a missing file", "nowhere/prices.json", /can't read the file/],
    ])("refuses %s, naming what is wrong", (_name, raw, message) => {
        expect(() => parsePriceTable(raw, os.tmpdir())).toThrow(PriceTableError);
        expect(() => parsePriceTable(raw, os.tmpdir())).toThrow(message);
    });
});
