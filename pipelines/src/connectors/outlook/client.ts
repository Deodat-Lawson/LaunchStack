/**
 * Thin Microsoft Graph v1.0 mail client over `fetch` — the eight endpoints
 * the connector needs, and nothing else. Same posture as the Gmail client:
 * not the Graph SDK, credentials injected per call, one retry wrapper for
 * throttling and 5xx.
 *
 * Every call is `/me`: the access token decides whose mailbox this is, and
 * the host never passes an address around. Every request asks for plain-text
 * bodies and immutable ids, so a message keeps its id when it is moved
 * between folders.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/** Sent with every mail request. */
export const OUTLOOK_PREFER_HEADER = 'outlook.body-content-type="text", IdType="ImmutableId"';

const DELTA_SELECT = "id,conversationId,isDraft,receivedDateTime";
const MESSAGE_SELECT =
    "id,conversationId,subject,from,toRecipients,ccRecipients,sentDateTime,receivedDateTime," +
    "isDraft,hasAttachments,body,bodyPreview,webLink,parentFolderId,internetMessageId";
const SEARCH_SELECT = "id,conversationId,isDraft";
const ATTACHMENT_SELECT = "id,name,contentType,size,isInline";

export interface OutlookUser {
    readonly id: string;
    /** Null for accounts without a mailbox address; `userPrincipalName` stands in. */
    readonly mail?: string | null;
    readonly userPrincipalName?: string | null;
    readonly displayName?: string | null;
}

export interface OutlookMailFolder {
    readonly id: string;
    readonly displayName: string;
    readonly parentFolderId?: string;
    readonly childFolderCount?: number;
    readonly totalItemCount?: number;
    /** `inbox`, `sentitems`, … for the folders every mailbox has. */
    readonly wellKnownName?: string | null;
}

export interface OutlookRecipient {
    readonly emailAddress?: {
        readonly name?: string | null;
        readonly address?: string | null;
    };
}

export interface OutlookMessage {
    readonly id: string;
    readonly conversationId?: string;
    readonly subject?: string | null;
    readonly from?: OutlookRecipient | null;
    readonly toRecipients?: readonly OutlookRecipient[];
    readonly ccRecipients?: readonly OutlookRecipient[];
    readonly sentDateTime?: string | null;
    readonly receivedDateTime?: string | null;
    readonly isDraft?: boolean;
    readonly hasAttachments?: boolean;
    readonly body?: {
        /** `text` under the Prefer header; `html` if a server ignores it. */
        readonly contentType?: string;
        readonly content?: string;
    };
    readonly bodyPreview?: string;
    /** Opens the message in Outlook on the web. */
    readonly webLink?: string;
    readonly parentFolderId?: string;
    readonly internetMessageId?: string;
}

/** A message as listings carry it: enough to group, not enough to read. */
export interface OutlookMessageRef {
    readonly id: string;
    readonly conversationId?: string;
    readonly isDraft?: boolean;
    readonly receivedDateTime?: string | null;
    /** Delta only: the message was deleted or moved out of the folder. */
    readonly "@removed"?: { readonly reason?: string };
}

export interface OutlookDeltaPage {
    readonly value: readonly OutlookMessageRef[];
    /** More of this round; fetched as-is. */
    readonly "@odata.nextLink"?: string;
    /** The round is over; store this and start the next run from it. */
    readonly "@odata.deltaLink"?: string;
}

export interface OutlookMessageRefPage {
    readonly value: readonly OutlookMessageRef[];
    readonly "@odata.nextLink"?: string;
}

export interface OutlookAttachment {
    readonly id: string;
    readonly name?: string | null;
    readonly contentType?: string | null;
    readonly size?: number;
    /** True for images embedded in the body — signature logos, mostly. */
    readonly isInline?: boolean;
}

export class OutlookApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        /** Graph's `error.code`, when the body carried one. */
        readonly code: string | null = null
    ) {
        super(message);
        this.name = "OutlookApiError";
    }
}

/** 401, or 403 access denied: the grant is dead or too narrow — reconnect. */
export class OutlookAuthError extends OutlookApiError {
    constructor(message: string, status: number, code: string | null = null) {
        super(message, status, code);
        this.name = "OutlookAuthError";
    }
}

/** The folder, message or attachment is gone. */
export class OutlookNotFoundError extends OutlookApiError {
    constructor(
        readonly resource: string,
        status = 404,
        code: string | null = null
    ) {
        super(`Outlook resource ${resource} not found`, status, code);
        this.name = "OutlookNotFoundError";
    }
}

/**
 * A stored delta link answered 410 (or `syncStateNotFound` /
 * `resyncRequired`): Graph no longer holds that sync state. Walk the folder
 * again from scratch.
 */
export class OutlookDeltaExpiredError extends Error {
    constructor(readonly folderId: string) {
        super(`Outlook delta link for folder ${folderId} has expired — full resync required`);
        this.name = "OutlookDeltaExpiredError";
    }
}

export interface ListFolderDeltaParams {
    readonly folderId: string;
    /**
     * A `@odata.nextLink` (to continue a round) or a stored
     * `@odata.deltaLink` (to start the next one). Absent → from scratch.
     */
    readonly link?: string;
}

export interface SearchMessagesParams {
    readonly query: string;
    readonly nextLink?: string;
}

export interface OutlookClient {
    getProfile(): Promise<OutlookUser>;
    /** The mailbox's top-level folders, hidden ones left out. */
    listMailFolders(): Promise<readonly OutlookMailFolder[]>;
    listChildFolders(folderId: string): Promise<readonly OutlookMailFolder[]>;
    /** One page of a folder's delta feed; throws OutlookDeltaExpiredError on 410. */
    listFolderDelta(params: ListFolderDeltaParams): Promise<OutlookDeltaPage>;
    /** Every message of a conversation, whichever folders they sit in. */
    listConversationMessages(conversationId: string): Promise<readonly OutlookMessage[]>;
    /** One page of messages matching a search query. */
    searchMessages(params: SearchMessagesParams): Promise<OutlookMessageRefPage>;
    listAttachments(messageId: string): Promise<readonly OutlookAttachment[]>;
    /** Raw bytes of a file attachment. */
    downloadAttachment(messageId: string, attachmentId: string): Promise<Uint8Array>;
}

export interface OutlookClientOptions {
    readonly accessToken: string;
    /** Graph v1.0 root; defaults to Microsoft. The host points it at a dev stand-in. */
    readonly baseUrl?: string;
    readonly fetch?: FetchLike;
    /** Retry attempts for throttling / 5xx. */
    readonly maxAttempts?: number;
    /** Injectable for tests; defaults to real setTimeout. */
    readonly sleep?: (ms: number) => Promise<void>;
}

const DELTA_EXPIRED_CODES = ["syncstatenotfound", "resyncrequired"];
const AUTH_403_CODES = ["accessdenied", "erroraccessdenied"];

interface GraphErrorBody {
    error?: {
        code?: string;
        message?: string;
    };
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

interface FetchContext {
    /** Named in a not-found error. */
    readonly resource?: string;
    /** Set on delta calls: an expired sync state throws for this folder. */
    readonly deltaFolderId?: string;
}

export function createOutlookClient(options: OutlookClientOptions): OutlookClient {
    const fetchImpl = options.fetch ?? fetch;
    const sleep = options.sleep ?? defaultSleep;
    const maxAttempts = options.maxAttempts ?? 5;
    const base = (options.baseUrl ?? GRAPH_BASE).replace(/\/$/, "");

    async function graphFetch(url: string, context: FetchContext = {}): Promise<Response> {
        let lastStatus = 0;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const response = await fetchImpl(url, {
                headers: {
                    Authorization: `Bearer ${options.accessToken}`,
                    Prefer: OUTLOOK_PREFER_HEADER,
                },
            });
            if (response.ok) return response;
            lastStatus = response.status;

            let body: GraphErrorBody | null = null;
            try {
                body = (await response.clone().json()) as GraphErrorBody;
            } catch {
                body = null;
            }
            const code = body?.error?.code ?? null;
            const lowerCode = code?.toLowerCase() ?? "";
            const message =
                body?.error?.message ?? `Microsoft Graph request failed (HTTP ${response.status})`;

            if (
                context.deltaFolderId !== undefined &&
                (response.status === 410 || DELTA_EXPIRED_CODES.includes(lowerCode))
            ) {
                throw new OutlookDeltaExpiredError(context.deltaFolderId);
            }
            if (response.status === 401) throw new OutlookAuthError(message, 401, code);
            if (response.status === 403 && AUTH_403_CODES.includes(lowerCode)) {
                throw new OutlookAuthError(message, 403, code);
            }
            if (response.status === 404) {
                throw new OutlookNotFoundError(context.resource ?? url, 404, code);
            }

            const retryable = response.status === 429 || response.status >= 500;
            if (!retryable || attempt === maxAttempts - 1) {
                throw new OutlookApiError(message, response.status, code);
            }

            const header = response.headers.get("Retry-After");
            const retryAfter = header === null ? Number.NaN : Number(header);
            const backoffMs = Number.isFinite(retryAfter)
                ? retryAfter * 1000
                : 1000 * 2 ** attempt + Math.random() * 500;
            await sleep(backoffMs);
        }
        throw new OutlookApiError(
            `Microsoft Graph request failed (HTTP ${lastStatus})`,
            lastStatus
        );
    }

    async function json<T>(url: string, context?: FetchContext): Promise<T> {
        const response = await graphFetch(url, context);
        return (await response.json()) as T;
    }

    /** Every page of a `{ value, @odata.nextLink }` collection. */
    async function collection<T>(url: string, context?: FetchContext): Promise<T[]> {
        const all: T[] = [];
        let next: string | undefined = url;
        while (next) {
            const page: { value?: readonly T[]; "@odata.nextLink"?: string } = await json(
                next,
                context
            );
            all.push(...(page.value ?? []));
            next = page["@odata.nextLink"];
        }
        return all;
    }

    return {
        getProfile() {
            return json<OutlookUser>(`${base}/me`, { resource: "me" });
        },

        listMailFolders() {
            return collection<OutlookMailFolder>(
                `${base}/me/mailFolders?$top=100&includeHiddenFolders=false`,
                { resource: "mail folders" }
            );
        },

        listChildFolders(folderId) {
            return collection<OutlookMailFolder>(
                `${base}/me/mailFolders/${encodeURIComponent(folderId)}/childFolders?$top=100`,
                { resource: `folder ${folderId}` }
            );
        },

        async listFolderDelta(params) {
            const url =
                params.link ??
                `${base}/me/mailFolders/${encodeURIComponent(params.folderId)}` +
                    `/messages/delta?$select=${DELTA_SELECT}`;
            const page = await json<Partial<OutlookDeltaPage>>(url, {
                resource: `folder ${params.folderId}`,
                deltaFolderId: params.folderId,
            });
            return {
                value: page.value ?? [],
                "@odata.nextLink": page["@odata.nextLink"],
                "@odata.deltaLink": page["@odata.deltaLink"],
            };
        },

        listConversationMessages(conversationId) {
            const filter = `conversationId eq '${conversationId.replace(/'/g, "''")}'`;
            return collection<OutlookMessage>(
                `${base}/me/messages?$filter=${encodeURIComponent(filter)}` +
                    `&$top=50&$select=${MESSAGE_SELECT}`,
                { resource: `conversation ${conversationId}` }
            );
        },

        async searchMessages(params) {
            const search = `"${params.query.replace(/"/g, '\\"')}"`;
            const url =
                params.nextLink ??
                `${base}/me/messages?$search=${encodeURIComponent(search)}` +
                    `&$top=50&$select=${SEARCH_SELECT}`;
            const page = await json<Partial<OutlookMessageRefPage>>(url, {
                resource: `search ${params.query}`,
            });
            return { value: page.value ?? [], "@odata.nextLink": page["@odata.nextLink"] };
        },

        listAttachments(messageId) {
            return collection<OutlookAttachment>(
                `${base}/me/messages/${encodeURIComponent(messageId)}` +
                    `/attachments?$select=${ATTACHMENT_SELECT}`,
                { resource: `message ${messageId}` }
            );
        },

        async downloadAttachment(messageId, attachmentId) {
            const response = await graphFetch(
                `${base}/me/messages/${encodeURIComponent(messageId)}` +
                    `/attachments/${encodeURIComponent(attachmentId)}/$value`,
                { resource: `attachment ${messageId}/${attachmentId}` }
            );
            return new Uint8Array(await response.arrayBuffer());
        },
    };
}
