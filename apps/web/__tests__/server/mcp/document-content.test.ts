/**
 * What add_document stores for what an assistant sends: active content is
 * always stored as text/plain and marked as an artifact (it renders only in
 * the sandboxed viewer); documents are stored as Markdown or text; files are
 * typed by extension, and active file types get the artifact treatment too.
 */
import {
    fileTypesFor,
    firstLineTitle,
    prepareTextContent,
    safeFilename,
    titleFromFilename,
} from "~/server/mcp/document-content";

describe("prepareTextContent", () => {
    it("stores a Claude HTML artifact as text/plain, read as HTML, with the artifact type", () => {
        const prepared = prepareTextContent({
            content:
                "<!doctype html><html><head><title>Pricing calculator</title></head><body><script>1</script></body></html>",
            format: "html",
            origin: "claude-artifact",
        });
        expect(prepared).toMatchObject({
            storageMimeType: "text/plain",
            ingestMimeType: "text/html",
            artifactType: "html",
            suggestedTitle: "Pricing calculator",
        });
        expect(prepared.filename).toBe("Pricing-calculator.html");
    });

    it("treats HTML, SVG, React, Mermaid and code as artifacts whoever made them", () => {
        for (const format of ["html", "svg", "react", "mermaid", "code"] as const) {
            const prepared = prepareTextContent({ content: "x", format, origin: "chatgpt" });
            expect(prepared.artifactType).toBe(format);
            expect(prepared.storageMimeType).toBe("text/plain");
        }
    });

    it("catches unlabelled markup and stores it sandboxed", () => {
        const prepared = prepareTextContent({
            content: "<svg xmlns='http://www.w3.org/2000/svg'><circle r='4'/></svg>",
        });
        expect(prepared.artifactType).toBe("svg");
        expect(prepared.storageMimeType).toBe("text/plain");
    });

    it("stores a ChatGPT document as Markdown titled from its first heading", () => {
        const prepared = prepareTextContent({
            content: "Intro line\n\n# Go-to-market plan\n\nBody",
            format: "markdown",
            origin: "chatgpt",
        });
        expect(prepared).toMatchObject({
            storageMimeType: "text/markdown",
            ingestMimeType: "text/markdown",
            artifactType: null,
            suggestedTitle: "Go-to-market plan",
            filename: "Go-to-market-plan.md",
        });
    });

    it("keeps a Markdown Claude artifact an artifact, and plain text as text", () => {
        expect(
            prepareTextContent({ content: "# A", format: "markdown", origin: "claude-artifact" })
                .artifactType
        ).toBe("markdown");
        expect(prepareTextContent({ content: "notes", format: "text" })).toMatchObject({
            storageMimeType: "text/plain",
            filename: "notes.txt",
            artifactType: null,
        });
    });

    it("prefers the title the assistant gave", () => {
        expect(
            prepareTextContent({ content: "# Heading", format: "markdown", title: "Board memo" })
                .suggestedTitle
        ).toBe("Board memo");
    });
});

describe("fileTypesFor", () => {
    it("types office files, PDFs and images by extension", () => {
        expect(fileTypesFor("Q3 plan.pdf")).toEqual({
            storageMimeType: "application/pdf",
            ingestMimeType: "application/pdf",
            artifactType: null,
        });
        expect(fileTypesFor("memo.DOCX")?.ingestMimeType).toBe(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
    });

    it("stores HTML and SVG files as text/plain artifacts", () => {
        expect(fileTypesFor("page.html")).toEqual({
            storageMimeType: "text/plain",
            ingestMimeType: "text/html",
            artifactType: "html",
        });
        expect(fileTypesFor("logo.svg")?.artifactType).toBe("svg");
        expect(fileTypesFor("noext", "text/html")?.storageMimeType).toBe("text/plain");
    });

    it("falls back to a known declared MIME type and refuses unknown kinds", () => {
        expect(fileTypesFor("download", "application/pdf; charset=binary")?.ingestMimeType).toBe(
            "application/pdf"
        );
        expect(fileTypesFor("tool.exe")).toBeNull();
        expect(fileTypesFor("archive", "application/x-msdownload")).toBeNull();
    });
});

describe("names", () => {
    it("derives titles and storage-safe file names", () => {
        expect(titleFromFilename("/tmp/Board deck v2.pptx")).toBe("Board deck v2");
        expect(safeFilename("../../Board deck (final).pptx")).toBe("Board-deck-final.pptx");
        expect(firstLineTitle("\n\n**Hello** world")).toBe("Hello world");
        expect(firstLineTitle("   ")).toBeNull();
    });
});
