/**
 * Thin Gmail v1 client over `fetch` — the six endpoints the connector needs,
 * and nothing else. Same posture as the Drive client: not `googleapis`,
 * credentials injected per call, one retry wrapper for rate limits and 5xx.
 *
 * Every call is `users/me`: the access token decides whose mailbox this is,
 * and the host never passes an address around.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailLabel {
    readonly id: string;
    readonly name: string;
    /** `system` for INBOX/SENT/…; `user` for labels the person created. */
    readonly type?: "system" | "user";
    readonly messagesTotal?: number;
    readonly threadsTotal?: number;
    readonly labelListVisibility?: string;
    readonly messageListVisibility?: string;
}

export interface GmailProfile {
    readonly emailAddress: string;
    /** The mailbox's current history id — the sync cursor. */
    readonly historyId: string;
    readonly messagesTotal?: number;
    readonly threadsTotal?: number;
}

export interface GmailThreadRef {
    readonly id: string;
    readonly historyId?: string;
    readonly snippet?: string;
}

export interface GmailThreadList {
    readonly threads?: readonly GmailThreadRef[];
    readonly nextPageToken?: string;
    readonly resultSizeEstimate?: number;
}

export interface GmailHeader {
    readonly name: string;
    readonly value: string;
}

export interface GmailBody {
    readonly attachmentId?: string;
    readonly size?: number;
    /** base64url. Present for small bodies; large parts carry `attachmentId`. */
    readonly data?: string;
}

export interface GmailPart {
    readonly partId?: string;
    readonly mimeType?: string;
    readonly filename?: string;
    readonly headers?: readonly GmailHeader[];
    readonly body?: GmailBody;
    readonly parts?: readonly GmailPart[];
}

export interface GmailMessage {
    readonly id: string;
    readonly threadId: string;
    readonly labelIds?: readonly string[];
    readonly snippet?: string;
    readonly historyId?: string;
    /** Epoch milliseconds as a decimal string. */
    readonly internalDate?: string;
    readonly sizeEstimate?: number;
    /** Absent with `format=minimal`. */
    readonly payload?: GmailPart;
}

export interface GmailThread {
    readonly id: string;
    readonly historyId?: string;
    readonly messages?: readonly GmailMessage[];
}

export type GmailThreadFormat = "minimal" | "full" | "metadata";

export interface GmailHistoryMessageRef {
    readonly id: string;
    readonly threadId: string;
    readonly labelIds?: readonly string[];
}

export interface GmailHistoryRecord {
    readonly id: string;
    readonly messages?: readonly GmailHistoryMessageRef[];
    readonly messagesAdded?: readonly { readonly message: GmailHistoryMessageRef }[];
    readonly messagesDeleted?: readonly { readonly message: GmailHistoryMessageRef }[];
    readonly labelsAdded?: readonly {
        readonly message: GmailHistoryMessageRef;
        readonly labelIds?: readonly string[];
    }[];
    readonly labelsRemoved?: readonly {
        readonly message: GmailHistoryMessageRef;
        readonly labelIds?: readonly string[];
    }[];
}

export interface GmailHistoryList {
    readonly history?: readonly GmailHistoryRecord[];
    readonly nextPageToken?: string;
    readonly historyId?: string;
}

export interface GmailAttachmentBody {
    readonly attachmentId?: string;
    readonly size?: number;
    /** base64url bytes. */
    readonly data?: string;
}

export class GmailApiError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
        this.name = "GmailApiError";
    }
}

/** 401, or 403 for a missing scope: the grant is dead or too narrow — reconnect. */
export class GmailAuthError extends GmailApiError {
    constructor(message: string, status: number) {
        super(message, status);
        this.name = "GmailAuthError";
    }
}

/** The thread, message or attachment is gone. */
export class GmailNotFoundError extends GmailApiError {
    constructor(
        readonly resource: string,
        status = 404
    ) {
        super(`Gmail resource ${resource} not found`, status);
        this.name = "GmailNotFoundError";
    }
}

/**
 * `history.list` answered 404: the cursor is older than Gmail keeps history
 * for (roughly a week of inactivity, or a mailbox reset). Full resync.
 */
export class GmailHistoryExpiredError extends Error {
    constructor(readonly startHistoryId: string) {
        super(`Gmail history from ${startHistoryId} has expired — full resync required`);
        this.name = "GmailHistoryExpiredError";
    }
}

export interface ListThreadsParams {
    readonly labelIds?: readonly string[];
    readonly q?: string;
    readonly pageToken?: string;
    /** Gmail caps this at 500. */
    readonly maxResults?: number;
}

export interface ListHistoryParams {
    readonly startHistoryId: string;
    readonly pageToken?: string;
    readonly maxResults?: number;
}

export interface GmailClient {
    getProfile(): Promise<GmailProfile>;
    listLabels(): Promise<readonly GmailLabel[]>;
    /** One page of thread references matching a label and/or a search query. */
    listThreads(params: ListThreadsParams): Promise<GmailThreadList>;
    getThread(threadId: string, format: GmailThreadFormat): Promise<GmailThread>;
    /** One page of mailbox history since a cursor; throws GmailHistoryExpiredError on 404. */
    listHistory(params: ListHistoryParams): Promise<GmailHistoryList>;
    getAttachment(messageId: string, attachmentId: string): Promise<GmailAttachmentBody>;
}

export interface GmailClientOptions {
    readonly accessToken: string;
    readonly fetch?: FetchLike;
    /** Retry attempts for rate limits / 5xx. */
    readonly maxAttempts?: number;
    /** Injectable for tests; defaults to real setTimeout. */
    readonly sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE_403_REASONS = ["userRateLimitExceeded", "rateLimitExceeded", "dailyLimitExceeded"];
const AUTH_403_REASONS = ["insufficientPermissions", "forbidden", "domainPolicy"];

interface GmailErrorBody {
    error?: {
        errors?: readonly { reason?: string; message?: string }[];
        message?: string;
        status?: string;
    };
}

function errorReasons(body: GmailErrorBody | null): readonly string[] {
    return body?.error?.errors?.map(entry => entry.reason ?? "").filter(Boolean) ?? [];
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function createGmailClient(options: GmailClientOptions): GmailClient {
    const fetchImpl = options.fetch ?? fetch;
    const sleep = options.sleep ?? defaultSleep;
    const maxAttempts = options.maxAttempts ?? 5;

    async function gmailFetch(url: string, resource?: string): Promise<Response> {
        let lastStatus = 0;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const response = await fetchImpl(url, {
                headers: { Authorization: `Bearer ${options.accessToken}` },
            });
            if (response.ok) return response;
            lastStatus = response.status;

            let body: GmailErrorBody | null = null;
            try {
                body = (await response.clone().json()) as GmailErrorBody;
            } catch {
                body = null;
            }
            const reasons = errorReasons(body);
            const message =
                body?.error?.message ?? `Gmail API request failed (HTTP ${response.status})`;

            if (response.status === 401) throw new GmailAuthError(message, 401);
            if (response.status === 403 && reasons.some(r => AUTH_403_REASONS.includes(r))) {
                throw new GmailAuthError(message, 403);
            }
            if (response.status === 404) throw new GmailNotFoundError(resource ?? url);

            const retryable =
                response.status === 429 ||
                response.status >= 500 ||
                (response.status === 403 && reasons.some(r => RETRYABLE_403_REASONS.includes(r)));
            if (!retryable || attempt === maxAttempts - 1) {
                throw new GmailApiError(message, response.status);
            }

            const retryAfter = Number(response.headers.get("Retry-After"));
            const backoffMs = Number.isFinite(retryAfter)
                ? retryAfter * 1000
                : 1000 * 2 ** attempt + Math.random() * 500;
            await sleep(backoffMs);
        }
        throw new GmailApiError(`Gmail API request failed (HTTP ${lastStatus})`, lastStatus);
    }

    async function json<T>(url: string, resource?: string): Promise<T> {
        const response = await gmailFetch(url, resource);
        return (await response.json()) as T;
    }

    return {
        getProfile() {
            return json<GmailProfile>(`${GMAIL_BASE}/profile`);
        },

        async listLabels() {
            const payload = await json<{ labels?: readonly GmailLabel[] }>(`${GMAIL_BASE}/labels`);
            return payload.labels ?? [];
        },

        listThreads(params) {
            const url = new URL(`${GMAIL_BASE}/threads`);
            url.searchParams.set("maxResults", String(Math.min(params.maxResults ?? 500, 500)));
            for (const labelId of params.labelIds ?? []) {
                url.searchParams.append("labelIds", labelId);
            }
            if (params.q) url.searchParams.set("q", params.q);
            if (params.pageToken) url.searchParams.set("pageToken", params.pageToken);
            return json<GmailThreadList>(url.toString());
        },

        getThread(threadId, format) {
            const url = new URL(`${GMAIL_BASE}/threads/${encodeURIComponent(threadId)}`);
            url.searchParams.set("format", format);
            return json<GmailThread>(url.toString(), `thread ${threadId}`);
        },

        async listHistory(params) {
            const url = new URL(`${GMAIL_BASE}/history`);
            url.searchParams.set("startHistoryId", params.startHistoryId);
            url.searchParams.set("maxResults", String(Math.min(params.maxResults ?? 500, 500)));
            for (const type of ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"]) {
                url.searchParams.append("historyTypes", type);
            }
            if (params.pageToken) url.searchParams.set("pageToken", params.pageToken);
            try {
                return await json<GmailHistoryList>(url.toString(), "history");
            } catch (error) {
                if (error instanceof GmailNotFoundError) {
                    throw new GmailHistoryExpiredError(params.startHistoryId);
                }
                throw error;
            }
        },

        getAttachment(messageId, attachmentId) {
            const url =
                `${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}` +
                `/attachments/${encodeURIComponent(attachmentId)}`;
            return json<GmailAttachmentBody>(url, `attachment ${messageId}/${attachmentId}`);
        },
    };
}
