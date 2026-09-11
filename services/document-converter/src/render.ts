/**
 * PDF page rendering via pdf2pic (graphicsmagick + ghostscript), ported
 * unchanged from ocr-router: 200 dpi PNGs, 1024x1448.
 *
 * `pageNumbers` are 1-based (pdf2pic's native numbering). The /render-pages
 * wire contract uses 0-based indices; the endpoint translates.
 */
import { log } from "./logger.js";
import { errorMessage } from "./errors.js";

export type PageRenderer = (pdf: Buffer, pageNumbers: number[]) => Promise<Uint8Array[]>;

export const renderPdfPages: PageRenderer = async (pdf, pageNumbers) => {
    try {
        const { fromBuffer } = await import("pdf2pic");

        const converter = fromBuffer(pdf, {
            density: 200,
            format: "png",
            width: 1024,
            height: 1448,
        });

        const images: Uint8Array[] = [];

        for (const pageNumber of pageNumbers) {
            try {
                const result = await converter(pageNumber, { responseType: "buffer" });
                if (result?.buffer) {
                    images.push(result.buffer);
                }
            } catch (pageError) {
                const message = errorMessage(pageError);
                if (!message.includes("page number")) {
                    log("warn", "render: page failed", { pageNumber, message });
                }
            }
        }

        return images;
    } catch (err) {
        log("warn", "render: pdf rendering unavailable", {
            message: errorMessage(err),
        });
        return [];
    }
};
