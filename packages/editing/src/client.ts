import type {
    ReadDocxResponse,
    ProcessBatchParams,
    BatchSummary,
    ApplyEditsMarkdownParams,
    ApplyEditsMarkdownResponse,
    DiffResponse,
    ReviewItemsResponse,
    ProcessBatchJsonResponse,
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
        "[adeu/client] DOCUMENT_EDITOR_URL / DOCUMENT_EDITOR_API_KEY / ADEU_SERVICE_URL / " +
            "SIDECAR_API_KEY are deprecated: the service is now " +
            "services/adeu-ai-docs-editing. Set ADEU_SERVICE_URL and ADEU_SERVICE_API_KEY."
    );
}

/**
 * Base URL of the adeu-ai-docs-editing service. ADEU_SERVICE_URL is canonical;
 * DOCUMENT_EDITOR_URL (pre-rename) is honored as a deprecated fallback with a
 * single warning.
 */
export function getBaseUrl(): string {
    const url = process.env.ADEU_SERVICE_URL;
    if (url) return url;
    const legacy = process.env.DOCUMENT_EDITOR_URL;
    if (legacy) {
        warnDeprecatedNamesOnce();
        return legacy;
    }
    throw new AdeuConfigError("ADEU_SERVICE_URL environment variable is not set");
}

const ADEU_TIMEOUT_MS = Number(process.env.ADEU_TIMEOUT_MS) || 30_000;

function getAuthHeaders(): Record<string, string> {
    const key = process.env.ADEU_SERVICE_API_KEY;
    if (key) return { "X-API-Key": key };
    const legacy = process.env.DOCUMENT_EDITOR_API_KEY ?? process.env.SIDECAR_API_KEY;
    if (legacy) {
        warnDeprecatedNamesOnce();
        return { "X-API-Key": legacy };
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

/**
 * List every tracked change and comment in a document, with its adeu id.
 *
 * Review actions address changes by ids like `Chg:12`; this is where a caller
 * learns what those ids are. Without it, ACCEPT / REJECT / REPLY cannot be
 * called correctly from a UI at all.
 */
export async function listReviewItems(
    file: Buffer | Blob,
    options?: { filename?: string }
): Promise<ReviewItemsResponse> {
    const baseUrl = getBaseUrl();
    const form = new FormData();
    form.append("file", toBlob(file), options?.filename ?? "document.docx");

    let res: Response;
    try {
        res = await fetchWithTimeout(`${baseUrl}/adeu/review-items`, {
            method: "POST",
            body: form,
            headers: getAuthHeaders(),
        });
    } catch (err) {
        throw new AdeuServiceError(0, err instanceof Error ? err.message : String(err));
    }

    if (!res.ok) return handleErrorResponse(res);
    return res.json() as Promise<ReviewItemsResponse>;
}

/**
 * Apply a batch and get the document back *with* a per-edit report.
 *
 * The binary form returns counts in a header, which cannot carry per-edit
 * detail — so a caller could never tell which edit failed, only how many did.
 * This asks for JSON instead.
 */
export async function processDocumentBatchDetailed(
    file: Buffer | Blob,
    params: ProcessBatchParams,
    options?: { filename?: string }
): Promise<ProcessBatchJsonResponse> {
    const baseUrl = getBaseUrl();
    const form = new FormData();
    form.append("file", toBlob(file), options?.filename ?? "document.docx");
    form.append("body", JSON.stringify(params));

    let res: Response;
    try {
        res = await fetchWithTimeout(`${baseUrl}/adeu/process-batch`, {
            method: "POST",
            body: form,
            headers: { ...getAuthHeaders(), Accept: "application/json" },
        });
    } catch (err) {
        throw new AdeuServiceError(0, err instanceof Error ? err.message : String(err));
    }

    if (!res.ok) return handleErrorResponse(res);
    return res.json() as Promise<ProcessBatchJsonResponse>;
}

/** Reject every tracked change, restoring the document's original text. */
export async function rejectAllChanges(file: Buffer | Blob): Promise<Blob> {
    const baseUrl = getBaseUrl();
    const form = new FormData();
    form.append("file", toBlob(file), "document.docx");

    let res: Response;
    try {
        res = await fetchWithTimeout(`${baseUrl}/adeu/reject-all`, {
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
