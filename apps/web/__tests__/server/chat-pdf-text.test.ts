import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const webRoot = resolve(__dirname, "../..");
const helper = pathToFileURL(resolve(webRoot, "src/server/chat-pdf-text.ts")).href;

function runNativePdfCheck(assertions: string): string {
    // Run actual ESM PDF packages, not a Jest mock/transpilation of the worker.
    // Warming the canonical stack reproduces the production global-worker state.
    return execFileSync(
        process.execPath,
        [
            "--import",
            "tsx",
            "--input-type=module",
            "-e",
            `
        import assert from "node:assert/strict";
        import { PDFDocument, StandardFonts } from "pdf-lib";
        import { getDocument } from "pdfjs-serverless";
        const { extractChatPdfText } = await import(${JSON.stringify(helper)});
        async function pdfBytes(count = 1, withText = true) {
            const pdf = await PDFDocument.create();
            const font = await pdf.embedFont(StandardFonts.Helvetica);
            for (let page = 1; page <= count; page++) {
                const pdfPage = pdf.addPage();
                if (withText) pdfPage.drawText("Real PDF attachment text page " + page, { font, x: 20, y: 30 });
            }
            return await pdf.save();
        }
        const warm = getDocument({ data: new Uint8Array(await pdfBytes()), useSystemFonts: true });
        await warm.promise;
        await warm.destroy();
        ${assertions}
        console.log("PASS native PDF regression");
    `,
        ],
        { cwd: webRoot, encoding: "utf8", timeout: 20_000 }
    );
}

test("extracts a real text-bearing PDF after ingestion initializes its matching worker", () => {
    expect(
        runNativePdfCheck(`
        const text = await extractChatPdfText((await pdfBytes()).buffer, new AbortController().signal);
        assert.ok(text.includes("--- Page 1 ---"), text);
        assert.ok(text.includes("Real PDF attachment text page 1"), text);
        const again = await extractChatPdfText((await pdfBytes()).buffer, new AbortController().signal);
        assert.equal(again, text);
    `)
    ).toContain("PASS native PDF regression");
});

test("keeps the real PDF page cap and explicit omitted-pages notice", () => {
    expect(
        runNativePdfCheck(`
        const text = await extractChatPdfText((await pdfBytes(42)).buffer, new AbortController().signal);
        assert.ok(text.includes("--- Page 40 ---"), text);
        assert.ok(!text.includes("--- Page 41 ---"), text);
        assert.ok(text.includes("[…2 more page(s) not extracted]"), text);
    `)
    ).toContain("PASS native PDF regression");
});

test("returns no text for a blank real PDF exceeding the page cap", () => {
    expect(
        runNativePdfCheck(`
        const text = await extractChatPdfText((await pdfBytes(42, false)).buffer, new AbortController().signal);
        assert.equal(text, "");
    `)
    ).toContain("PASS native PDF regression");
});

test("preserves cancellation and still reads a valid PDF after rejecting invalid bytes", () => {
    expect(
        runNativePdfCheck(`
        const stopped = new AbortController();
        stopped.abort();
        await assert.rejects(extractChatPdfText((await pdfBytes()).buffer, stopped.signal), { name: "AbortError" });
        const duringRead = new AbortController();
        const addListener = duringRead.signal.addEventListener.bind(duringRead.signal);
        let extractionStarted = false;
        duringRead.signal.addEventListener = (type, listener, options) => {
            addListener(type, listener, options);
            if (type === "abort") {
                extractionStarted = true;
                queueMicrotask(() => duringRead.abort());
            }
        };
        await assert.rejects(extractChatPdfText((await pdfBytes()).buffer, duringRead.signal), { name: "AbortError" });
        assert.equal(extractionStarted, true);
        assert.equal(duringRead.signal.aborted, true);
        await assert.rejects(extractChatPdfText(new TextEncoder().encode("not a PDF").buffer, new AbortController().signal));
        const text = await extractChatPdfText((await pdfBytes()).buffer, new AbortController().signal);
        assert.ok(text.includes("Real PDF attachment text page 1"), text);
    `)
    ).toContain("PASS native PDF regression");
});
