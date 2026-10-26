/**
 * Azure Document Intelligence Adapter
 * Maps Azure Layout API responses to normalized PageContent structure
 */

import type {
    OCRAdapter,
    OCRAdapterOptions,
    NormalizedDocument,
    PageContent,
    ExtractedTable,
    OCRProvider,
} from "../types";
import { getStoragePort } from "@launchstack/runtime";
import { PDFDocument } from "pdf-lib";
import { getOcrConfig } from "../config";
import type { AzureDocumentModel } from "../config-types";

/**
 * Azure Document Intelligence API response types
 */
interface AzureAnalyzeResult {
    apiVersion: string;
    modelId: string;
    content: string;
    pages: AzurePage[];
    tables?: AzureTable[];
    paragraphs?: AzureParagraph[];
}

interface AzurePage {
    pageNumber: number;
    width: number;
    height: number;
    unit: string;
    lines?: AzureLine[];
    words?: AzureWord[];
    spans: AzureSpan[];
}

interface AzureLine {
    content: string;
    boundingBox: number[];
    spans: AzureSpan[];
}

interface AzureWord {
    content: string;
    boundingBox: number[];
    confidence: number;
    span: AzureSpan;
}

interface AzureSpan {
    offset: number;
    length: number;
}

interface AzureTable {
    rowCount: number;
    columnCount: number;
    boundingRegions: AzureBoundingRegion[];
    cells: AzureTableCell[];
    spans: AzureSpan[];
}

interface AzureBoundingRegion {
    pageNumber: number;
    boundingBox: number[];
}

interface AzureTableCell {
    kind?: string;
    rowIndex: number;
    columnIndex: number;
    rowSpan?: number;
    columnSpan?: number;
    content: string;
    boundingRegions: AzureBoundingRegion[];
    spans: AzureSpan[];
}

interface AzureParagraph {
    content: string;
    boundingRegions: AzureBoundingRegion[];
    spans: AzureSpan[];
    role?: string;
}

interface AzureOperationResponse {
    status: "notStarted" | "running" | "succeeded" | "failed";
    createdDateTime: string;
    lastUpdatedDateTime: string;
    analyzeResult?: AzureAnalyzeResult;
    error?: {
        code: string;
        message: string;
    };
}

/**
 * Submit statuses that mean Azure refused the file itself (bad or unsupported
 * content, too large): resubmitting it cannot succeed. 401/403 are left out
 * — a wrong key is fixed by the operator, and then the file goes through.
 */
const FILE_REJECTED_STATUSES = new Set([400, 413, 415]);

/**
 * Azure refused the file itself. `fileRejected` tells the provider-first
 * fallback (processor.ts) that the text layer is all there will ever be.
 */
export class AzureFileRejectedError extends Error {
    readonly fileRejected = true;

    constructor(message: string) {
        super(message);
        this.name = "AzureFileRejectedError";
    }
}

const AZURE_SUPPORTED_FORMATS =
    "PDF, JPEG, PNG, BMP, TIFF, HEIF, DOCX, PPTX, XLSX, and other common formats.";

/**
 * S0 analyzes at most this many pages per request and silently ignores the
 * rest, so a longer PDF is sent as consecutive page ranges.
 */
const MAX_PAGES_PER_ANALYSIS = 2000;
/**
 * How long one analysis (one page range) may take before it is abandoned.
 * A full 2,000-page range fits inside this, and it stays far below the
 * outbox's 60-minute stale-claim window.
 */
const MAX_ANALYSIS_MS = 15 * 60_000;
/** Microsoft asks for no more than one result GET every 2 seconds per analysis. */
const MIN_POLL_INTERVAL_MS = 2000;
/** Backoff for throttled (429) or failing (5xx) calls that send no Retry-After — Microsoft's 2-5-13-34 pattern. */
const RETRY_DELAYS_MS = [2000, 5000, 13_000, 34_000] as const;
const MAX_RETRY_AFTER_MS = 60_000;
/** A 500 MB upload (the S0 ceiling) still needs to finish. */
const SUBMIT_TIMEOUT_MS = 5 * 60_000;
const POLL_TIMEOUT_MS = 30_000;

function isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
}

function backoffMs(attempt: number): number {
    return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? MAX_RETRY_AFTER_MS;
}

/** Retry-After in seconds (the form Azure sends), capped; undefined when absent. */
function retryAfterMs(response: Response): number | undefined {
    const value = response.headers.get("retry-after");
    if (!value) return undefined;
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) return undefined;
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** One analyze request: a `pages` range (none = the whole file) and what it should return. */
export interface AnalysisRange {
    pages?: string;
    firstPage: number;
    /** Pages this request should return, when the page count is known. */
    expectedPages?: number;
}

function looksLikePdf(bytes: ArrayBuffer): boolean {
    // The PDF header may be preceded by up to 1024 bytes of junk per spec.
    return Buffer.from(bytes, 0, Math.min(1024, bytes.byteLength))
        .toString("latin1")
        .includes("%PDF-");
}

/**
 * Splits a PDF longer than MAX_PAGES_PER_ANALYSIS into consecutive page
 * ranges. Anything else — a shorter PDF, an image, an Office file, a PDF
 * pdf-lib cannot open — goes as one request.
 */
export async function planAnalysisRanges(bytes: ArrayBuffer): Promise<AnalysisRange[]> {
    if (!looksLikePdf(bytes)) return [{ firstPage: 1 }];

    let pageCount: number;
    try {
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        pageCount = doc.getPageCount();
    } catch {
        return [{ firstPage: 1 }];
    }

    if (pageCount <= MAX_PAGES_PER_ANALYSIS) {
        return [{ firstPage: 1, expectedPages: pageCount }];
    }

    const ranges: AnalysisRange[] = [];
    for (let first = 1; first <= pageCount; first += MAX_PAGES_PER_ANALYSIS) {
        const last = Math.min(first + MAX_PAGES_PER_ANALYSIS - 1, pageCount);
        ranges.push({
            pages: `${first}-${last}`,
            firstPage: first,
            expectedPages: last - first + 1,
        });
    }
    return ranges;
}

/**
 * Parse Azure Document Intelligence error response into a clear message.
 * For InvalidContent (unsupported/corrupted file), suggest supported formats.
 */
function parseAzureErrorMessage(status: number, errorText: string): string {
    try {
        const json = JSON.parse(errorText) as {
            error?: {
                code?: string;
                message?: string;
                innererror?: { code?: string; message?: string };
            };
        };
        const inner = json.error?.innererror;
        const code = inner?.code ?? json.error?.code;
        const msg = inner?.message ?? json.error?.message;

        if (
            status === 400 &&
            (code === "InvalidContent" || msg?.toLowerCase().includes("unsupported"))
        ) {
            return `Azure Document Intelligence does not support this file. ${AZURE_SUPPORTED_FORMATS} Original: ${errorText}`;
        }
    } catch {
        // ignore parse errors, fall back to raw message
    }
    return `Azure Document Intelligence submit failed: ${status} - ${errorText}`;
}

/**
 * Azure Document Intelligence Adapter
 * Uses the Layout model (text, reading order, tables) unless
 * AZURE_DOC_INTELLIGENCE_MODEL picks the cheaper text-only Read model.
 */
export class AzureDocumentIntelligenceAdapter implements OCRAdapter {
    private endpoint: string;
    private apiKey: string;
    private model: AzureDocumentModel;
    private apiVersion = "2024-11-30"; // Latest stable version

    constructor(endpoint?: string, apiKey?: string, model?: AzureDocumentModel) {
        const cfg = getOcrConfig().azure;
        this.endpoint = endpoint ?? cfg?.endpoint ?? "";
        this.apiKey = apiKey ?? cfg?.key ?? "";
        this.model = model ?? cfg?.model ?? "prebuilt-layout";

        if (!this.endpoint || !this.apiKey) {
            console.warn(
                "Azure Document Intelligence credentials not configured. Adapter will fail on use."
            );
        }
    }

    getProviderName(): OCRProvider {
        return "AZURE";
    }

    async uploadDocument(
        documentUrl: string,
        options?: OCRAdapterOptions
    ): Promise<NormalizedDocument> {
        if (!this.endpoint || !this.apiKey) {
            throw new Error(
                "Azure Document Intelligence credentials not configured. " +
                    "Set AZURE_DOC_INTELLIGENCE_ENDPOINT and AZURE_DOC_INTELLIGENCE_KEY environment variables."
            );
        }

        console.log(`[Azure] Starting document processing for: ${documentUrl} (${this.model})`);
        const startTime = Date.now();

        const { bytes, contentType } = await this.download(documentUrl);
        const ranges: AnalysisRange[] =
            options?.pages && options.pages.length > 0
                ? [{ pages: options.pages.join(","), firstPage: Math.min(...options.pages) }]
                : await planAnalysisRanges(bytes);
        if (ranges.length > 1) {
            console.log(
                `[Azure] Over ${MAX_PAGES_PER_ANALYSIS} pages: analyzing in ${ranges.length} page ranges`
            );
        }

        // Ranges run side by side; each is its own analysis with its own budget.
        const results = await Promise.all(
            ranges.map(range => this.analyzeRange(bytes, contentType, range))
        );
        console.log(`[Azure] Analysis completed in ${Date.now() - startTime}ms`);

        const pages = results
            .flatMap(({ range, analyzeResult }) =>
                this.normalizePages(analyzeResult, range.firstPage)
            )
            .sort((a, b) => a.pageNumber - b.pageNumber);

        return {
            pages,
            metadata: {
                totalPages: pages.length,
                provider: "AZURE",
                processingTimeMs: Date.now() - startTime,
                confidenceScore: this.calculateAverageConfidence(
                    results.map(({ analyzeResult }) => analyzeResult)
                ),
            },
        };
    }

    /** Submits one page range, waits for it, and checks it came back whole. */
    private async analyzeRange(
        bytes: ArrayBuffer,
        contentType: string,
        range: AnalysisRange
    ): Promise<{ range: AnalysisRange; analyzeResult: AzureAnalyzeResult }> {
        const { operationLocation, firstPollDelayMs } = await this.submitForAnalysis(
            bytes,
            contentType,
            range.pages
        );
        console.log(
            `[Azure] Document submitted${range.pages ? ` (pages ${range.pages})` : ""}, polling for results...`
        );

        const result = await this.pollForResult(operationLocation, firstPollDelayMs);
        if (!result.analyzeResult) {
            throw new Error("Azure analysis completed but no result returned");
        }

        const returned = result.analyzeResult.pages.length;
        if (range.expectedPages !== undefined && returned < range.expectedPages) {
            console.warn(
                `[Azure] Read ${returned} of ${range.expectedPages} pages${range.pages ? ` in range ${range.pages}` : ""}. ` +
                    "The free (F0) tier reads only the first 2 pages of a document."
            );
        }
        return { range, analyzeResult: result.analyzeResult };
    }

    async extractPage(documentUrl: string, pageNumber: number): Promise<PageContent> {
        const document = await this.uploadDocument(documentUrl, {
            pages: [pageNumber],
        });

        const page = document.pages.find(p => p.pageNumber === pageNumber);
        if (!page) {
            throw new Error(`Page ${pageNumber} not found in document`);
        }

        return page;
    }

    /**
     * Fetches the document server-side, once for every range; Azure cannot
     * reach localhost/private URLs, so it is sent as bytes.
     */
    private async download(
        documentUrl: string
    ): Promise<{ bytes: ArrayBuffer; contentType: string }> {
        const docResponse = await getStoragePort().download(documentUrl);
        if (!docResponse.ok) {
            throw new Error(
                `Failed to fetch document from ${documentUrl}: ${docResponse.status} ${docResponse.statusText}`
            );
        }
        return {
            bytes: await docResponse.arrayBuffer(),
            contentType: docResponse.headers.get("content-type") ?? "application/pdf",
        };
    }

    /**
     * Submit document to Azure for analysis.
     * Throttling (429) and 5xx are retried; a fetch that throws is not, because
     * Azure may already have accepted (and billed) that submission.
     */
    private async submitForAnalysis(
        bytes: ArrayBuffer,
        contentType: string,
        pages?: string
    ): Promise<{ operationLocation: string; firstPollDelayMs: number }> {
        const url = `${this.endpoint}/documentintelligence/documentModels/${this.model}:analyze?api-version=${this.apiVersion}`;
        const fullUrl = pages ? `${url}&${new URLSearchParams({ pages })}` : url;

        for (let attempt = 0; ; attempt++) {
            const response = await fetch(fullUrl, {
                method: "POST",
                headers: {
                    "Ocp-Apim-Subscription-Key": this.apiKey,
                    "Content-Type": contentType,
                },
                body: bytes,
                signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
            });

            if (!response.ok) {
                const errorText = await response.text();
                if (isRetryableStatus(response.status) && attempt < RETRY_DELAYS_MS.length) {
                    const waitMs = retryAfterMs(response) ?? backoffMs(attempt);
                    console.warn(
                        `[Azure] Submit returned ${response.status}, retrying in ${waitMs}ms`
                    );
                    await sleep(waitMs);
                    continue;
                }
                const message = parseAzureErrorMessage(response.status, errorText);
                throw FILE_REJECTED_STATUSES.has(response.status)
                    ? new AzureFileRejectedError(message)
                    : new Error(message);
            }

            const operationLocation = response.headers.get("Operation-Location");
            if (!operationLocation) {
                throw new Error("No Operation-Location header in Azure response");
            }

            return {
                operationLocation,
                firstPollDelayMs: Math.max(
                    MIN_POLL_INTERVAL_MS,
                    retryAfterMs(response) ?? MIN_POLL_INTERVAL_MS
                ),
            };
        }
    }

    /**
     * Poll Azure for analysis completion, at the pace its Retry-After asks
     * for, until MAX_ANALYSIS_MS. A throttled, failing, or unreachable GET is
     * retried: giving up would make the outbox resubmit, and Azure bills
     * every submission.
     */
    private async pollForResult(
        operationLocation: string,
        firstPollDelayMs: number
    ): Promise<AzureOperationResponse> {
        const deadline = Date.now() + MAX_ANALYSIS_MS;
        let waitMs = firstPollDelayMs;
        let failures = 0;

        console.log(`[Azure] Starting polling (up to ${MAX_ANALYSIS_MS / 60_000} minutes)`);

        for (let poll = 1; ; poll++) {
            if (Date.now() + waitMs > deadline) {
                throw new Error(
                    `Azure Document Intelligence analysis timed out after ${MAX_ANALYSIS_MS / 60_000} minutes`
                );
            }
            await sleep(waitMs);

            let response: Response;
            try {
                response = await fetch(operationLocation, {
                    method: "GET",
                    headers: {
                        "Ocp-Apim-Subscription-Key": this.apiKey,
                    },
                    signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
                });
            } catch (error) {
                waitMs = backoffMs(failures++);
                const reason = error instanceof Error ? error.message : "unknown error";
                console.warn(`[Azure] Poll request failed (${reason}), retrying in ${waitMs}ms`);
                continue;
            }

            if (!response.ok) {
                if (!isRetryableStatus(response.status)) {
                    throw new Error(`Azure polling failed: ${response.status}`);
                }
                waitMs = retryAfterMs(response) ?? backoffMs(failures++);
                console.warn(`[Azure] Poll returned ${response.status}, retrying in ${waitMs}ms`);
                continue;
            }
            failures = 0;

            const result = (await response.json()) as AzureOperationResponse;

            if (result.status === "succeeded") {
                console.log(`[Azure] Analysis succeeded after ${poll} polls`);
                return result;
            }

            if (result.status === "failed") {
                throw new Error(
                    `Azure analysis failed: ${result.error?.message ?? "Unknown error"}`
                );
            }

            if (poll % 15 === 1) {
                console.log(`[Azure] Still processing... (poll ${poll}, status: ${result.status})`);
            }
            waitMs = Math.max(MIN_POLL_INTERVAL_MS, retryAfterMs(response) ?? MIN_POLL_INTERVAL_MS);
        }
    }

    /**
     * Normalize Azure response to PageContent array. `firstPage` is where the
     * analyzed range starts: if Azure numbered a range from 1 rather than from
     * the document's own page, the pages are shifted back into place.
     */
    private normalizePages(analyzeResult: AzureAnalyzeResult, firstPage = 1): PageContent[] {
        console.log(`[Azure] Received ${analyzeResult.pages.length} pages from Azure`);
        console.log(`[Azure] Content length: ${analyzeResult.content?.length ?? 0} characters`);
        console.log(`[Azure] Paragraphs: ${analyzeResult.paragraphs?.length ?? 0}`);
        console.log(`[Azure] Tables: ${analyzeResult.tables?.length ?? 0}`);

        const pages: PageContent[] = [];
        const lowest = Math.min(...analyzeResult.pages.map(page => page.pageNumber));
        const offset = firstPage > 1 && lowest < firstPage ? firstPage - 1 : 0;

        // Group content by page
        for (const azurePage of analyzeResult.pages) {
            const pageNumber = azurePage.pageNumber;

            // Extract text blocks from paragraphs or lines
            const textBlocks = this.extractTextBlocks(analyzeResult, pageNumber);

            // Extract tables for this page
            const tables = this.extractTables(analyzeResult, pageNumber);

            console.log(
                `[Azure] Page ${pageNumber}: ${textBlocks.length} text blocks, ${tables.length} tables`
            );

            pages.push({
                pageNumber: pageNumber + offset,
                textBlocks,
                tables,
            });
        }

        console.log(`[Azure] Normalized ${pages.length} pages total`);
        return pages;
    }

    /**
     * Extract text blocks for a specific page
     */
    private extractTextBlocks(analyzeResult: AzureAnalyzeResult, pageNumber: number): string[] {
        const textBlocks: string[] = [];

        // Prefer paragraphs if available (better semantic grouping)
        if (analyzeResult.paragraphs && analyzeResult.paragraphs.length > 0) {
            for (const paragraph of analyzeResult.paragraphs) {
                const isOnPage = paragraph.boundingRegions?.some(
                    region => region.pageNumber === pageNumber
                );

                if (isOnPage && paragraph.content.trim()) {
                    textBlocks.push(paragraph.content.trim());
                }
            }
        } else {
            // Fall back to lines
            const page = analyzeResult.pages.find(p => p.pageNumber === pageNumber);
            if (page?.lines) {
                for (const line of page.lines) {
                    if (line.content.trim()) {
                        textBlocks.push(line.content.trim());
                    }
                }
            }
        }

        return textBlocks;
    }

    /**
     * Extract and convert tables for a specific page
     */
    private extractTables(analyzeResult: AzureAnalyzeResult, pageNumber: number): ExtractedTable[] {
        const tables: ExtractedTable[] = [];

        if (!analyzeResult.tables) {
            return tables;
        }

        for (const azureTable of analyzeResult.tables) {
            // Check if table is on this page
            const isOnPage = azureTable.boundingRegions?.some(
                region => region.pageNumber === pageNumber
            );

            if (!isOnPage) continue;

            // Build the table rows
            const rows: string[][] = Array.from({ length: azureTable.rowCount }, () =>
                Array.from({ length: azureTable.columnCount }, () => "")
            );

            for (const cell of azureTable.cells) {
                const rowIdx = cell.rowIndex;
                const colIdx = cell.columnIndex;

                if (rows[rowIdx] && colIdx < rows[rowIdx].length) {
                    rows[rowIdx][colIdx] = cell.content.trim();
                }

                // Handle row/column spans by repeating content
                if (cell.rowSpan && cell.rowSpan > 1) {
                    for (let r = 1; r < cell.rowSpan; r++) {
                        if (rows[rowIdx + r]) {
                            rows[rowIdx + r]![colIdx] = cell.content.trim();
                        }
                    }
                }
                if (cell.columnSpan && cell.columnSpan > 1) {
                    for (let c = 1; c < cell.columnSpan; c++) {
                        if (rows[rowIdx]) {
                            rows[rowIdx][colIdx + c] = cell.content.trim();
                        }
                    }
                }
            }

            // Generate markdown representation
            const markdown = this.tableToMarkdown(rows);

            // Get bounding box if available
            const boundingRegion = azureTable.boundingRegions?.find(
                r => r.pageNumber === pageNumber
            );
            const boundingBox = boundingRegion?.boundingBox
                ? {
                      x: boundingRegion.boundingBox[0] ?? 0,
                      y: boundingRegion.boundingBox[1] ?? 0,
                      width:
                          (boundingRegion.boundingBox[4] ?? 0) -
                          (boundingRegion.boundingBox[0] ?? 0),
                      height:
                          (boundingRegion.boundingBox[5] ?? 0) -
                          (boundingRegion.boundingBox[1] ?? 0),
                  }
                : undefined;

            tables.push({
                rows,
                markdown,
                boundingBox,
                rowCount: azureTable.rowCount,
                columnCount: azureTable.columnCount,
            });
        }

        return tables;
    }

    /**
     * Convert table rows to clean markdown format
     */
    private tableToMarkdown(rows: string[][]): string {
        if (rows.length === 0) return "";

        const lines: string[] = [];

        // Header row
        const headerRow = rows[0];
        if (headerRow) {
            lines.push(`| ${headerRow.join(" | ")} |`);
            lines.push(`| ${headerRow.map(() => "---").join(" | ")} |`);
        }

        // Data rows
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (row) {
                lines.push(`| ${row.join(" | ")} |`);
            }
        }

        return lines.join("\n");
    }

    /**
     * Average of Azure's word-level confidences, kept on the provider's own
     * [0,1] scale. Undefined when no word-level confidence was reported —
     * absence is honest, not a fabricated 100 (ADR-004).
     */
    private calculateAverageConfidence(analyzeResults: AzureAnalyzeResult[]): number | undefined {
        let totalConfidence = 0;
        let wordCount = 0;

        for (const page of analyzeResults.flatMap(result => result.pages)) {
            if (page.words) {
                for (const word of page.words) {
                    totalConfidence += word.confidence;
                    wordCount++;
                }
            }
        }

        if (wordCount === 0) return undefined;

        return totalConfidence / wordCount;
    }
}

/**
 * Factory function to create Azure adapter
 */
export function createAzureAdapter(
    endpoint?: string,
    apiKey?: string,
    model?: AzureDocumentModel
): AzureDocumentIntelligenceAdapter {
    return new AzureDocumentIntelligenceAdapter(endpoint, apiKey, model);
}
