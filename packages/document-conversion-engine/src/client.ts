import type {
    BinaryInput,
    ChromiumPageProperties,
    GotenbergConfig,
    HtmlToPdfParams,
    MarkdownToPdfParams,
    OfficeToPdfParams,
    RenderAsset,
    RenderedPdf,
} from "./types";
import { OFFICE_CONVERTIBLE_EXTENSIONS } from "./types";

export class RenderingConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RenderingConfigError";
    }
}

export class RenderingServiceError extends Error {
    public readonly statusCode: number;
    public readonly detail: string;
    /** Gotenberg's per-request trace id, when the request reached the service. */
    public readonly trace: string | null;

    constructor(statusCode: number, detail: string, trace: string | null = null) {
        super(`Gotenberg service error (${statusCode}): ${detail}`);
        this.name = "RenderingServiceError";
        this.statusCode = statusCode;
        this.detail = detail;
        this.trace = trace;
    }
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * The shell the Markdown route uses when the caller supplies none.
 * `{{ toHTML "content.md" }}` is Gotenberg's substitution hook, not ours.
 */
const DEFAULT_MARKDOWN_WRAPPER = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Document</title>
    <style>
        body { font-family: Georgia, 'Times New Roman', serif; line-height: 1.6; color: #1a1a1a; }
        h1, h2, h3, h4, h5, h6 { font-family: 'Helvetica Neue', Arial, sans-serif; }
        pre, code { font-family: 'Courier New', monospace; background: #f4f4f4; }
        pre { padding: 1em; overflow-x: auto; }
    </style>
</head>
<body>{{ toHTML "content.md" }}</body>
</html>`;

function toBlob(input: BinaryInput): Blob {
    if (input instanceof Blob) return input;
    if (typeof input === "string") return new Blob([input]);
    if (input instanceof ArrayBuffer) return new Blob([new Uint8Array(input)]);
    // Copy: detaches the view from its pooled/shared backing buffer, which is
    // also what satisfies BlobPart's plain-ArrayBuffer requirement.
    return new Blob([new Uint8Array(input)]);
}

function appendPageProperties(form: FormData, props: ChromiumPageProperties | undefined): void {
    if (!props) return;
    for (const [key, value] of Object.entries(props)) {
        if (value !== undefined) form.append(key, String(value));
    }
}

function appendAssets(form: FormData, assets: RenderAsset[] | undefined): void {
    for (const asset of assets ?? []) {
        form.append("files", toBlob(asset.content), asset.filename);
    }
}

/**
 * Typed client for one Gotenberg deployment.
 *
 * Deliberately reads no `process.env` — connection settings are injected by
 * the composition root (ADR-008), so the same code serves the Compose
 * service, a managed Gotenberg, or a test double.
 */
export class GotenbergClient {
    private readonly baseUrl: string;
    private readonly headers: Record<string, string>;
    private readonly timeoutMs: number;

    constructor(config: GotenbergConfig) {
        if (!config.baseUrl) {
            throw new RenderingConfigError(
                "baseUrl is required — the origin of the Gotenberg service, e.g. http://gotenberg:3000"
            );
        }
        this.baseUrl = config.baseUrl.replace(/\/+$/, "");
        this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.headers = {};
        if (config.username !== undefined || config.password !== undefined) {
            if (config.username === undefined || config.password === undefined) {
                throw new RenderingConfigError(
                    "username and password must be provided together for basic auth"
                );
            }
            const token = Buffer.from(`${config.username}:${config.password}`).toString("base64");
            this.headers.Authorization = `Basic ${token}`;
        }
    }

    /** True when the service answers its health probe. Never throws. */
    async health(): Promise<boolean> {
        try {
            const res = await this.fetchWithTimeout(`${this.baseUrl}/health`, { method: "GET" });
            return res.ok;
        } catch {
            return false;
        }
    }

    /** Render a complete HTML document to PDF through Chromium. */
    async htmlToPdf(params: HtmlToPdfParams): Promise<RenderedPdf> {
        const form = new FormData();
        form.append("files", toBlob(params.html), "index.html");
        appendAssets(form, params.assets);
        appendPageProperties(form, params.pageProperties);
        return this.convert("/forms/chromium/convert/html", form);
    }

    /** Render Markdown to PDF through Chromium, inside an HTML shell. */
    async markdownToPdf(params: MarkdownToPdfParams): Promise<RenderedPdf> {
        const wrapper = params.wrapperHtml ?? DEFAULT_MARKDOWN_WRAPPER;
        if (!wrapper.includes("toHTML")) {
            throw new RenderingConfigError(
                'wrapperHtml must reference {{ toHTML "content.md" }} — without the hook ' +
                    "Gotenberg renders the shell and silently drops the Markdown"
            );
        }
        const form = new FormData();
        form.append("files", toBlob(wrapper), "index.html");
        form.append("files", toBlob(params.markdown), "content.md");
        appendAssets(form, params.assets);
        appendPageProperties(form, params.pageProperties);
        return this.convert("/forms/chromium/convert/markdown", form);
    }

    /** Convert an Office document (DOCX, XLSX, PPTX, ODT, …) to PDF through LibreOffice. */
    async officeToPdf(params: OfficeToPdfParams): Promise<RenderedPdf> {
        const extension = params.filename.split(".").pop()?.toLowerCase() ?? "";
        if (!OFFICE_CONVERTIBLE_EXTENSIONS.has(extension)) {
            throw new RenderingConfigError(
                `"${params.filename}" is not a convertible Office document — the filename's ` +
                    "extension picks the LibreOffice import filter, so it must be one of: " +
                    [...OFFICE_CONVERTIBLE_EXTENSIONS].join(", ")
            );
        }
        const form = new FormData();
        form.append("files", toBlob(params.file), params.filename);
        if (params.landscape !== undefined) form.append("landscape", String(params.landscape));
        if (params.nativePageRanges) form.append("nativePageRanges", params.nativePageRanges);
        if (params.pdfa) form.append("pdfa", params.pdfa);
        if (params.pdfua !== undefined) form.append("pdfua", String(params.pdfua));
        return this.convert("/forms/libreoffice/convert", form);
    }

    private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            return await fetch(url, {
                ...options,
                headers: { ...this.headers, ...(options.headers ?? {}) },
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private async convert(path: string, form: FormData): Promise<RenderedPdf> {
        let res: Response;
        try {
            res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
                method: "POST",
                body: form,
            });
        } catch (err) {
            const detail =
                err instanceof Error && err.name === "AbortError"
                    ? `request timed out after ${this.timeoutMs}ms`
                    : err instanceof Error
                      ? err.message
                      : String(err);
            throw new RenderingServiceError(0, detail);
        }

        const trace = res.headers.get("gotenberg-trace");
        if (!res.ok) {
            const detail = (await res.text().catch(() => "")) || `HTTP ${res.status}`;
            throw new RenderingServiceError(res.status, detail.trim(), trace);
        }

        return { pdf: Buffer.from(await res.arrayBuffer()), trace };
    }
}

export function createGotenbergClient(config: GotenbergConfig): GotenbergClient {
    return new GotenbergClient(config);
}
