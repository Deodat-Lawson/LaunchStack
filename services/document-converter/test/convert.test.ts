import { afterEach, describe, expect, it } from "vitest";

import type { EvidenceDocument } from "../src/contracts.js";
import { ServiceError } from "../src/errors.js";
import { NO_PAGE_BOUNDARIES_WARNING } from "../src/evidence.js";
import {
    ALLOWED_ORIGIN,
    bytesFetch,
    expectValidEvidenceDocument,
    postJson,
    startApp,
    testConfig,
    type TestServer,
} from "./helpers.js";

const FILE_URL = `${ALLOWED_ORIGIN}/reports/q3.pdf`;
const FILE_BYTES = new TextEncoder().encode("%PDF-1.4 fake bytes");

const PAGED_MARKDOWN = [
    "# Quarterly Report",
    "",
    "Intro paragraph one.",
    "Continues on a second line.",
    "<!-- page break -->",
    "## Financials",
    "",
    "| Quarter | Revenue |",
    "| ------- | ------- |",
    "| Q3      | $1.2M   |",
    "",
    "Closing remarks.",
    "\fAppendix content on page three.",
].join("\n");

// `---` here is a thematic break, NOT a page boundary — the old worker
// mislabeled it as one.
const UNPAGED_MARKDOWN = [
    "# Title",
    "",
    "Some text before the thematic break.",
    "",
    "---",
    "",
    "Some text after the thematic break.",
].join("\n");

let server: TestServer | undefined;
afterEach(async () => {
    await server?.close();
    server = undefined;
});

describe("POST /convert", () => {
    it("returns a typed 503 when docling-serve is not configured", async () => {
        server = await startApp(testConfig(), {
            fetchImpl: bytesFetch(FILE_BYTES),
        });
        const res = await postJson(server.url, "/convert", {
            schemaVersion: 1,
            url: FILE_URL,
        });
        expect(res.status).toBe(503);
        const payload = (await res.json()) as {
            error: { code: string; traceId?: string };
        };
        expect(payload.error.code).toBe("docling-not-configured");
        expect(payload.error.traceId).toBeTruthy();
    });

    it("maps a docling-serve failure to a typed 502", async () => {
        server = await startApp(testConfig({ doclingServeUrl: "http://docling.test:5001" }), {
            fetchImpl: bytesFetch(FILE_BYTES),
            doclingConvert: async () => {
                throw new ServiceError(
                    502,
                    "docling-failed",
                    "docling-serve request failed: connect ECONNREFUSED"
                );
            },
        });
        const res = await postJson(server.url, "/convert", {
            schemaVersion: 1,
            url: FILE_URL,
        });
        expect(res.status).toBe(502);
        const payload = (await res.json()) as {
            error: { code: string; message: string; traceId?: string };
        };
        expect(payload.error.code).toBe("docling-failed");
        expect(payload.error.traceId).toBeTruthy();
    });

    it("maps markdown with explicit page-break markers to real pages", async () => {
        const uploads: Array<{ filename: string; bytes: number }> = [];
        server = await startApp(testConfig({ doclingServeUrl: "http://docling.test:5001" }), {
            fetchImpl: bytesFetch(FILE_BYTES),
            doclingConvert: async (_config, file, filename) => {
                uploads.push({ filename, bytes: file.byteLength });
                return PAGED_MARKDOWN;
            },
        });
        const res = await postJson(server.url, "/convert", {
            schemaVersion: 1,
            url: FILE_URL,
            filename: "q3.pdf",
            mimeType: "application/pdf",
        });
        expect(res.status).toBe(200);
        const doc = (await res.json()) as EvidenceDocument;
        expectValidEvidenceDocument(doc);

        expect(doc.provider).toBe("docling");
        expect(doc.schemaVersion).toBe(1);
        expect(doc.markdown).toBe(PAGED_MARKDOWN);
        expect(doc.warnings).toEqual([]);
        expect(doc.source).toEqual({
            filename: "q3.pdf",
            mimeType: "application/pdf",
            pageCount: 3,
        });

        expect(doc.pages).toHaveLength(3);
        expect(doc.pages.map(p => p.pageNumber)).toEqual([1, 2, 3]);
        expect(doc.pages[0].text).toContain("Quarterly Report");
        expect(doc.pages[2].text).toBe("Appendix content on page three.");

        // Pipe table on page 2 becomes a `table` block carrying its markdown.
        const tableBlocks = doc.pages[1].blocks!.filter(b => b.type === "table");
        expect(tableBlocks).toHaveLength(1);
        expect(tableBlocks[0].text).toContain("| Quarter | Revenue |");

        // The fabricated confidence (old hardcoded 92.0) must not reappear.
        expect(doc).not.toHaveProperty("confidence");

        // The docling upload used the fetched bytes and the request filename.
        expect(uploads).toEqual([{ filename: "q3.pdf", bytes: FILE_BYTES.byteLength }]);
    });

    it("does NOT fabricate pages from --- and says so in warnings", async () => {
        server = await startApp(testConfig({ doclingServeUrl: "http://docling.test:5001" }), {
            fetchImpl: bytesFetch(FILE_BYTES),
            doclingConvert: async () => UNPAGED_MARKDOWN,
        });
        const res = await postJson(server.url, "/convert", {
            schemaVersion: 1,
            url: FILE_URL,
        });
        expect(res.status).toBe(200);
        const doc = (await res.json()) as EvidenceDocument;
        expectValidEvidenceDocument(doc);

        expect(doc.pages).toHaveLength(1);
        expect(doc.pages[0].pageNumber).toBe(1);
        expect(doc.pages[0].text).toContain("before the thematic break");
        expect(doc.pages[0].text).toContain("after the thematic break");
        expect(doc.warnings).toEqual([NO_PAGE_BOUNDARIES_WARNING]);
        // No real boundaries -> no claimed pageCount.
        expect(doc.source.pageCount).toBeUndefined();
        expect(doc).not.toHaveProperty("confidence");
    });

    it("handles empty markdown honestly", async () => {
        server = await startApp(testConfig({ doclingServeUrl: "http://docling.test:5001" }), {
            fetchImpl: bytesFetch(FILE_BYTES),
            doclingConvert: async () => "",
        });
        const res = await postJson(server.url, "/convert", {
            schemaVersion: 1,
            url: FILE_URL,
        });
        expect(res.status).toBe(200);
        const doc = (await res.json()) as EvidenceDocument;
        expectValidEvidenceDocument(doc);
        expect(doc.pages).toHaveLength(1);
        expect(doc.pages[0].text).toBe("");
        expect(doc.warnings).toEqual([NO_PAGE_BOUNDARIES_WARNING]);
    });

    it("rejects an invalid body", async () => {
        server = await startApp(testConfig({ doclingServeUrl: "http://docling.test:5001" }), {
            fetchImpl: bytesFetch(FILE_BYTES),
        });
        const res = await postJson(server.url, "/convert", {
            schemaVersion: 1,
            url: "not a url",
        });
        expect(res.status).toBe(400);
        const payload = (await res.json()) as { error: { code: string } };
        expect(payload.error.code).toBe("invalid-request");
    });
});
