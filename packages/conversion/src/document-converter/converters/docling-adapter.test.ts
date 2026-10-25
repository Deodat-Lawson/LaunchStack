import { configureStorage } from "@launchstack/runtime";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentConverterError } from "../../ocr-processing/adapters/ossAdapter";
import { configureOcr } from "../../ocr-processing/config";
import { DoclingIngestionAdapter } from "./docling-adapter";

/**
 * The lean deployment runs the document converter without Docling behind it.
 * An Office file must then be converted by the built-in adapter for its
 * format, not failed: before this, every Word upload in production died with
 * "docling-serve request failed: fetch failed". A converter error about the
 * file itself must still stand.
 */

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FILE_URL = "https://files.test/documents/resume.docx";

async function makeDocx(text: string): Promise<Buffer> {
    const zip = new JSZip();
    zip.file(
        "[Content_Types].xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
            "</Types>"
    );
    zip.file(
        "_rels/.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
            "</Relationships>"
    );
    zip.file(
        "word/document.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
            `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
    );
    return zip.generateAsync({ type: "nodebuffer" });
}

/** The converter answers /convert with its typed error envelope. */
function converterAnswers(status: number, code: string) {
    vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
            Response.json({ error: { code, message: `converter said ${code}` } }, { status })
        )
    );
}

let download: ReturnType<typeof vi.fn>;

beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    configureOcr({ converter: { url: "http://converter.test", apiKey: "k" } });
    const docx = await makeDocx("Juan Martinez, software engineer");
    download = vi.fn(
        async () => new Response(new Uint8Array(docx), { headers: { "content-type": DOCX_MIME } })
    );
    configureStorage({ provider: "test", upload: vi.fn(), delete: vi.fn(), download });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    configureOcr({});
});

describe("DoclingIngestionAdapter", () => {
    it.each([
        ["the converter has no Docling", 503, "docling-not-configured"],
        ["the converter cannot reach Docling", 502, "docling-failed"],
    ])("converts a Word file itself when %s", async (_case, status, code) => {
        converterAnswers(status, code);

        const doc = await new DoclingIngestionAdapter().process(FILE_URL, {
            mimeType: DOCX_MIME,
            filename: "resume.docx",
        });

        expect(doc.metadata.provider).toBe("mammoth");
        expect(doc.pages.flatMap(page => page.textBlocks).join(" ")).toContain(
            "Juan Martinez, software engineer"
        );
        expect(download).toHaveBeenCalledWith(FILE_URL);
    });

    it("converts a Word file itself when the converter does not answer", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new TypeError("fetch failed");
            })
        );

        const doc = await new DoclingIngestionAdapter().process(FILE_URL, {
            mimeType: DOCX_MIME,
            filename: "resume.docx",
        });

        expect(doc.metadata.provider).toBe("mammoth");
    });

    it("keeps the converter's error when it is about the file, not Docling", async () => {
        converterAnswers(400, "url-not-allowed");

        const failure = new DoclingIngestionAdapter().process(FILE_URL, {
            mimeType: DOCX_MIME,
            filename: "resume.docx",
        });

        await expect(failure).rejects.toBeInstanceOf(DocumentConverterError);
        await expect(failure).rejects.toMatchObject({ status: 400, code: "url-not-allowed" });
        expect(download).not.toHaveBeenCalled();
    });

    it("keeps the error for a format no built-in adapter reads", async () => {
        converterAnswers(503, "docling-not-configured");

        await expect(
            new DoclingIngestionAdapter().process("https://files.test/book.epub", {
                mimeType: "application/epub+zip",
                filename: "book.epub",
            })
        ).rejects.toMatchObject({ code: "docling-not-configured" });
        expect(download).not.toHaveBeenCalled();
    });
});
