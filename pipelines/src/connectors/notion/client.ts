/**
 * Thin Notion API client over `fetch` — the two endpoints the connector
 * needs, and nothing else. Same posture as the Gmail and Drive clients: no
 * SDK, credentials injected per client, one retry wrapper for rate limits
 * and 5xx.
 *
 * - `POST /v1/search` lists every page the integration can read. What it can
 *   read is exactly what the person picked on Notion's consent screen (and
 *   anything shared with the connection since), so the search *is* the scope.
 * - `GET /v1/pages/{id}/markdown` returns a page's content as Notion's
 *   enhanced Markdown in one call, instead of a recursive block walk.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Every request carries this; Notion pins response shapes to it. */
export const NOTION_API_VERSION = "2026-03-11";

const NOTION_BASE = "https://api.notion.com/v1";

export interface NotionRichText {
    readonly plain_text?: string;
}

/** A property value as Notion returns it; only the fields the renderer reads are typed. */
export interface NotionPropertyValue {
    readonly id?: string;
    readonly type: string;
    readonly [field: string]: unknown;
}

export interface NotionParent {
    readonly type: string;
    readonly page_id?: string;
    readonly data_source_id?: string;
    readonly database_id?: string;
    readonly block_id?: string;
    readonly workspace?: boolean;
}

export interface NotionPage {
    readonly object: "page";
    readonly id: string;
    readonly url?: string;
    readonly created_time?: string;
    readonly last_edited_time: string;
    readonly in_trash?: boolean;
    /** Pre-`in_trash` spelling; still sent by some versions. */
    readonly archived?: boolean;
    readonly is_archived?: boolean;
    readonly parent?: NotionParent;
    readonly properties?: Readonly<Record<string, NotionPropertyValue>>;
}

export interface NotionSearchObject {
    readonly object: string;
    readonly id: string;
}

export interface NotionSearchPage {
    readonly results: readonly (NotionPage | NotionSearchObject)[];
    readonly next_cursor: string | null;
    readonly has_more: boolean;
    readonly request_status?: { readonly type?: string; readonly incomplete_reason?: string };
}

export interface NotionPageMarkdown {
    readonly id: string;
    readonly markdown: string;
    /** True when the page exceeded Notion's record limit; see `unknown_block_ids`. */
    readonly truncated: boolean;
    /** Subtrees left out — truncated, or not shared with the connection. */
    readonly unknown_block_ids?: readonly string[];
}

export class NotionApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string | null = null
    ) {
        super(message);
        this.name = "NotionApiError";
    }
}

/** 401: the token is dead or was revoked. The host refreshes once, then gives up. */
export class NotionAuthError extends NotionApiError {
    constructor(message: string, status = 401, code: string | null = "unauthorized") {
        super(message, status, code);
        this.name = "NotionAuthError";
    }
}

/** 404 `object_not_found`: deleted, or no longer shared with the connection. */
export class NotionNotFoundError extends NotionApiError {
    constructor(readonly resource: string) {
        super(
            `Notion ${resource} not found or not shared with the connection`,
            404,
            "object_not_found"
        );
        this.name = "NotionNotFoundError";
    }
}

export interface SearchPagesParams {
    readonly startCursor?: string;
    /** Notion caps this at 100. */
    readonly pageSize?: number;
}

export interface NotionClient {
    /** One page of search results — pages only, most recently edited first. */
    searchPages(params: SearchPagesParams): Promise<NotionSearchPage>;
    /** A page's content, or the subtree under a block id from `unknown_block_ids`. */
    getPageMarkdown(pageOrBlockId: string): Promise<NotionPageMarkdown>;
}

export interface NotionClientOptions {
    readonly accessToken: string;
    readonly fetch?: FetchLike;
    /** Override for a dev stand-in. */
    readonly baseUrl?: string;
    /** Retry attempts for rate limits / 5xx. */
    readonly maxAttempts?: number;
    /** Injectable for tests; defaults to real setTimeout. */
    readonly sleep?: (ms: number) => Promise<void>;
}

interface NotionErrorBody {
    readonly code?: string;
    readonly message?: string;
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function readErrorBody(response: Response): Promise<NotionErrorBody | null> {
    try {
        return (await response.clone().json()) as NotionErrorBody;
    } catch {
        return null;
    }
}

export function createNotionClient(options: NotionClientOptions): NotionClient {
    const fetchImpl = options.fetch ?? fetch;
    const sleep = options.sleep ?? defaultSleep;
    const maxAttempts = options.maxAttempts ?? 5;
    const base = (options.baseUrl ?? NOTION_BASE).replace(/\/+$/, "");

    async function notionFetch(
        path: string,
        init: RequestInit,
        resource: string
    ): Promise<Response> {
        let lastStatus = 0;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const response = await fetchImpl(`${base}${path}`, {
                ...init,
                headers: {
                    Authorization: `Bearer ${options.accessToken}`,
                    "Notion-Version": NOTION_API_VERSION,
                    ...(init.body ? { "Content-Type": "application/json" } : {}),
                },
            });
            if (response.ok) return response;
            lastStatus = response.status;

            const body = await readErrorBody(response);
            const code = body?.code ?? null;
            const message = body?.message ?? `Notion API request failed (HTTP ${response.status})`;

            if (response.status === 401) throw new NotionAuthError(message, 401, code);
            if (response.status === 404) throw new NotionNotFoundError(resource);

            // 409 conflict_error is Notion's "try again"; 429 rate_limited
            // comes with Retry-After (seconds).
            const retryable =
                response.status === 429 || response.status === 409 || response.status >= 500;
            if (!retryable || attempt === maxAttempts - 1) {
                throw new NotionApiError(message, response.status, code);
            }

            const retryAfter = Number(response.headers.get("Retry-After"));
            const backoffMs =
                Number.isFinite(retryAfter) && retryAfter > 0
                    ? retryAfter * 1000
                    : 1000 * 2 ** attempt + Math.random() * 500;
            await sleep(backoffMs);
        }
        throw new NotionApiError(`Notion API request failed (HTTP ${lastStatus})`, lastStatus);
    }

    return {
        async searchPages(params) {
            const response = await notionFetch(
                "/search",
                {
                    method: "POST",
                    body: JSON.stringify({
                        filter: { property: "object", value: "page" },
                        sort: { timestamp: "last_edited_time", direction: "descending" },
                        page_size: Math.min(params.pageSize ?? 100, 100),
                        // Notion rejects unknown and null fields; JSON drops undefined.
                        start_cursor: params.startCursor,
                    }),
                },
                "search"
            );
            return (await response.json()) as NotionSearchPage;
        },

        async getPageMarkdown(pageOrBlockId) {
            const response = await notionFetch(
                `/pages/${encodeURIComponent(pageOrBlockId)}/markdown`,
                { method: "GET" },
                `page ${pageOrBlockId}`
            );
            return (await response.json()) as NotionPageMarkdown;
        },
    };
}
