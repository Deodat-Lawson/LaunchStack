/**
 * docling-serve client — the consolidation of the old ocr-worker's
 * docling_runner.py. Same conversion parameters (to_formats=["md"], do_ocr,
 * do_table_structure, image_export_mode=placeholder); failures surface as
 * typed ServiceErrors instead of opaque 500s.
 */
import type { Config } from "./config.js";
import type { ConvertRequest } from "./contracts.js";
import { ServiceError, errorMessage } from "./errors.js";
import { PAGE_BREAK_PLACEHOLDER } from "./evidence.js";

export type DoclingConvert = (config: Config, file: Buffer, filename: string) => Promise<string>;

export type DoclingHealth = (config: Config) => Promise<boolean>;

/** Upload the file to docling-serve and return the markdown it produced. */
export const doclingConvertFile: DoclingConvert = async (config, file, filename) => {
    if (!config.doclingServeUrl) {
        throw new ServiceError(
            503,
            "docling-not-configured",
            "DOCLING_SERVE_URL is not configured; /convert is unavailable on this deployment"
        );
    }

    const form = new FormData();
    form.append("files", new Blob([new Uint8Array(file)]), filename);
    form.append("to_formats", '["md"]');
    form.append("do_ocr", "true");
    form.append("do_table_structure", "true");
    form.append("image_export_mode", "placeholder");
    // Ask docling-serve to emit an explicit marker between pages — the exact
    // marker evidence.ts splits on. Without it every multi-page PDF collapses
    // to one "page". Servers that predate / ignore this option simply return
    // markdown with no markers, and evidence.ts falls back to a single page
    // plus NO_PAGE_BOUNDARIES_WARNING (unchanged behaviour).
    form.append("md_page_break_placeholder", PAGE_BREAK_PLACEHOLDER);

    let response: Response;
    try {
        response = await fetch(`${config.doclingServeUrl}/v1/convert/file`, {
            method: "POST",
            body: form,
            signal: AbortSignal.timeout(config.doclingServeTimeoutMs),
        });
    } catch (err) {
        throw new ServiceError(
            502,
            "docling-failed",
            `docling-serve request failed: ${errorMessage(err)}`
        );
    }

    if (!response.ok) {
        throw new ServiceError(
            502,
            "docling-failed",
            `docling-serve returned HTTP ${response.status}`
        );
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        throw new ServiceError(502, "docling-failed", "docling-serve returned a non-JSON response");
    }

    const root = payload as { document?: { md_content?: unknown } };
    const document = root?.document ?? (payload as { md_content?: unknown });
    const md = (document as { md_content?: unknown })?.md_content;
    return typeof md === "string" ? md : "";
};

/** Used by /readyz. Short timeout — this is a liveness probe, not a job. */
export const doclingHealthCheck: DoclingHealth = async config => {
    if (!config.doclingServeUrl) return true;
    const response = await fetch(`${config.doclingServeUrl}/health`, {
        signal: AbortSignal.timeout(3000),
    });
    return response.ok;
};

const MIME_SUFFIXES: Array<[RegExp, string]> = [
    [/pdf/, ".pdf"],
    [/officedocument\.wordprocessingml|msword|word/, ".docx"],
    [/presentationml|powerpoint/, ".pptx"],
    [/spreadsheetml|spreadsheet|excel/, ".xlsx"],
    [/html/, ".html"],
    [/png/, ".png"],
    [/jpe?g/, ".jpg"],
];

/**
 * docling-serve picks its input format from the uploaded filename's
 * extension. Derive one from the request filename, the URL path, or the
 * mime type (ported from ocr-worker's fetcher/_suffix_from_filename).
 */
export function resolveUploadFilename(request: ConvertRequest): string {
    let name = request.filename?.trim() ?? "";
    if (!name) {
        try {
            const path = new URL(request.url).pathname;
            name = decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "");
        } catch {
            name = "";
        }
    }
    if (!name) name = "document";
    if (name.includes(".")) return name;

    const mime = request.mimeType?.toLowerCase() ?? "";
    for (const [pattern, suffix] of MIME_SUFFIXES) {
        if (pattern.test(mime)) return name + suffix;
    }
    return name + ".bin";
}
