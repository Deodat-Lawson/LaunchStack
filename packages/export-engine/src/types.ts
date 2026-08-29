/**
 * Types for the Gotenberg document-rendering service (ADR-009).
 *
 * Gotenberg is an off-the-shelf container (gotenberg/gotenberg:8), so unlike
 * the adeu contract there is no schema of ours to mirror — these types cover
 * the slice of its multipart API LaunchStack uses, not the whole surface.
 * Reference: https://gotenberg.dev/docs/routes
 */

/** Connection settings for one Gotenberg deployment. */
export interface GotenbergConfig {
    /** Origin of the service, e.g. `http://gotenberg:3000`. */
    baseUrl: string;
    /**
     * Basic-auth credentials — both or neither. The Compose service runs with
     * `--api-enable-basic-auth`, so omitting them there means every call
     * returns 401 rather than running unauthenticated.
     */
    username?: string;
    password?: string;
    /** Per-request budget in milliseconds. Default 60s — LibreOffice restarts mid-batch and large documents are slow. */
    timeoutMs?: number;
}

/** Anything the client will accept as file content. */
export type BinaryInput = Buffer | Blob | Uint8Array | ArrayBuffer | string;

/** An extra file (image, stylesheet, font) referenced by relative path from the HTML. */
export interface RenderAsset {
    filename: string;
    content: BinaryInput;
}

/**
 * Print settings for the Chromium routes. Dimensions are inches — Chromium's
 * native print unit, and what Gotenberg parses a bare number as.
 */
export interface ChromiumPageProperties {
    paperWidth?: number;
    paperHeight?: number;
    marginTop?: number;
    marginBottom?: number;
    marginLeft?: number;
    marginRight?: number;
    landscape?: boolean;
    /** 0.1 – 2.0. */
    scale?: number;
    printBackground?: boolean;
    /** Let a CSS `@page size` in the document win over paperWidth/paperHeight. */
    preferCssPageSize?: boolean;
}

/** The two paper sizes the product exposes, in inches. */
export const PAPER_SIZES = {
    letter: { paperWidth: 8.5, paperHeight: 11 },
    a4: { paperWidth: 8.27, paperHeight: 11.69 },
} as const satisfies Record<string, ChromiumPageProperties>;

export interface HtmlToPdfParams {
    /** A complete HTML document; becomes Gotenberg's `index.html`. */
    html: string;
    assets?: RenderAsset[];
    pageProperties?: ChromiumPageProperties;
}

export interface MarkdownToPdfParams {
    markdown: string;
    /**
     * Optional HTML shell. Must reference `{{ toHTML "content.md" }}` — that
     * is the Go-template hook Gotenberg substitutes the rendered Markdown
     * into. Omitted, a minimal document-styled shell is used.
     */
    wrapperHtml?: string;
    assets?: RenderAsset[];
    pageProperties?: ChromiumPageProperties;
}

export interface OfficeToPdfParams {
    /** The document bytes. */
    file: BinaryInput;
    /**
     * Filename WITH its extension — Gotenberg picks the LibreOffice import
     * filter from it (`contract.docx`, `sheet.xlsx`).
     */
    filename: string;
    landscape?: boolean;
    /** Page ranges in LibreOffice syntax, e.g. `"1-4"`. */
    nativePageRanges?: string;
    /** Produce an archival PDF/A instead of a plain PDF. */
    pdfa?: "PDF/A-1b" | "PDF/A-2b" | "PDF/A-3b";
    /** Enable PDF/UA accessibility markup. */
    pdfua?: boolean;
}

export interface RenderedPdf {
    /** The PDF bytes. */
    pdf: Buffer;
    /** Gotenberg's per-request trace id — quote it when reading the service's logs. */
    trace: string | null;
}

/**
 * File extensions the LibreOffice route is asked to handle. Gotenberg accepts
 * many more; this is the curated product surface, and the gate web routes
 * check before shipping a document to the service.
 */
export const OFFICE_CONVERTIBLE_EXTENSIONS: ReadonlySet<string> = new Set([
    "doc",
    "docm",
    "docx",
    "dot",
    "dotx",
    "odt",
    "ott",
    "rtf",
    "txt",
    "csv",
    "ods",
    "ots",
    "xls",
    "xlsm",
    "xlsx",
    "odp",
    "otp",
    "ppt",
    "pptx",
]);
