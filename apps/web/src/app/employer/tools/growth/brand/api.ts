/**
 * The Brand area's client contract with `/api/brand/*`. Types mirror the
 * routes' JSON (dates as ISO strings). The preview harness answers the same
 * paths from memory, so screens never know which they are talking to.
 *
 * Vocabulary: a **network** is LinkedIn, X, Bluesky or Reddit. A
 * **connection** is one sign-in a workspace made to a network (a LinkedIn
 * member's OAuth grant, a Bluesky app password). A **channel** is one place
 * a post can go out as: a LinkedIn profile, a LinkedIn Page, a Bluesky
 * account, or the deployment's own account for a network the operator set
 * up with keys. One LinkedIn connection usually brings several channels
 * (the member and each Page they administer).
 */

import type {
    CreatePostTestInput,
    PostTestLink,
    PostTestResult,
    TrackRecord,
} from "~/lib/scenarios/types";

export type { PostTestLink, PostTestResult, TrackRecord };

export type BrandPlatform = "x" | "linkedin" | "bluesky" | "reddit";
export const BRAND_PLATFORMS: readonly BrandPlatform[] = ["linkedin", "x", "bluesky", "reddit"];

/** person = LinkedIn profile, organization = LinkedIn Page, account = Bluesky, deployment = operator keys. */
export type BrandChannelKind = "person" | "organization" | "account" | "deployment";

export interface BrandChannelCapabilities {
    publish: boolean;
    images: boolean;
    analytics: boolean;
    comments: boolean;
}

export interface BrandChannel {
    /** A uuid, or `deployment:<platform>` for the operator's account. */
    id: string;
    platform: BrandPlatform;
    kind: BrandChannelKind;
    name: string;
    /** LinkedIn vanity name or Bluesky handle. */
    handle: string | null;
    avatarUrl: string | null;
    profileUrl: string | null;
    /** Offered in Compose. Admins switch channels off they never post to. */
    enabled: boolean;
    /** reconnect: the network refused the credential; nothing posts until someone reconnects. */
    status: "active" | "reconnect";
    statusReason: string | null;
    connectionId: number | null;
    capabilities: BrandChannelCapabilities;
    /** Page or account followers, as of the last sync. */
    followers: number | null;
    /** Hard character limit Compose enforces. */
    limit: number | null;
}

export interface BrandConnection {
    id: number;
    platform: "linkedin" | "bluesky";
    /** Who signed in: the LinkedIn member's name, the Bluesky handle. */
    accountName: string | null;
    status: "active" | "revoked";
    error: string | null;
    connectedAt: string;
    connectedBy: string | null;
    /** When the access token runs out; null when it does not expire. */
    expiresAt: string | null;
    /** LinkedIn issued a refresh token, so the connection renews itself (for up to a year). */
    refreshable: boolean;
    scopes: string[];
}

export interface BrandNetwork {
    platform: BrandPlatform;
    label: string;
    /** How a workspace gets this network: its own sign-in, its own app password, or the operator's keys. */
    connect: "oauth" | "app-password" | "deployment";
    /** oauth: the deployment holds a client pair. app-password: always. deployment: the keys are set. */
    available: boolean;
    /** LinkedIn only: the app's scopes include Pages (Community Management API). */
    pages: boolean;
    /** What the operator does to make `available` true, in order. Empty when available. */
    setup: string[];
    /** One line on cost and access. */
    note: string;
    limit: number | null;
}

export interface BrandAccounts {
    networks: BrandNetwork[];
    connections: BrandConnection[];
    channels: BrandChannel[];
    /** The member may connect, disconnect and switch channels (connectors.manage). */
    canManage: boolean;
    /** The member may compose, publish, reply and sync (social.publish); Viewers and Guests may not. */
    canPublish: boolean;
}

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

export interface BrandMedia {
    id: string;
    /** Same-origin URL that serves the image to a signed-in member. */
    url: string;
    mimeType: string;
    name: string | null;
    size: number;
    alt: string | null;
}

export interface BrandPostMetrics {
    impressions: number | null;
    reactions: number;
    comments: number;
    shares: number;
    clicks: number | null;
    /** 0..1 when the network reports it. */
    engagement: number | null;
}

export interface BrandPostChannel {
    id: string;
    name: string;
    kind: BrandChannelKind;
    avatarUrl: string | null;
}

export interface BrandPost {
    id: string;
    platform: BrandPlatform;
    /** Null for posts written before channels existed: they go out on the deployment account. */
    channelId: string | null;
    channel: BrandPostChannel | null;
    body: string;
    title: string | null;
    status: BrandPostStatus;
    scheduledAt: string | null;
    publishedAt: string | null;
    postId: string | null;
    postUrl: string | null;
    error: string | null;
    source: BrandPostSource | null;
    media: BrandMedia[];
    metrics: BrandPostMetrics | null;
    metricsAt: string | null;
    createdAt: string;
}

export interface ComposeInput {
    /** Channel ids. */
    channels: string[];
    body: string;
    title?: string | null;
    /** Ids from `uploadMedia`, with alt text. */
    media?: Array<{ id: string; alt?: string | null }>;
    /** ISO time; omit for a draft or when publishing now. */
    scheduledAt?: string | null;
    publishNow?: boolean;
    source?: BrandPostSource;
    /**
     * A finished post test of this exact text. The server links it to the
     * posts for the track record, or answers that it was stale.
     */
    postTestId?: number;
}

export interface PostPatch {
    body?: string;
    title?: string | null;
    scheduledAt?: string | null;
    status?: "cancelled" | "scheduled" | "draft";
}

export interface InsightsChannel {
    channelId: string;
    platform: BrandPlatform;
    kind: BrandChannelKind;
    name: string;
    avatarUrl: string | null;
    followers: number | null;
    posts: number;
    impressions: number;
    reactions: number;
    comments: number;
    shares: number;
    clicks: number;
}

export interface BrandInsights {
    /** Window start and end (ISO). */
    from: string;
    to: string;
    totals: {
        posts: number;
        impressions: number;
        reactions: number;
        comments: number;
        shares: number;
        clicks: number;
        /** Mean engagement rate over posts that report one, 0..1. */
        engagement: number | null;
    };
    channels: InsightsChannel[];
    /** Published posts in the window, newest first, with their numbers. */
    posts: BrandPost[];
    /** When numbers were last read from the networks; null = never. */
    syncedAt: string | null;
}

export interface SyncResult {
    syncedAt: string;
    posts: number;
    comments: number;
    /** One line per channel that could not be read. */
    errors: string[];
}

export interface BrandComment {
    id: string;
    channelId: string;
    platform: BrandPlatform;
    /** The Brand post it is on. */
    postId: string;
    postExcerpt: string;
    postUrl: string | null;
    /** The comment this one answers, when it is a reply. */
    parentId: string | null;
    authorName: string;
    authorHandle: string | null;
    text: string;
    createdAt: string;
    /** Written by the channel itself (a reply sent from here or on the network). */
    isOwn: boolean;
    handledAt: string | null;
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
    const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
    const response = await fetch(url, {
        ...init,
        headers: isForm
            ? (init?.headers ?? {})
            : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
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

/** Where "Connect LinkedIn" goes: the OAuth start, which comes back to Accounts. */
export const LINKEDIN_CONNECT_HREF = "/api/connectors/linkedin/oauth/start?return=growth";

export const brandApi = {
    accounts: () => call<BrandAccounts>("/api/brand/accounts"),
    setChannelEnabled: (id: string, enabled: boolean) =>
        call<{ channel: BrandChannel }>(`/api/brand/channels/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify({ enabled }),
        }),
    connectBluesky: (input: { identifier: string; appPassword: string }) =>
        call<{ connection: BrandConnection; channels: BrandChannel[] }>(
            "/api/brand/connections/bluesky",
            { method: "POST", body: JSON.stringify(input) }
        ),
    /** Re-read the connection's profile and Pages (new Page, renamed Page). */
    refreshConnection: (id: number) =>
        call<{ channels: BrandChannel[] }>(`/api/brand/connections/${id}/refresh`, {
            method: "POST",
        }),
    disconnect: (id: number) =>
        call<{ ok: true }>(`/api/brand/connections/${id}`, { method: "DELETE" }),

    uploadMedia: (file: File) => {
        const form = new FormData();
        form.set("file", file);
        return call<{ media: BrandMedia }>("/api/brand/media", { method: "POST", body: form });
    },

    /** `canPublish`: whether this member may act on the posts (social.publish). */
    posts: (params: { from?: string; to?: string; status?: string } = {}) =>
        call<{ posts: BrandPost[]; now: string; canPublish: boolean }>(
            `/api/brand/posts${q(params)}`
        ),
    compose: (input: ComposeInput) =>
        call<{ posts: BrandPost[]; postTest?: PostTestLink }>("/api/brand/posts", {
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

    insights: (params: { days?: number } = {}) =>
        call<BrandInsights>(
            `/api/brand/insights${q({ days: params.days ? String(params.days) : undefined })}`
        ),
    /** Read numbers and comments from the networks now. */
    sync: () => call<SyncResult>("/api/brand/insights/sync", { method: "POST" }),

    comments: (params: { status?: "open" | "all" } = {}) =>
        call<{ comments: BrandComment[]; syncedAt: string | null }>(
            `/api/brand/comments${q(params)}`
        ),
    reply: (id: string, text: string) =>
        call<{ comment: BrandComment }>(`/api/brand/comments/${id}/reply`, {
            method: "POST",
            body: JSON.stringify({ text }),
        }),
    /** Run a draft past simulated readers (needs social.publish). */
    startPostTest: (input: CreatePostTestInput) =>
        call<{ test: PostTestResult }>("/api/brand/post-tests", {
            method: "POST",
            body: JSON.stringify(input),
        }),
    postTest: (runId: number) => call<{ test: PostTestResult }>(`/api/brand/post-tests/${runId}`),
    /** How tested posts did for real, against the simulation. */
    trackRecord: () => call<{ record: TrackRecord }>("/api/brand/post-tests/track-record"),

    setHandled: (id: string, handled: boolean) =>
        call<{ comment: BrandComment }>(`/api/brand/comments/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ handled }),
        }),
};

/** What the campaign generator hands to Compose through session storage. */
export const COMPOSE_HANDOFF_KEY = "growth:brand:compose";
export interface ComposeHandoff {
    platform: BrandPlatform;
    body: string;
    title?: string | null;
    source?: BrandPostSource;
}
