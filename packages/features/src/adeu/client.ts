import type {
    ReadDocxResponse,
    ProcessBatchParams,
    BatchSummary,
    ApplyEditsMarkdownParams,
    ApplyEditsMarkdownResponse,
    DiffResponse,
} from "./types";

export class AdeuConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AdeuConfigError";
    }
}

export class AdeuServiceError extends Error {
    public readonly statusCode: number;
    public readonly detail: string;

    constructor(statusCode: number, detail: string) {
        super(`Adeu service error (${statusCode}): ${detail}`);
        this.name = "AdeuServiceError";
        this.statusCode = statusCode;
        this.detail = detail;
    }
}

let warnedDeprecatedNames = false;

function warnDeprecatedNamesOnce(): void {
    if (warnedDeprecatedNames) return;
    warnedDeprecatedNames = true;
    console.warn(
        "[adeu/client] ADEU_SERVICE_URL / SIDECAR_API_KEY are deprecated (ADR-004): the " +
            "Adeu routes moved to services/document-editor. Set DOCUMENT_EDITOR_URL and " +
            "DOCUMENT_EDITOR_API_KEY instead."
    );
}

/**
 * Base URL of the document-editor service (ADR-004). DOCUMENT_EDITOR_URL is
 * canonical; the pre-split ADEU_SERVICE_URL is honored as a deprecated
 * fallback with a single warning.
 */
export function getBaseUrl(): string {
    const url = process.env.DOCUMENT_EDITOR_URL;
    if (url) return url;
    const legacy = process.env.ADEU_SERVICE_URL;
    if (legacy) {
        warnDeprecatedNamesOnce();
        return legacy;
    }
    throw new AdeuConfigError("DOCUMENT_EDITOR_URL environment variable is not set");
}

const ADEU_TIMEOUT_MS = Number(process.env.ADEU_TIMEOUT_MS) || 30_000;

function getAuthHeaders(): Record<string, string> {
    const key = process.env.DOCUMENT_EDITOR_API_KEY;
    if (key) return { "X-API-Key": key };
    if (process.env.SIDECAR_API_KEY) {
        warnDeprecatedNamesOnce();
        return { "X-API-Key": process.env.SIDECAR_API_KEY };
    }
    // The service fails closed — an empty key yields 401s, never
    // unauthenticated access.
    return { "X-API-Key": "" };
}

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ADEU_TIMEOUT_MS);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
}

export interface ProcessBatchResponse {
    summary: BatchSummary;
    file: Blob;
}

function toBlob(input: Buffer | Blob): Blob {
    if (input instanceof Blob) return input;
    return new Blob([new Uint8Array(input)]);
}

async function handleErrorResponse(res: Response): Promise<never> {
    let detail: string;
    try {
        const body = (await res.json()) as { detail?: string; errors?: string[] };
        const base = body.detail ?? "Unknown error";
        const errors = body.errors;
        detail = errors?.length ? `${base}: ${errors.join("; ")}` : base;
    } catch {
        detail = await res.text().catch(() => `HTTP ${res.status}`);
    }
    throw new AdeuServiceError(res.status, detail);
}

export async function readDocx(
    file: Buffer | Blob,
    options?: { cleanView?: boolean }
): Promise<ReadDocxResponse> {
    const baseUrl = getBaseUrl();
    const form = new FormData();
    form.append("file", toBlob(file), "document.docx");
    if (options?.cleanView !== undefined) {
        form.append("clean_view", String(options.cleanView));
    }

    let res: Response;
    try {
        res = await fetchWithTimeout(`${baseUrl}/adeu/read`, {
            method: "POST",
            body: form,
            headers: getAuthHeaders(),
        });
    } catch (err) {
        throw new AdeuServiceError(0, err instanceof Error ? err.message : String(err));
    }

    if (!res.ok) return handleErrorResponse(res);
    return res.json() as Promise<ReadDocxResponse>;
}

export async function processDocumentBatch(
    file: Buffer | Blob,
    params: ProcessBatchParams
): Promise<ProcessBatchResponse> {
    const baseUrl = getBaseUrl();
    const form = new FormData();
    form.append("file", toBlob(file), "document.docx");
    form.append("body", JSON.stringify(params));

    let res: Response;
    try {
        res = await fetchWithTimeout(`${baseUrl}/adeu/process-batch`, {
            method: "POST",
            body: form,
            headers: getAuthHeaders(),
        });
    } catch (err) {
        throw new AdeuServiceError(0, err instanceof Error ? err.message : String(err));
    }

    if (!res.ok) return handleErrorResponse(res);

    // The service returns the modified DOCX binary with a X-Batch-Summary JSON header
    const summaryHeader = res.headers.get("x-batch-summary");
    let summary: BatchSummary = {
        applied_edits: 0,
        skipped_edits: 0,
        applied_actions: 0,
        skipped_actions: 0,
    };
    if (summaryHeader) {
        try {
            // The service emits this header as a JSON-encoded BatchSummary.
            summary = JSON.parse(summaryHeader) as BatchSummary;
        } catch {
            console.warn("[adeu/client] Failed to parse x-batch-summary header, using default");
        }
    }
    const blob = await res.blob();

    return { summary, file: blob };
}

export async function acceptAllChanges(file: Buffer | Blob): Promise<Blob> {
    const baseUrl = getBaseUrl();
    const form = new FormData();
    form.append("file", toBlob(file), "document.docx");

    let res: Response;
    try {
        res = await fetchWithTimeout(`${baseUrl}/adeu/accept-all`, {
            method: "POST",
            body: form,
            headers: getAuthHeaders(),
        });
    } catch (err) {
        throw new AdeuServiceError(0, err instanceof Error ? err.message : String(err));
    }

    if (!res.ok) return handleErrorResponse(res);
    return res.blob();
}

export async function applyEditsAsMarkdown(
    file: Buffer | Blob,
    params: ApplyEditsMarkdownParams
): Promise<ApplyEditsMarkdownResponse> {
    const baseUrl = getBaseUrl();
    const form = new FormData();
    form.append("file", toBlob(file), "document.docx");
    form.append("body", JSON.stringify(params));

    let res: Response;
    try {
        res = await fetchWithTimeout(`${baseUrl}/adeu/apply-edits-markdown`, {
            method: "POST",
            body: form,
            headers: getAuthHeaders(),
        });
    } catch (err) {
        throw new AdeuServiceError(0, err instanceof Error ? err.message : String(err));
    }

    if (!res.ok) return handleErrorResponse(res);
    return res.json() as Promise<ApplyEditsMarkdownResponse>;
}

export async function diffDocxFiles(
    original: Buffer | Blob,
    modified: Buffer | Blob,
    options?: { compareClean?: boolean }
): Promise<DiffResponse> {
    const baseUrl = getBaseUrl();
    const form = new FormData();
    form.append("original", toBlob(original), "original.docx");
    form.append("modified", toBlob(modified), "modified.docx");
    if (options?.compareClean !== undefined) {
        form.append("compare_clean", String(options.compareClean));
    }

    let res: Response;
    try {
        res = await fetchWithTimeout(`${baseUrl}/adeu/diff`, {
            method: "POST",
            body: form,
            headers: getAuthHeaders(),
        });
    } catch (err) {
        throw new AdeuServiceError(0, err instanceof Error ? err.message : String(err));
    }

    if (!res.ok) return handleErrorResponse(res);
    return res.json() as Promise<DiffResponse>;
}
