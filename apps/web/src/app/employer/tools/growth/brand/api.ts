/**
 * The Brand area's client contract with `/api/brand/*`. Types mirror the
 * routes' JSON (dates as ISO strings). The preview harness answers the same
 * paths from memory, so screens never know which they are talking to.
 */

export type BrandPlatform = "x" | "linkedin" | "bluesky" | "reddit";
export const BRAND_PLATFORMS: readonly BrandPlatform[] = ["linkedin", "x", "bluesky", "reddit"];

export type BrandPostStatus =
    | "draft"
    | "scheduled"
    | "publishing"
    | "published"
    | "failed"
    | "cancelled";

export interface BrandPostSource {
    kind: "compose" | "campaign";
    historyId?: number;
}

export interface BrandPost {
    id: string;
    platform: BrandPlatform;
    body: string;
    title: string | null;
    status: BrandPostStatus;
    scheduledAt: string | null;
    publishedAt: string | null;
    postId: string | null;
    postUrl: string | null;
    error: string | null;
    source: BrandPostSource | null;
    createdAt: string;
}

export interface BrandAccount {
    platform: BrandPlatform;
    label: string;
    configured: boolean;
    identity: string | null;
    limit: number | null;
    requires: string[];
    note: string;
}

export interface ComposeInput {
    platforms: BrandPlatform[];
    body: string;
    title?: string | null;
    /** ISO time; omit for a draft or when publishing now. */
    scheduledAt?: string | null;
    publishNow?: boolean;
    source?: BrandPostSource;
}

export interface PostPatch {
    body?: string;
    title?: string | null;
    scheduledAt?: string | null;
    status?: "cancelled" | "scheduled" | "draft";
}

export class BrandApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly body: unknown
    ) {
        super(message);
        this.name = "BrandApiError";
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
        const message =
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
                ? body.error
                : `Request failed (${response.status})`;
        throw new BrandApiError(message, response.status, body);
    }
    return body as T;
}

const q = (params: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
    const s = search.toString();
    return s ? `?${s}` : "";
};

export const brandApi = {
    accounts: () => call<{ accounts: BrandAccount[] }>("/api/brand/accounts"),
    posts: (params: { from?: string; to?: string; status?: string } = {}) =>
        call<{ posts: BrandPost[]; now: string }>(`/api/brand/posts${q(params)}`),
    compose: (input: ComposeInput) =>
        call<{ posts: BrandPost[] }>("/api/brand/posts", {
            method: "POST",
            body: JSON.stringify(input),
        }),
    patch: (id: string, patch: PostPatch) =>
        call<{ post: BrandPost }>(`/api/brand/posts/${id}`, {
            method: "PATCH",
            body: JSON.stringify(patch),
        }),
    remove: (id: string) => call<{ ok: true }>(`/api/brand/posts/${id}`, { method: "DELETE" }),
    publish: (id: string) =>
        call<{ post: BrandPost }>(`/api/brand/posts/${id}/publish`, { method: "POST" }),
    publishDue: () =>
        call<{ published: BrandPost[]; failed: BrandPost[]; skipped: number }>(
            "/api/brand/posts/publish-due",
            { method: "POST" }
        ),
};

/** What the campaign generator hands to Compose through session storage. */
export const COMPOSE_HANDOFF_KEY = "growth:brand:compose";
export interface ComposeHandoff {
    platform: BrandPlatform;
    body: string;
    title?: string | null;
    source?: BrandPostSource;
}
