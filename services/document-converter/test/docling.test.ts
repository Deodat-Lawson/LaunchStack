/**
 * The docling-serve request contract: /convert must ASK for page-break
 * markers (`md_page_break_placeholder`) or every multi-page PDF collapses to
 * one page. The marker sent must be the exact string evidence.ts splits on —
 * these tests pin that round trip. Servers that ignore the option are still
 * covered by the single-page + warning fallback in evidence.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { doclingConvertFile } from "../src/docling.js";
import { PAGE_BREAK_PLACEHOLDER, markdownToEvidenceDocument } from "../src/evidence.js";
import { testConfig } from "./helpers.js";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("doclingConvertFile outgoing request", () => {
    it("asks docling-serve for explicit page-break markers", async () => {
        const captured: { url?: string; form?: FormData } = {};
        vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit): Promise<Response> => {
            captured.url = String(url);
            captured.form = init?.body as FormData;
            return new Response(JSON.stringify({ document: { md_content: "# ok" } }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        });

        const markdown = await doclingConvertFile(
            testConfig({ doclingServeUrl: "http://docling.test:5001" }),
            Buffer.from("%PDF-1.4 fake bytes"),
            "q3.pdf"
        );

        expect(markdown).toBe("# ok");
        expect(captured.url).toBe("http://docling.test:5001/v1/convert/file");
        const form = captured.form;
        expect(form).toBeInstanceOf(FormData);
        expect(form!.get("md_page_break_placeholder")).toBe(PAGE_BREAK_PLACEHOLDER);
        // Pre-existing conversion parameters stay intact.
        expect(form!.get("to_formats")).toBe('["md"]');
        expect(form!.get("do_ocr")).toBe("true");
        expect(form!.get("do_table_structure")).toBe("true");
        expect(form!.get("image_export_mode")).toBe("placeholder");
    });

    it("sends the exact marker evidence.ts splits pages on", () => {
        expect(PAGE_BREAK_PLACEHOLDER).toBe("<!-- page break -->");
        const doc = markdownToEvidenceDocument(`page one${PAGE_BREAK_PLACEHOLDER}page two`, {});
        expect(doc.pages.map(p => p.text)).toEqual(["page one", "page two"]);
        expect(doc.warnings).toEqual([]);
    });
});
