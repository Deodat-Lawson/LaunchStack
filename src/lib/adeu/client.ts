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

export function getBaseUrl(): string {
    const url = process.env.ADEU_SERVICE_URL;
    if (!url) {
        throw new AdeuConfigError(
            "ADEU_SERVICE_URL environment variable is not set"
        );
    }
    return url;
}

export interface ProcessBatchResponse {
    summary: BatchSummary;
    file: Blob;
}

export async function readDocx(
    file: Buffer | Blob,
    options?: { cleanView?: boolean }
): Promise<ReadDocxResponse> {
    throw new Error("not implemented");
}

export async function processDocumentBatch(
    file: Buffer | Blob,
    params: ProcessBatchParams
): Promise<ProcessBatchResponse> {
    throw new Error("not implemented");
}

export async function acceptAllChanges(file: Buffer | Blob): Promise<Blob> {
    throw new Error("not implemented");
}

export async function applyEditsAsMarkdown(
    file: Buffer | Blob,
    params: ApplyEditsMarkdownParams
): Promise<ApplyEditsMarkdownResponse> {
    throw new Error("not implemented");
}

export async function diffDocxFiles(
    original: Buffer | Blob,
    modified: Buffer | Blob,
    options?: { compareClean?: boolean }
): Promise<DiffResponse> {
    throw new Error("not implemented");
}
