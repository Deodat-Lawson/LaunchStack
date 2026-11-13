import { describe, expect, it } from "vitest";

import {
    advanceTable,
    ALL_ROWS_FAILED_MESSAGE,
    buildExtractionPrompt,
    buildExtractionSchema,
    buildExtractionSystemPrompt,
    coerceBoolean,
    coerceDate,
    coerceList,
    coerceNumber,
    coerceValue,
    DOCUMENT_UNAVAILABLE_MESSAGE,
    extractDocumentCells,
    ExtractionCallError,
    groundQuote,
    packPassages,
    quoteInText,
    type ExtractionAnswer,
} from "./engine";
import type {
    ExtractStructuredFn,
    ExtractionCells,
    ExtractionDocument,
    ExtractionField,
    ExtractionPorts,
    ExtractionRowRecord,
    ExtractionRowStatus,
    ExtractionStore,
    ExtractionTableRecord,
    ReadImageFieldsFn,
} from "./types";
import { EMPTY_EXTRACTION_USAGE, EXTRACTION_LIMITS } from "./types";

// ─── Fakes ───────────────────────────────────────────────────────────────────

const NOT_FOUND = { status: "not_found", value: null, quote: null, page: null, via: "text" };

/**
 * A fake model: `answer` sees the prompt of one call and returns the answers
 * it would give. Records every prompt.
 */
function fakeExtract(answer: (prompt: string) => ExtractionAnswer[]) {
    const prompts: string[] = [];
    const systems: string[] = [];
    const extract: ExtractStructuredFn = async args => {
        prompts.push(args.prompt);
        systems.push(args.system);
        const result = args.schema.parse({ answers: answer(args.prompt) });
        return { result, usage: { inputTokens: 100, outputTokens: 10 } };
    };
    return { extract, prompts, systems };
}

/** The passage number a prompt gives the passage containing `needle`. */
function passageOf(prompt: string, needle: string): number {
    const at = prompt.indexOf(needle);
    if (at < 0) return 0;
    const labels = [...prompt.slice(0, at).matchAll(/\[p(\d+)\]/g)];
    return Number(labels.at(-1)?.[1] ?? 0);
}

function filler(index: number, length = 1000): string {
    const sentence = `Section ${index} sets out general terms that apply to both parties in the ordinary course. `;
    return sentence.repeat(Math.ceil(length / sentence.length)).slice(0, length);
}

function doc(
    passages: Array<{ text: string; page?: number | null }>,
    overrides: Partial<ExtractionDocument> = {}
): ExtractionDocument {
    return {
        title: "Master Services Agreement.pdf",
        passages: passages.map(p => ({ text: p.text, page: p.page ?? null })),
        isImage: false,
        ...overrides,
    };
}

const FIELDS: ExtractionField[] = [
    { id: "f1", name: "Total", type: "number", instruction: "The contract total" },
    { id: "f2", name: "Governing law", type: "text" },
];

function baseTable(overrides: Partial<ExtractionTableRecord> = {}): ExtractionTableRecord {
    return {
        id: 1,
        companyId: 5n,
        createdByUserId: "u1",
        title: "Contracts",
        fields: FIELDS,
        status: "queued",
        usage: { ...EMPTY_EXTRACTION_USAGE },
        error: null,
        sharedAt: null,
        cancelRequestedAt: null,
        leaseUntil: null,
        createdAt: new Date("2026-11-12T00:00:00Z"),
        startedAt: null,
        finishedAt: null,
        ...overrides,
    };
}

function baseRow(id: number, overrides: Partial<ExtractionRowRecord> = {}): ExtractionRowRecord {
    return {
        id,
        tableId: 1,
        companyId: 5n,
        documentId: 100 + id,
        documentTitle: `Doc ${id}.pdf`,
        status: "pending",
        cells: {},
        error: null,
        attempts: 0,
        ...overrides,
    };
}

function memoryStore(table: ExtractionTableRecord, initialRows: ExtractionRowRecord[]) {
    const tables = new Map([[table.id, structuredClone(table)]]);
    const rows = new Map(initialRows.map(r => [r.id, structuredClone(r)]));
    const ended = (t: ExtractionTableRecord) => ["done", "failed", "cancelled"].includes(t.status);
    const store: ExtractionStore & { tables: typeof tables; rows: typeof rows } = {
        tables,
        rows,
        async getTable(id) {
            const t = tables.get(id);
            return t ? structuredClone(t) : null;
        },
        async markRunning(id, now) {
            const t = tables.get(id)!;
            if (t.status === "queued") Object.assign(t, { status: "running", startedAt: now });
        },
        async claimRows(id, limit) {
            const claimed = [...rows.values()]
                .filter(r => r.tableId === id && r.status === "pending")
                .sort((a, b) => a.id - b.id)
                .slice(0, limit);
            for (const r of claimed)
                Object.assign(r, { status: "running", attempts: r.attempts + 1 });
            return claimed.map(r => structuredClone(r));
        },
        async completeRow(rowId, cells) {
            const r = rows.get(rowId)!;
            if (r.status === "running") Object.assign(r, { status: "done", cells, error: null });
        },
        async failRow(rowId, error) {
            const r = rows.get(rowId)!;
            if (r.status === "running") Object.assign(r, { status: "failed", error });
        },
        async releaseRunningRows(id) {
            let n = 0;
            for (const r of rows.values())
                if (r.tableId === id && r.status === "running") {
                    r.status = "pending";
                    n++;
                }
            return n;
        },
        async addUsage(id, usage) {
            const t = tables.get(id)!;
            t.usage = {
                calls: t.usage.calls + usage.calls,
                inputTokens: t.usage.inputTokens + usage.inputTokens,
                outputTokens: t.usage.outputTokens + usage.outputTokens,
            };
        },
        async countRows(id) {
            const counts: Record<ExtractionRowStatus, number> = {
                pending: 0,
                running: 0,
                done: 0,
                failed: 0,
            };
            for (const r of rows.values()) if (r.tableId === id) counts[r.status]++;
            return counts;
        },
        async finish(id, status, error, now) {
            const t = tables.get(id)!;
            if (ended(t)) return;
            Object.assign(t, { status, error, finishedAt: now, leaseUntil: null });
        },
    };
    return store;
}

const GOVERNING = "This Agreement is governed by the laws of the State of Delaware.";
const TOTAL = "The total contract value is $1,250.50 payable in two instalments.";

/** A model that answers f1 and f2 whenever their sentences are in the prompt. */
function contractAnswers(prompt: string): ExtractionAnswer[] {
    const answers: ExtractionAnswer[] = [];
    if (prompt.includes(TOTAL))
        answers.push({
            field: "f1",
            found: true,
            value: "$1,250.50",
            quote: TOTAL,
            passage: passageOf(prompt, TOTAL),
        });
    else answers.push({ field: "f1", found: false, value: "", quote: "", passage: 0 });
    if (prompt.includes(GOVERNING))
        answers.push({
            field: "f2",
            found: true,
            value: "Delaware",
            quote: GOVERNING,
            passage: passageOf(prompt, GOVERNING),
        });
    else answers.push({ field: "f2", found: false, value: "", quote: "", passage: 0 });
    return answers;
}

function ports(
    store: ExtractionStore,
    overrides: Partial<ExtractionPorts> = {}
): ExtractionPorts & { logs: string[] } {
    const logs: string[] = [];
    return {
        store,
        async readDocument() {
            return doc([
                { text: TOTAL, page: 1 },
                { text: GOVERNING, page: 2 },
            ]);
        },
        extract: fakeExtract(contractAnswers).extract,
        now: () => new Date("2026-11-12T10:00:00Z"),
        concurrency: 3,
        log: message => logs.push(message),
        logs,
        ...overrides,
    };
}

// ─── Packing ─────────────────────────────────────────────────────────────────

describe("packPassages", () => {
    it("keeps every passage, in order, in batches within the budget", () => {
        const passages = Array.from({ length: 40 }, (_, i) => ({ text: filler(i), page: i + 1 }));
        const batches = packPassages(passages);
        expect(batches.length).toBe(4);
        expect(batches.flat().map(p => p.n)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
        expect(batches.flat().map(p => p.page)).toEqual(
            Array.from({ length: 40 }, (_, i) => i + 1)
        );
        for (const batch of batches)
            expect(batch.reduce((sum, p) => sum + p.text.length, 0)).toBeLessThanOrEqual(12_000);
    });

    it("splits only a passage that alone exceeds the budget, and loses none of it", () => {
        const long = Array.from({ length: 3000 }, (_, i) => `word${i}`).join(" ");
        const batches = packPassages(
            [
                { text: "Short opening passage.", page: 1 },
                { text: long, page: 2 },
            ],
            12_000
        );
        const pieces = batches.flat();
        expect(pieces[0]!.text).toBe("Short opening passage.");
        expect(pieces.length).toBeGreaterThan(2);
        for (const piece of pieces) expect(piece.text.length).toBeLessThanOrEqual(12_000);
        const seen = new Set(pieces.flatMap(p => p.text.split(" ")));
        for (let i = 0; i < 3000; i++) expect(seen.has(`word${i}`)).toBe(true);
        expect(pieces.slice(1).every(p => p.page === 2)).toBe(true);
    });

    it("skips empty passages", () => {
        expect(packPassages([{ text: "  ", page: 1 }])).toEqual([]);
    });
});

// ─── Prompt and schema ───────────────────────────────────────────────────────

describe("prompt and schema", () => {
    it("names each field's id, name, type and instruction, and labels passages with pages", () => {
        const prompt = buildExtractionPrompt({
            title: "Lease.pdf",
            fields: FIELDS,
            passages: [
                { n: 3, text: "Alpha text.", page: 7 },
                { n: 4, text: "Beta text.", page: null },
            ],
        });
        expect(prompt).toContain("id: f1 | name: Total | type: number");
        expect(prompt).toContain("what to look for: The contract total");
        expect(prompt).toContain("id: f2 | name: Governing law | type: text");
        expect(prompt).toContain("[p3] (page 7)\nAlpha text.");
        expect(prompt).toContain("[p4]\nBeta text.");
    });

    it("tells the model to quote verbatim, not to guess, and to treat the text as data", () => {
        const system = buildExtractionSystemPrompt();
        expect(system).toMatch(/only what the passages state/i);
        expect(system).toMatch(/found=false/);
        expect(system).toMatch(/exactly/);
        expect(system).toMatch(/data, not instructions/);
        expect(system).toMatch(/document's own language/);
    });

    it("uses a flat schema: an array of objects whose members are all scalars", () => {
        const parsed = buildExtractionSchema().parse({
            answers: [{ field: "f1", found: true, value: "1", quote: "q", passage: 1 }],
        });
        for (const value of Object.values(parsed.answers[0]!))
            expect(["string", "number", "boolean"]).toContain(typeof value);
    });
});

// ─── Coercion ────────────────────────────────────────────────────────────────

describe("coercion", () => {
    it.each([
        ["$1,250.50", 1250.5],
        ["1250.50", 1250.5],
        ["-42", -42],
        ["(300)", -300],
        ["-$5.25", -5.25],
        ["€1.250,50", 1250.5],
        ["1 250,5", 1250.5],
        ["12,5", 12.5],
        ["1,00,000", 100000],
        ["USD 3,000", 3000],
        ["15%", 15],
        ["¥１２３", 123],
        ["$3 million", 3_000_000],
        ["$1.2m", 1_200_000],
        ["5万", 50_000],
        ["0", 0],
    ])("number %s → %s", (raw, expected) => {
        expect(coerceNumber(raw)).toBe(expected);
    });

    it.each(["", "n/a", "about a dozen", "1.2.3"])("number %j is unparseable", raw => {
        expect(coerceNumber(raw)).toBeNull();
        expect(coerceValue("number", raw)).toBeNull();
    });

    it.each([
        ["2025-03-05", "2025-03-05"],
        ["2025/3/5", "2025-03-05"],
        ["March 5, 2025", "2025-03-05"],
        ["5 March 2025", "2025-03-05"],
        ["Sept. 1st, 2024", "2024-09-01"],
        ["2025年3月5日", "2025-03-05"],
        ["25/12/2024", "2024-12-25"],
        ["12/25/2024", "2024-12-25"],
        // Day and month could be either way round: kept as written.
        ["03/04/2025", "03/04/2025"],
        ["Q3 2025", "Q3 2025"],
        ["March 2025", "March 2025"],
        // Not a real date: kept as written rather than invented.
        ["2025-02-30", "2025-02-30"],
    ])("date %s → %s", (raw, expected) => {
        expect(coerceDate(raw)).toBe(expected);
    });

    it.each([
        ["yes", true],
        ["Yes.", true],
        ["TRUE", true],
        ["Yes, under clause 4", true],
        ["是", true],
        ["是的", true],
        ["no", false],
        ["No", false],
        ["false", false],
        ["否", false],
        ["不是", false],
    ])("boolean %s → %s", (raw, expected) => {
        expect(coerceBoolean(raw)).toBe(expected);
    });

    it.each(["", "maybe", "是否", "unclear"])("boolean %j is not a yes or a no", raw => {
        expect(coerceBoolean(raw)).toBeNull();
    });

    it("reads a list from lines or from a JSON array, deduped and capped", () => {
        expect(coerceList("- Alice\n- Bob\n\n1. alice\n2) Carol")).toEqual([
            "Alice",
            "Bob",
            "Carol",
        ]);
        expect(coerceList('["Alice", "Bob", "bob"]')).toEqual(["Alice", "Bob"]);
        expect(coerceList("  ")).toBeNull();
        const many = Array.from({ length: 80 }, (_, i) => `item ${i}`).join("\n");
        expect(coerceList(many)).toHaveLength(EXTRACTION_LIMITS.listItems);
    });

    it("trims and caps text", () => {
        expect(coerceValue("text", "  Delaware  ")).toBe("Delaware");
        expect(coerceValue("text", "   ")).toBeNull();
        expect(coerceValue("text", "x".repeat(5000))).toHaveLength(EXTRACTION_LIMITS.valueLength);
    });
});

// ─── Grounding ───────────────────────────────────────────────────────────────

describe("grounding", () => {
    const batch = [
        { n: 1, text: "The fee is “USD 4,000” per month.", page: 3 },
        { n: 2, text: "Either party may terminate on thirty\n  days’ written notice.", page: 4 },
    ];

    it("matches through whitespace and quote-mark differences", () => {
        expect(quoteInText("terminate on thirty days' written notice", batch[1]!.text)).toBe(true);
        expect(quoteInText('The fee is "USD 4,000" per month.', batch[0]!.text)).toBe(true);
    });

    it("accepts a short quote that is verbatim, and rejects one that is not there", () => {
        expect(quoteInText("Net 30", "Payment terms: Net 30.")).toBe(true);
        expect(quoteInText("合同期限三年", "本合同期限三年，自签署之日起生效。")).toBe(true);
        expect(quoteInText("Net 60", "Payment terms: Net 30.")).toBe(false);
        expect(quoteInText("a", "a b c")).toBe(false);
    });

    it("tries the named passage first, then the rest of the call", () => {
        expect(groundQuote("thirty days' written notice", 2, batch)?.page).toBe(4);
        // Wrong passage number: the quote is still found, with its real page.
        expect(groundQuote("thirty days' written notice", 1, batch)?.page).toBe(4);
        expect(groundQuote("ninety days' written notice", 2, batch)).toBeNull();
        expect(groundQuote("", 1, batch)).toBeNull();
    });
});

// ─── extractDocumentCells ────────────────────────────────────────────────────

describe("extractDocumentCells", () => {
    it("reads the whole of a long document: an answer past 24,000 characters is found (C3)", async () => {
        const passages = Array.from({ length: 40 }, (_, i) => ({
            text: filler(i),
            page: i + 1,
        }));
        // 30 passages × 1,000 characters come before the answer.
        passages[30] = { text: `${filler(30, 600)} ${GOVERNING}`, page: 31 };
        const before = passages.slice(0, 30).reduce((sum, p) => sum + p.text.length, 0);
        expect(before).toBeGreaterThan(24_000);

        const model = fakeExtract(contractAnswers);
        const { cells, usage } = await extractDocumentCells({
            fields: FIELDS,
            document: doc(passages),
            extract: model.extract,
        });

        expect(cells.f2).toEqual({
            status: "found",
            value: "Delaware",
            quote: GOVERNING,
            page: 31,
            via: "text",
        });
        expect(cells.f1).toEqual(NOT_FOUND);
        // Every passage went to the model exactly once.
        expect(model.prompts.length).toBe(4);
        for (let i = 0; i < 40; i++)
            expect(model.prompts.filter(p => p.includes(`Section ${i} sets out`)).length).toBe(1);
        expect(usage).toEqual({ calls: 4, inputTokens: 400, outputTokens: 40 });
    });

    it("keeps a grounded answer with the page of the passage it was found in", async () => {
        const model = fakeExtract(prompt => [
            {
                field: "f1",
                found: true,
                value: "$1,250.50",
                quote: TOTAL,
                // The model names the wrong passage; the quote decides the page.
                passage: passageOf(prompt, GOVERNING),
            },
        ]);
        const { cells } = await extractDocumentCells({
            fields: FIELDS,
            document: doc([
                { text: GOVERNING, page: 2 },
                { text: TOTAL, page: 9 },
            ]),
            extract: model.extract,
        });
        expect(cells.f1).toEqual({
            status: "found",
            value: 1250.5,
            quote: TOTAL,
            page: 9,
            via: "text",
        });
        // A field the model never mentioned still has a cell.
        expect(cells.f2).toEqual(NOT_FOUND);
    });

    it("treats an answer whose quote is not in the text as not found", async () => {
        const model = fakeExtract(() => [
            {
                field: "f1",
                found: true,
                value: "9999",
                quote: "The total contract value is $9,999 payable on signature.",
                passage: 1,
            },
            { field: "f2", found: true, value: "Delaware", quote: "", passage: 1 },
        ]);
        const { cells } = await extractDocumentCells({
            fields: FIELDS,
            document: doc([{ text: `${TOTAL} ${GOVERNING}`, page: 1 }]),
            extract: model.extract,
        });
        expect(cells).toEqual({ f1: NOT_FOUND, f2: NOT_FOUND });
    });

    it("drops answers that are found=false, unparseable, or for a field that does not exist", async () => {
        const model = fakeExtract(() => [
            { field: "f1", found: true, value: "a lot", quote: TOTAL, passage: 1 },
            { field: "f2", found: false, value: "Delaware", quote: GOVERNING, passage: 1 },
            { field: "f9", found: true, value: "x", quote: GOVERNING, passage: 1 },
        ]);
        const { cells } = await extractDocumentCells({
            fields: FIELDS,
            document: doc([{ text: `${TOTAL} ${GOVERNING}`, page: 1 }]),
            extract: model.extract,
        });
        expect(cells).toEqual({ f1: NOT_FOUND, f2: NOT_FOUND });
    });

    it("takes the first grounded answer in reading order for a scalar field", async () => {
        const early = "The governing law of this Agreement is the law of England and Wales.";
        const late = "For the avoidance of doubt the governing law is the law of Scotland.";
        const passages = Array.from({ length: 30 }, (_, i) => ({ text: filler(i), page: i + 1 }));
        passages[2] = { text: early, page: 3 };
        passages[28] = { text: late, page: 29 };
        const model = fakeExtract(prompt => {
            const quote = prompt.includes(early) ? early : prompt.includes(late) ? late : "";
            return quote
                ? [
                      {
                          field: "f2",
                          found: true,
                          value: quote === early ? "England and Wales" : "Scotland",
                          quote,
                          passage: passageOf(prompt, quote),
                      },
                  ]
                : [];
        });
        const { cells } = await extractDocumentCells({
            fields: FIELDS,
            document: doc(passages),
            extract: model.extract,
        });
        expect(model.prompts.length).toBeGreaterThan(1);
        expect(cells.f2).toMatchObject({ value: "England and Wales", page: 3 });
    });

    it("unions a list field across batches, deduped, with the first quote and page", async () => {
        const first = "The parties to this Agreement are Acme Ltd and Borealis GmbH.";
        const second = "By a deed of accession, Cobalt Inc and ACME LTD joined as parties.";
        const passages = Array.from({ length: 30 }, (_, i) => ({ text: filler(i), page: i + 1 }));
        passages[1] = { text: first, page: 2 };
        passages[27] = { text: second, page: 28 };
        const model = fakeExtract(prompt => {
            if (prompt.includes(first))
                return [
                    {
                        field: "parties",
                        found: true,
                        value: "Acme Ltd\nBorealis GmbH",
                        quote: first,
                        passage: passageOf(prompt, first),
                    },
                ];
            if (prompt.includes(second))
                return [
                    {
                        field: "parties",
                        found: true,
                        value: '["Cobalt Inc", "ACME LTD"]',
                        quote: second,
                        passage: passageOf(prompt, second),
                    },
                ];
            return [];
        });
        const { cells } = await extractDocumentCells({
            fields: [{ id: "parties", name: "Parties", type: "list" }],
            document: doc(passages),
            extract: model.extract,
        });
        expect(cells.parties).toEqual({
            status: "found",
            value: ["Acme Ltd", "Borealis GmbH", "Cobalt Inc"],
            quote: first,
            page: 2,
            via: "text",
        });
    });

    it("coerces each field by its type and caps the quote", async () => {
        const text =
            "Signed on March 5, 2025. Auto-renewal applies to this Agreement: 是. " +
            `${"The supplier shall keep the premises insured at all times. ".repeat(10)}`;
        const longQuote = "The supplier shall keep the premises insured at all times. "
            .repeat(10)
            .trim();
        const model = fakeExtract(() => [
            {
                field: "d",
                found: true,
                value: "March 5, 2025",
                quote: "Signed on March 5, 2025.",
                passage: 1,
            },
            {
                field: "b",
                found: true,
                value: "是",
                quote: "Auto-renewal applies to this Agreement: 是.",
                passage: 1,
            },
            { field: "t", found: true, value: " insured ", quote: longQuote, passage: 1 },
        ]);
        const { cells } = await extractDocumentCells({
            fields: [
                { id: "d", name: "Signed", type: "date" },
                { id: "b", name: "Auto-renews", type: "boolean" },
                { id: "t", name: "Insurance", type: "text" },
            ],
            document: doc([{ text, page: 1 }]),
            extract: model.extract,
        });
        expect(cells.d!.value).toBe("2025-03-05");
        expect(cells.b!.value).toBe(true);
        expect(cells.t!.value).toBe("insured");
        expect(cells.t!.quote).toHaveLength(EXTRACTION_LIMITS.quoteLength);
    });

    it("throws with the usage so far when a call fails, rather than reporting half a document", async () => {
        const passages = Array.from({ length: 30 }, (_, i) => ({ text: filler(i), page: i + 1 }));
        let call = 0;
        const extract: ExtractStructuredFn = async args => {
            call++;
            if (call === 2) throw new Error("model overloaded");
            return {
                result: args.schema.parse({ answers: [] }),
                usage: { inputTokens: 50, outputTokens: 5 },
            };
        };
        const error = await extractDocumentCells({
            fields: FIELDS,
            document: doc(passages),
            extract,
        }).catch(e => e);
        expect(error).toBeInstanceOf(ExtractionCallError);
        expect(error.message).toBe("model overloaded");
        expect(error.usage.calls).toBe(2);
    });

    it("makes no call for a document with no text and returns a cell for every field", async () => {
        const model = fakeExtract(() => []);
        const { cells, usage } = await extractDocumentCells({
            fields: FIELDS,
            document: doc([]),
            extract: model.extract,
        });
        expect(cells).toEqual({ f1: NOT_FOUND, f2: NOT_FOUND });
        expect(usage.calls).toBe(0);
        expect(model.prompts).toEqual([]);
    });
});

// ─── Vision fallback (C7) ────────────────────────────────────────────────────

describe("vision fallback", () => {
    const table = baseTable();
    const row = baseRow(1);

    function fakeVision(result: Awaited<ReturnType<ReadImageFieldsFn>>) {
        const calls: ExtractionField[][] = [];
        const readImageFields: ReadImageFieldsFn = async args => {
            calls.push(args.fields);
            return result;
        };
        return { readImageFields, calls };
    }

    const visionTotal: ExtractionCells = {
        f1: { status: "found", value: 88, quote: "TOTAL 88.00", page: 1, via: "vision" },
        // Not asked for; must not overwrite what the text gave.
        f2: { status: "found", value: "Nowhere", quote: "x", page: 1, via: "vision" },
    };

    it("is called for an image with a missing field, with only the missing fields", async () => {
        const vision = fakeVision({
            cells: visionTotal,
            usage: { inputTokens: 700, outputTokens: 30 },
        });
        const { cells, usage } = await extractDocumentCells({
            fields: FIELDS,
            document: doc([{ text: GOVERNING, page: 1 }], { isImage: true, title: "scan.png" }),
            extract: fakeExtract(contractAnswers).extract,
            readImageFields: vision.readImageFields,
            table,
            row,
        });
        expect(vision.calls).toEqual([[FIELDS[0]]]);
        expect(cells.f1).toEqual({
            status: "found",
            value: 88,
            quote: "TOTAL 88.00",
            page: 1,
            via: "vision",
        });
        expect(cells.f2).toMatchObject({ status: "found", value: "Delaware", via: "text" });
        expect(usage).toEqual({ calls: 2, inputTokens: 800, outputTokens: 40 });
    });

    it("is called for an image with no text at all, with every field", async () => {
        const vision = fakeVision({
            cells: visionTotal,
            usage: { inputTokens: 1, outputTokens: 1 },
        });
        const model = fakeExtract(contractAnswers);
        const { cells } = await extractDocumentCells({
            fields: FIELDS,
            document: doc([], { isImage: true }),
            extract: model.extract,
            readImageFields: vision.readImageFields,
            table,
            row,
        });
        expect(model.prompts).toEqual([]);
        expect(vision.calls).toEqual([FIELDS]);
        expect(cells.f1!.via).toBe("vision");
        expect(cells.f2!.via).toBe("vision");
    });

    it("is not called for a PDF or text document, even with a missing field", async () => {
        const vision = fakeVision({
            cells: visionTotal,
            usage: { inputTokens: 1, outputTokens: 1 },
        });
        const { cells } = await extractDocumentCells({
            fields: FIELDS,
            document: doc([{ text: GOVERNING, page: 1 }], { isImage: false }),
            extract: fakeExtract(contractAnswers).extract,
            readImageFields: vision.readImageFields,
            table,
            row,
        });
        expect(vision.calls).toEqual([]);
        expect(cells.f1).toEqual(NOT_FOUND);
    });

    it("is not called for an image when the text answered every field", async () => {
        const vision = fakeVision({
            cells: visionTotal,
            usage: { inputTokens: 1, outputTokens: 1 },
        });
        const { cells } = await extractDocumentCells({
            fields: FIELDS,
            document: doc(
                [
                    { text: TOTAL, page: 1 },
                    { text: GOVERNING, page: 1 },
                ],
                { isImage: true }
            ),
            extract: fakeExtract(contractAnswers).extract,
            readImageFields: vision.readImageFields,
            table,
            row,
        });
        expect(vision.calls).toEqual([]);
        expect(cells.f1!.via).toBe("text");
        expect(cells.f2!.via).toBe("text");
    });

    it("leaves the fields not found when no vision model is available (null)", async () => {
        const vision = fakeVision(null);
        const { cells, usage } = await extractDocumentCells({
            fields: FIELDS,
            document: doc([{ text: GOVERNING, page: 1 }], { isImage: true }),
            extract: fakeExtract(contractAnswers).extract,
            readImageFields: vision.readImageFields,
            table,
            row,
        });
        expect(vision.calls.length).toBe(1);
        expect(cells.f1).toEqual(NOT_FOUND);
        expect(usage.calls).toBe(1);
    });

    it("ignores vision cells that are not found", async () => {
        const vision = fakeVision({
            cells: {
                f1: { status: "not_found", value: null, quote: null, page: null, via: "vision" },
            },
            usage: { inputTokens: 1, outputTokens: 1 },
        });
        const { cells } = await extractDocumentCells({
            fields: FIELDS,
            document: doc([{ text: GOVERNING, page: 1 }], { isImage: true }),
            extract: fakeExtract(contractAnswers).extract,
            readImageFields: vision.readImageFields,
            table,
            row,
        });
        expect(cells.f1).toEqual(NOT_FOUND);
    });
});

// ─── advanceTable ────────────────────────────────────────────────────────────

describe("advanceTable", () => {
    it("skips an unknown table and a table that already ended", async () => {
        const store = memoryStore(baseTable({ status: "done" }), [baseRow(1)]);
        expect(await advanceTable(ports(store), 1)).toEqual({ state: "skipped" });
        expect(await advanceTable(ports(store), 404)).toEqual({ state: "skipped" });
        expect(store.rows.get(1)!.status).toBe("pending");
        for (const status of ["failed", "cancelled"] as const) {
            const ended = memoryStore(baseTable({ status }), [baseRow(1)]);
            expect(await advanceTable(ports(ended), 1)).toEqual({ state: "skipped" });
        }
    });

    it("processes 5 rows in two units at concurrency 3, then finishes done", async () => {
        const store = memoryStore(
            baseTable(),
            [1, 2, 3, 4, 5].map(id => baseRow(id))
        );
        const p = ports(store);

        expect(await advanceTable(p, 1)).toEqual({ state: "advanced", processed: 3 });
        expect(store.tables.get(1)!.status).toBe("running");
        expect(store.tables.get(1)!.startedAt).toEqual(new Date("2026-11-12T10:00:00Z"));
        expect([...store.rows.values()].map(r => r.status)).toEqual([
            "done",
            "done",
            "done",
            "pending",
            "pending",
        ]);

        expect(await advanceTable(p, 1)).toEqual({ state: "advanced", processed: 2 });
        expect([...store.rows.values()].every(r => r.status === "done")).toBe(true);

        expect(await advanceTable(p, 1)).toEqual({ state: "finished", status: "done" });
        const table = store.tables.get(1)!;
        expect(table.status).toBe("done");
        expect(table.error).toBeNull();
        expect(table.finishedAt).toEqual(new Date("2026-11-12T10:00:00Z"));
        // One call per document.
        expect(table.usage).toEqual({ calls: 5, inputTokens: 500, outputTokens: 50 });

        const row = store.rows.get(4)!;
        expect(row.attempts).toBe(1);
        expect(row.cells.f1).toMatchObject({ status: "found", value: 1250.5, page: 1 });
        expect(row.cells.f2).toMatchObject({ status: "found", value: "Delaware", page: 2 });

        expect(await advanceTable(p, 1)).toEqual({ state: "skipped" });
    });

    it("fails only the row whose document throws", async () => {
        const store = memoryStore(
            baseTable(),
            [1, 2, 3].map(id => baseRow(id))
        );
        const base = ports(store);
        const p = ports(store, {
            async readDocument(table, row) {
                if (row.id === 2) throw new Error("storage timed out");
                return base.readDocument(table, row);
            },
        });
        expect(await advanceTable(p, 1)).toEqual({ state: "advanced", processed: 3 });
        expect(store.rows.get(1)!.status).toBe("done");
        expect(store.rows.get(3)!.status).toBe("done");
        expect(store.rows.get(2)!.status).toBe("failed");
        expect(store.rows.get(2)!.error).toBe("This file could not be read: storage timed out");
        expect(p.logs).toEqual(["extraction row failed"]);
        expect(await advanceTable(p, 1)).toEqual({ state: "finished", status: "done" });
    });

    it("fails only the row whose model call throws, and still counts its usage", async () => {
        const store = memoryStore(
            baseTable(),
            [1, 2].map(id => baseRow(id))
        );
        const model = fakeExtract(contractAnswers);
        const p = ports(store, {
            async readDocument(_table, row) {
                return doc([{ text: row.id === 1 ? "POISON " + TOTAL : TOTAL, page: 1 }]);
            },
            extract: async args => {
                if (args.prompt.includes("POISON")) throw new Error("bad response");
                return model.extract(args);
            },
        });
        expect(await advanceTable(p, 1)).toEqual({ state: "advanced", processed: 2 });
        expect(store.rows.get(1)!.status).toBe("failed");
        expect(store.rows.get(1)!.error).toContain("bad response");
        expect(store.rows.get(2)!.status).toBe("done");
        expect(store.tables.get(1)!.usage.calls).toBe(1);
    });

    it("fails a row whose document is gone, with the plain reason", async () => {
        const store = memoryStore(
            baseTable(),
            [1, 2].map(id => baseRow(id))
        );
        const base = ports(store);
        const p = ports(store, {
            async readDocument(table, row) {
                return row.id === 1 ? null : base.readDocument(table, row);
            },
        });
        expect(await advanceTable(p, 1)).toEqual({ state: "advanced", processed: 2 });
        expect(store.rows.get(1)).toMatchObject({
            status: "failed",
            error: "This file is no longer available.",
        });
        expect(DOCUMENT_UNAVAILABLE_MESSAGE).toBe("This file is no longer available.");
        expect(store.rows.get(2)!.status).toBe("done");
    });

    it("finishes failed, with a plain sentence, when every row failed", async () => {
        const store = memoryStore(
            baseTable(),
            [1, 2].map(id => baseRow(id))
        );
        const p = ports(store, {
            async readDocument() {
                return null;
            },
        });
        expect(await advanceTable(p, 1)).toEqual({ state: "advanced", processed: 2 });
        expect(await advanceTable(p, 1)).toEqual({ state: "finished", status: "failed" });
        expect(store.tables.get(1)).toMatchObject({
            status: "failed",
            error: ALL_ROWS_FAILED_MESSAGE,
        });
    });

    it("finishes done when the table has no rows", async () => {
        const store = memoryStore(baseTable(), []);
        expect(await advanceTable(ports(store), 1)).toEqual({ state: "finished", status: "done" });
    });

    it("cancels before claiming anything, leaving rows as they are", async () => {
        const store = memoryStore(baseTable({ status: "running", cancelRequestedAt: new Date() }), [
            baseRow(1, { status: "running", attempts: 1 }),
            baseRow(2),
        ]);
        const model = fakeExtract(contractAnswers);
        const p = ports(store, { extract: model.extract });
        expect(await advanceTable(p, 1)).toEqual({ state: "finished", status: "cancelled" });
        expect(store.tables.get(1)).toMatchObject({ status: "cancelled", error: null });
        expect(store.rows.get(1)!.status).toBe("running");
        expect(store.rows.get(2)!.status).toBe("pending");
        expect(model.prompts).toEqual([]);
        expect(await advanceTable(p, 1)).toEqual({ state: "skipped" });
    });

    it("waits, without finishing, while another worker still holds rows", async () => {
        const store = memoryStore(baseTable({ status: "running" }), [
            baseRow(1, { status: "running", attempts: 1 }),
            baseRow(2, { status: "done" }),
        ]);
        expect(await advanceTable(ports(store), 1)).toEqual({ state: "advanced", processed: 0 });
        expect(store.tables.get(1)!.status).toBe("running");
    });

    it("stores not-found cells, with no model call, for a document with no text", async () => {
        const store = memoryStore(baseTable(), [baseRow(1)]);
        const model = fakeExtract(contractAnswers);
        const p = ports(store, {
            extract: model.extract,
            async readDocument() {
                return doc([{ text: "   ", page: 1 }]);
            },
        });
        expect(await advanceTable(p, 1)).toEqual({ state: "advanced", processed: 1 });
        expect(model.prompts).toEqual([]);
        expect(store.rows.get(1)).toMatchObject({
            status: "done",
            cells: { f1: NOT_FOUND, f2: NOT_FOUND },
        });
    });

    it("hands the table and row to the vision reader for an image with no text", async () => {
        const store = memoryStore(baseTable(), [baseRow(1)]);
        const seen: Array<{ tableId: number; rowId: number; fields: string[] }> = [];
        const p = ports(store, {
            async readDocument() {
                return doc([], { isImage: true, title: "receipt.jpg" });
            },
            readImageFields: async args => {
                seen.push({
                    tableId: args.table.id,
                    rowId: args.row.id,
                    fields: args.fields.map(f => f.id),
                });
                return {
                    cells: {
                        f1: {
                            status: "found",
                            value: 42,
                            quote: "TOTAL 42",
                            page: null,
                            via: "vision",
                        },
                    },
                    usage: { inputTokens: 900, outputTokens: 20 },
                };
            },
        });
        expect(await advanceTable(p, 1)).toEqual({ state: "advanced", processed: 1 });
        expect(seen).toEqual([{ tableId: 1, rowId: 1, fields: ["f1", "f2"] }]);
        expect(store.rows.get(1)!.cells).toEqual({
            f1: { status: "found", value: 42, quote: "TOTAL 42", page: null, via: "vision" },
            f2: NOT_FOUND,
        });
        expect(store.tables.get(1)!.usage).toEqual({
            calls: 1,
            inputTokens: 900,
            outputTokens: 20,
        });
    });

    it("rethrows a storage failure after the other rows have settled", async () => {
        const store = memoryStore(
            baseTable(),
            [1, 2].map(id => baseRow(id))
        );
        const complete = store.completeRow.bind(store);
        store.completeRow = async (rowId, cells) => {
            if (rowId === 1) throw new Error("connection lost");
            return complete(rowId, cells);
        };
        await expect(advanceTable(ports(store), 1)).rejects.toThrow("connection lost");
        expect(store.rows.get(2)!.status).toBe("done");
        expect(store.tables.get(1)!.usage.calls).toBe(2);
    });
});
