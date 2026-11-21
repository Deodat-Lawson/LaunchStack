/**
 * Thin Microsoft Graph v1.0 client over `fetch` — the eight file endpoints the
 * connector needs, and nothing else. Same posture as the Drive client: not
 * the Graph SDK (its auth machinery duplicates what the host already owns),
 * credentials injected per call, one retry wrapper for throttling and 5xx.
 *
 * OneDrive and SharePoint are the same API: a SharePoint document library is
 * a drive, so every call is addressed `drives/{driveId}/items/{itemId}` and a
 * file picked from a site just works.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/** Children per listing page. */
export const GRAPH_CHILDREN_PAGE_SIZE = 200;

export interface GraphItemReference {
    readonly driveId?: string;
    readonly id?: string;
    /** `/drives/{driveId}/root:/Folder/Sub` — percent-encoded by Graph. */
    readonly path?: string;
}

export interface GraphFileFacet {
    readonly mimeType?: string;
    readonly hashes?: {
        readonly quickXorHash?: string;
        readonly sha256Hash?: string;
    };
}

/** A "shared with me" entry: a pointer at an item in someone else's drive. */
export interface GraphRemoteItem {
    readonly id?: string;
    readonly name?: string;
    readonly parentReference?: GraphItemReference;
    readonly file?: GraphFileFacet;
    readonly folder?: { readonly childCount?: number };
}

export interface GraphDriveItem {
    readonly id: string;
    readonly name: string;
    readonly size?: number;
    readonly eTag?: string;
    /** Changes when the content does; a rename or a move leaves it alone. */
    readonly cTag?: string;
    readonly lastModifiedDateTime?: string;
    readonly webUrl?: string;
    readonly file?: GraphFileFacet;
    readonly folder?: { readonly childCount?: number };
    /** A container that is neither file nor folder — a OneNote notebook. */
    readonly package?: { readonly type?: string };
    readonly parentReference?: GraphItemReference;
    readonly remoteItem?: GraphRemoteItem;
    readonly deleted?: { readonly state?: string };
}

export interface GraphDriveItemList {
    readonly value: readonly GraphDriveItem[];
    /** Absolute URL of the next page; fetched as-is. */
    readonly "@odata.nextLink"?: string;
}

export interface GraphDrive {
    readonly id: string;
    /** `personal`, `business` (OneDrive for work) or `documentLibrary` (SharePoint). */
    readonly driveType?: string;
    readonly webUrl?: string;
    readonly name?: string;
}

export interface GraphSite {
    readonly id: string;
    readonly displayName?: string;
    readonly name?: string;
    readonly webUrl?: string;
}

export class Microsoft365ApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        /** Graph's `error.code`, when the body carried one. */
        readonly code: string | null = null
    ) {
        super(message);
        this.name = "Microsoft365ApiError";
    }
}

/** 401: the token is dead or was never good for Graph — reconnect. */
export class Microsoft365AuthError extends Microsoft365ApiError {
    constructor(message: string, status = 401, code: string | null = null) {
        super(message, status, code);
        this.name = "Microsoft365AuthError";
    }
}

/** The item is gone (404) or the account can no longer read it (403 accessDenied). */
export class Microsoft365AccessError extends Error {
    constructor(
        readonly resource: string,
        readonly status: number
    ) {
        super(
            `Microsoft 365 item ${resource} is inaccessible (HTTP ${status}) — deleted or access lost`
        );
        this.name = "Microsoft365AccessError";
    }
}

export interface Microsoft365Client {
    /** The signed-in person's own OneDrive. */
    getMyDrive(): Promise<GraphDrive>;
    /** One item; `itemId` may be `"root"` for the drive's root folder. */
    getItem(driveId: string, itemId: string): Promise<GraphDriveItem>;
    /**
     * One page of a folder's direct children (`itemId` may be `"root"`). Pass
     * the previous page's `@odata.nextLink` to continue.
     */
    listChildren(driveId: string, itemId: string, nextLink?: string): Promise<GraphDriveItemList>;
    /** Raw bytes of a file. */
    download(driveId: string, itemId: string): Promise<Uint8Array>;
    /** The item behind a sharing link someone pasted. */
    getSharedItem(sharingUrl: string): Promise<GraphDriveItem>;
    searchSites(query: string): Promise<readonly GraphSite[]>;
    /** A SharePoint site's document libraries. */
    listSiteDrives(siteId: string): Promise<readonly GraphDrive[]>;
}

export interface Microsoft365ClientOptions {
    readonly accessToken: string;
    /** Graph v1.0 root; defaults to Microsoft. The host points it at a dev stand-in. */
    readonly baseUrl?: string;
    readonly fetch?: FetchLike;
    /** Retry attempts for throttling / 5xx. */
    readonly maxAttempts?: number;
    /** Injectable for tests; defaults to real setTimeout. */
    readonly sleep?: (ms: number) => Promise<void>;
}

interface GraphErrorBody {
    error?: {
        code?: string;
        message?: string;
    };
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * A sharing URL as the token `/shares/{token}` takes: `u!` plus the URL in
 * unpadded base64url.
 */
export function encodeSharingUrl(url: string): string {
    return `u!${Buffer.from(url, "utf8").toString("base64url")}`;
}

export function createMicrosoft365Client(options: Microsoft365ClientOptions): Microsoft365Client {
    const fetchImpl = options.fetch ?? fetch;
    const sleep = options.sleep ?? defaultSleep;
    const maxAttempts = options.maxAttempts ?? 5;
    const base = (options.baseUrl ?? GRAPH_BASE).replace(/\/$/, "");

    async function graphFetch(url: string, resource?: string): Promise<Response> {
        let lastStatus = 0;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const response = await fetchImpl(url, {
                headers: { Authorization: `Bearer ${options.accessToken}` },
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
            const message =
                body?.error?.message ?? `Microsoft Graph request failed (HTTP ${response.status})`;

            if (response.status === 401) throw new Microsoft365AuthError(message, 401, code);
            if (
                response.status === 404 ||
                (response.status === 403 && code?.toLowerCase() === "accessdenied")
            ) {
                throw new Microsoft365AccessError(resource ?? url, response.status);
            }

            const retryable = response.status === 429 || response.status >= 500;
            if (!retryable || attempt === maxAttempts - 1) {
                throw new Microsoft365ApiError(message, response.status, code);
            }

            const header = response.headers.get("Retry-After");
            const retryAfter = header === null ? Number.NaN : Number(header);
            const backoffMs = Number.isFinite(retryAfter)
                ? retryAfter * 1000
                : 1000 * 2 ** attempt + Math.random() * 500;
            await sleep(backoffMs);
        }
        throw new Microsoft365ApiError(
            `Microsoft Graph request failed (HTTP ${lastStatus})`,
            lastStatus
        );
    }

    async function json<T>(url: string, resource?: string): Promise<T> {
        const response = await graphFetch(url, resource);
        return (await response.json()) as T;
    }

    /** Every page of a `{ value, @odata.nextLink }` collection. */
    async function collection<T>(url: string, resource?: string): Promise<T[]> {
        const all: T[] = [];
        let next: string | undefined = url;
        while (next) {
            const page: { value?: readonly T[]; "@odata.nextLink"?: string } = await json(
                next,
                resource
            );
            all.push(...(page.value ?? []));
            next = page["@odata.nextLink"];
        }
        return all;
    }

    function itemUrl(driveId: string, itemId: string): string {
        const drive = `${base}/drives/${encodeURIComponent(driveId)}`;
        return itemId === "root" ? `${drive}/root` : `${drive}/items/${encodeURIComponent(itemId)}`;
    }

    return {
        getMyDrive() {
            return json<GraphDrive>(`${base}/me/drive`, "me/drive");
        },

        getItem(driveId, itemId) {
            return json<GraphDriveItem>(itemUrl(driveId, itemId), `${driveId}:${itemId}`);
        },

        async listChildren(driveId, itemId, nextLink) {
            const url =
                nextLink ?? `${itemUrl(driveId, itemId)}/children?$top=${GRAPH_CHILDREN_PAGE_SIZE}`;
            const page = await json<Partial<GraphDriveItemList>>(url, `${driveId}:${itemId}`);
            return { value: page.value ?? [], "@odata.nextLink": page["@odata.nextLink"] };
        },

        async download(driveId, itemId) {
            // Graph answers 302 to a pre-authenticated URL; fetch follows it.
            const response = await graphFetch(
                `${itemUrl(driveId, itemId)}/content`,
                `${driveId}:${itemId}`
            );
            return new Uint8Array(await response.arrayBuffer());
        },

        getSharedItem(sharingUrl) {
            return json<GraphDriveItem>(
                `${base}/shares/${encodeSharingUrl(sharingUrl)}/driveItem`,
                "shared link"
            );
        },

        searchSites(query) {
            return collection<GraphSite>(
                `${base}/sites?search=${encodeURIComponent(query)}`,
                "sites"
            );
        },

        listSiteDrives(siteId) {
            return collection<GraphDrive>(
                `${base}/sites/${encodeURIComponent(siteId)}/drives`,
                `site ${siteId}`
            );
        },
    };
}
