import { throwIfChatAborted } from "~/lib/chat-stream";

const MAX_ATTACHMENT_PDF_PAGES = 40;

/** Use the same bundled PDF API/worker as server document ingestion. */
export async function extractChatPdfText(
    buffer: ArrayBuffer,
    signal: AbortSignal
): Promise<string> {
    throwIfChatAborted(signal);
    // pdfjs-serverless owns its matching worker. Importing a separate pdfjs-dist
    // API can reuse that global worker with an incompatible version.
    const { getDocument } = await import("pdfjs-serverless");
    throwIfChatAborted(signal);
    const loadingTask = getDocument({
        data: new Uint8Array(buffer),
        useSystemFonts: true,
        isEvalSupported: false,
    });
    let destroying: Promise<void> | undefined;
    const destroy = () => (destroying ??= loadingTask.destroy());
    const abort = () => {
        void destroy().catch(() => undefined);
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
        throwIfChatAborted(signal);
        const doc = await loadingTask.promise;
        const pages: string[] = [];
        const max = Math.min(doc.numPages, MAX_ATTACHMENT_PDF_PAGES);
        for (let index = 1; index <= max; index++) {
            throwIfChatAborted(signal);
            const page = await doc.getPage(index);
            try {
                const content = await page.getTextContent();
                throwIfChatAborted(signal);
                const text = content.items
                    .map(item => ("str" in item && typeof item.str === "string" ? item.str : ""))
                    .join(" ")
                    .replace(/\s+/g, " ")
                    .trim();
                if (text) pages.push(`--- Page ${index} ---\n${text}`);
            } finally {
                page.cleanup();
            }
        }
        if (pages.length > 0 && doc.numPages > max)
            pages.push(`[…${doc.numPages - max} more page(s) not extracted]`);
        return pages.join("\n\n");
    } catch (error) {
        throwIfChatAborted(signal);
        throw error;
    } finally {
        signal.removeEventListener("abort", abort);
        await destroy();
    }
}
