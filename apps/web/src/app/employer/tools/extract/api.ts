/**
 * The Extract client for `/api/extraction/**`. Every shape comes from the
 * wire contract (`~/lib/extraction/types`), so a field the server adds shows
 * up here without a second definition.
 */
import type {
    CreateExtractionBody,
    ExtractionSourceOption,
    ExtractionTableSummary,
    ExtractionTableView,
} from "~/lib/extraction/types";

export class ExtractApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly body: unknown,
        /**
         * True when the message is this client's own "Request failed" rather
         * than the server's sentence, so a screen can say it in the reader's
         * language instead (`useErrorText` in ~/lib/tools/errorText).
         */
        readonly generated = false
    ) {
        super(message);
        this.name = "ExtractApiError";
    }

    /** The server's machine-readable reason, when it gave one. */
    get code(): string | null {
        const body = this.body;
        return body && typeof body === "object" && "code" in body && typeof body.code === "string"
            ? body.code
            : null;
    }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
        try {
            body = JSON.parse(text);
        } catch {
            body = text;
        }
    }
    if (!response.ok) {
        const server =
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
                ? body.error
                : null;
        throw new ExtractApiError(
            server ?? `Request failed (${response.status})`,
            response.status,
            body,
            server === null
        );
    }
    return body as T;
}

const send = <T>(url: string, payload: unknown, method = "POST") =>
    call<T>(url, { method, body: JSON.stringify(payload) });

export type ExportFormat = "csv" | "xlsx";

export const extractApi = {
    list: () => call<{ tables: ExtractionTableSummary[] }>("/api/extraction"),
    sources: () => call<{ sources: ExtractionSourceOption[] }>("/api/extraction/sources"),
    create: (body: CreateExtractionBody) =>
        send<{ table: ExtractionTableView }>("/api/extraction", body),
    get: (id: number) => call<{ table: ExtractionTableView }>(`/api/extraction/${id}`),
    patch: (id: number, patch: { title?: string; shared?: boolean }) =>
        send<{ table: ExtractionTableView }>(`/api/extraction/${id}`, patch, "PATCH"),
    remove: (id: number) => call<{ ok: true }>(`/api/extraction/${id}`, { method: "DELETE" }),
    cancel: (id: number) =>
        call<{ table: ExtractionTableView }>(`/api/extraction/${id}/cancel`, { method: "POST" }),
    /** Without `rowIds`: every failed row. */
    rerun: (id: number, rowIds?: number[]) =>
        send<{ table: ExtractionTableView }>(
            `/api/extraction/${id}/rerun`,
            rowIds ? { rowIds } : {}
        ),
    /** A plain link: the server answers with the file as an attachment. */
    exportHref: (id: number, format: ExportFormat) =>
        `/api/extraction/${id}/export?format=${format}`,
};
