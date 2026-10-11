/** The Bluesky client's public shapes; behaviour lives in the sibling modules. */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface BlueskyCredentials {
    /** Handle or DID. */
    identifier: string;
    appPassword: string;
    /** PDS base URL; defaults to BLUESKY_SERVICE_URL or https://bsky.social. */
    service?: string;
}

export interface BlueskyOptions {
    fetch?: FetchLike;
    /** Public AppView for reads; defaults to BLUESKY_APPVIEW_URL or https://public.api.bsky.app. */
    appViewUrl?: string;
}

export class BlueskyApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly authFailed: boolean,
        readonly retryable: boolean,
        readonly body = ""
    ) {
        super(message);
        this.name = "BlueskyApiError";
    }
}

export interface BlueskyProfile {
    did: string;
    handle: string;
    displayName: string | null;
    avatarUrl: string | null;
    /** `followersCount` from the profile view; null when the network did not say. */
    followers: number | null;
}

export interface BlueskyPostRef {
    uri: string;
    cid: string;
}

export interface BlueskyPostStats {
    uri: string;
    likes: number;
    reposts: number;
    replies: number;
    quotes: number;
}

export interface BlueskyReply {
    uri: string;
    cid: string;
    /** The post it answers. */
    parent: BlueskyPostRef;
    /** The thread's first post. */
    root: BlueskyPostRef;
    authorDid: string;
    authorHandle: string;
    authorName: string | null;
    text: string;
    createdAt: Date;
}
