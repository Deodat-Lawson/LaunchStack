import { configureStorage } from "@launchstack/runtime";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureOcr } from "../config";
import { createAzureAdapter, planAnalysisRanges } from "./azureAdapter";

/**
 * Azure throttles with 429 + Retry-After and bills every submission, so the
 * adapter waits rather than fails: a submit is retried on 429/5xx, a poll on
 * anything transient (giving up would make the outbox resubmit and pay
 * again), and a book gets a real time budget instead of two minutes. S0 reads
 * at most 2,000 pages per request, so longer PDFs go in page ranges.
 */

const OPERATION = "https://azure.test/documentintelligence/operations/1";

const accepted = (retryAfter?: string) =>
    new Response(null, {
        status: 202,
        headers: {
            "Operation-Location": OPERATION,
            ...(retryAfter ? { "retry-after": retryAfter } : {}),
        },
    });
const throttled = (retryAfter: string) =>
    new Response('{"error":{"code":"429"}}', {
        status: 429,
        headers: { "retry-after": retryAfter },
    });
const running = () => Response.json({ status: "running" });
const succeeded = () =>
    Response.json({
        status: "succeeded",
        analyzeResult: {
            pages: [{ pageNumber: 1, spans: [] }],
            paragraphs: [
                {
                    content: "Page one",
                    boundingRegions: [{ pageNumber: 1, boundingBox: [] }],
                    spans: [],
                },
            ],
        },
    });

/** Answers submits and polls from their own queues; polls default to "running". */
function azure(submits: Array<() => Response>, polls: Array<() => Response>) {
    const calls = { submits: 0, polls: 0, submitUrls: [] as string[] };
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
            if (init?.method === "POST") {
                calls.submits++;
                calls.submitUrls.push(url);
                const next = submits.shift();
                if (!next) throw new Error("unexpected submit");
                return next();
            }
            calls.polls++;
            return (polls.shift() ?? running)();
        })
    );
    return calls;
}

function upload() {
    const adapter = createAzureAdapter("https://azure.test", "test-key");
    const pending = adapter.uploadDocument("https://files.test/book.pdf");
    // Observe the outcome now so a rejection under fake timers is never unhandled.
    const outcome = pending.then(
        doc => ({ doc, error: undefined }),
        (error: Error) => ({ doc: undefined, error })
    );
    return outcome;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    configureStorage({
        provider: "test",
        upload: vi.fn(),
        delete: vi.fn(),
        download: vi.fn(
            async () => new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } })
        ),
    });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("AzureDocumentIntelligenceAdapter", () => {
    it("waits out a throttled submit for as long as Retry-After says", async () => {
        const calls = azure([() => throttled("3"), () => accepted()], [succeeded]);

        const outcome = upload();
        await vi.advanceTimersByTimeAsync(2999);
        expect(calls.submits).toBe(1);
        await vi.advanceTimersByTimeAsync(1 + 2000);

        const { doc, error } = await outcome;
        expect(error).toBeUndefined();
        expect(calls.submits).toBe(2);
        expect(doc?.pages[0]?.textBlocks).toEqual(["Page one"]);
    });

    it("keeps polling through throttled, failing, and unreachable polls", async () => {
        const calls = azure(
            [() => accepted("1")],
            [
                () => throttled("5"),
                () => new Response("upstream", { status: 503 }),
                () => {
                    throw new TypeError("fetch failed");
                },
                running,
                succeeded,
            ]
        );

        const outcome = upload();
        await vi.advanceTimersByTimeAsync(60_000);

        const { error } = await outcome;
        expect(error).toBeUndefined();
        expect(calls.polls).toBe(5);
        expect(calls.submits).toBe(1);
    });

    it("gives an analysis 15 minutes before timing out", async () => {
        azure([() => accepted()], []);

        const outcome = upload();
        await vi.advanceTimersByTimeAsync(14 * 60_000);
        let settled = false;
        void outcome.then(() => (settled = true));
        await vi.advanceTimersByTimeAsync(0);
        expect(settled).toBe(false);

        await vi.advanceTimersByTimeAsync(2 * 60_000);
        const { error } = await outcome;
        expect(error?.message).toMatch(/timed out after 15 minutes/);
    });

    it("does not retry a submit Azure refuses outright", async () => {
        const calls = azure(
            [() => new Response('{"error":{"code":"InvalidRequest"}}', { status: 400 })],
            []
        );

        const { error } = await upload();

        expect(error?.message).toMatch(/Azure Document Intelligence submit failed: 400/);
        expect(calls.submits).toBe(1);
    });

    it("stops polling when the operation is gone", async () => {
        const calls = azure([() => accepted()], [() => new Response("gone", { status: 404 })]);

        const outcome = upload();
        await vi.advanceTimersByTimeAsync(2000);

        const { error } = await outcome;
        expect(error?.message).toBe("Azure polling failed: 404");
        expect(calls.polls).toBe(1);
    });

    it("uses the layout model unless configured otherwise", async () => {
        const calls = azure([() => accepted()], [succeeded]);

        const outcome = upload();
        await vi.advanceTimersByTimeAsync(2000);
        await outcome;

        expect(calls.submitUrls[0]).toContain("/documentModels/prebuilt-layout:analyze");
    });

    it("uses the read model when AZURE_DOC_INTELLIGENCE_MODEL asks for it", async () => {
        configureOcr({
            azure: { endpoint: "https://azure.test", key: "test-key", model: "prebuilt-read" },
        });
        const calls = azure([() => accepted()], [succeeded]);

        const pending = createAzureAdapter().uploadDocument("https://files.test/book.pdf");
        await vi.advanceTimersByTimeAsync(2000);
        await pending;

        expect(calls.submitUrls[0]).toContain("/documentModels/prebuilt-read:analyze");
        configureOcr({});
    });
});

async function blankPdf(pages: number): Promise<ArrayBuffer> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i++) doc.addPage();
    const bytes = await doc.save();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("planAnalysisRanges", () => {
    beforeEach(() => vi.useRealTimers());

    it("sends a PDF of up to 2,000 pages whole", async () => {
        expect(await planAnalysisRanges(await blankPdf(3))).toEqual([
            { firstPage: 1, expectedPages: 3 },
        ]);
    });

    it("splits a longer PDF into 2,000-page ranges", async () => {
        expect(await planAnalysisRanges(await blankPdf(2001))).toEqual([
            { pages: "1-2000", firstPage: 1, expectedPages: 2000 },
            { pages: "2001-2001", firstPage: 2001, expectedPages: 1 },
        ]);
    });

    it("sends anything that is not a PDF whole", async () => {
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;
        expect(await planAnalysisRanges(png)).toEqual([{ firstPage: 1 }]);
    });
});

describe("a PDF over 2,000 pages", () => {
    it("is analyzed range by range and comes back as one document in page order", async () => {
        vi.useRealTimers();
        const book = await blankPdf(2001);
        vi.useFakeTimers();
        configureStorage({
            provider: "test",
            upload: vi.fn(),
            delete: vi.fn(),
            download: vi.fn(
                async () => new Response(book, { headers: { "content-type": "application/pdf" } })
            ),
        });

        const page = (pageNumber: number, content: string) => ({
            pages: [{ pageNumber, spans: [] }],
            paragraphs: [
                { content, boundingRegions: [{ pageNumber, boundingBox: [] }], spans: [] },
            ],
        });
        const submitUrls: string[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string, init?: RequestInit) => {
                if (init?.method === "POST") {
                    submitUrls.push(url);
                    const op = url.includes("pages=2001-2001") ? "tail" : "head";
                    return new Response(null, {
                        status: 202,
                        headers: { "Operation-Location": `https://azure.test/op/${op}` },
                    });
                }
                // The tail range comes back numbered from 1, as if it were its
                // own document; the adapter must put it back at page 2001.
                return Response.json({
                    status: "succeeded",
                    analyzeResult: url.endsWith("/tail")
                        ? page(1, "The last page")
                        : page(1, "The first page"),
                });
            })
        );

        const pending = createAzureAdapter("https://azure.test", "test-key").uploadDocument(
            "https://files.test/book.pdf"
        );
        await vi.advanceTimersByTimeAsync(5000);
        const doc = await pending;

        expect(submitUrls).toHaveLength(2);
        expect(submitUrls[0]).toContain("pages=1-2000");
        expect(submitUrls[1]).toContain("pages=2001-2001");
        expect(doc.pages.map(p => [p.pageNumber, p.textBlocks[0]])).toEqual([
            [1, "The first page"],
            [2001, "The last page"],
        ]);
    });
});
