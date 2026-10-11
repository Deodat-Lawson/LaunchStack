/**
 * Bluesky client for Brand: verify a handle + app password, post (with
 * images), read back post counts, list and send replies. Pure functions over
 * credentials and an injectable `fetch`.
 *
 * CONTRACT STUB — implementation lands in the next commit.
 */
import type { PublishMedia } from "../types";

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
        readonly body: string = ""
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

const STUB = "bluesky client: not implemented yet";

/** Sign in once and read the profile: proves the app password and names the account. */
export async function verifyBlueskyCredentials(
    _creds: BlueskyCredentials,
    _opts?: BlueskyOptions
): Promise<BlueskyProfile> {
    throw new Error(STUB);
}

/** A public profile from the AppView (no sign-in): name, avatar, followers. */
export async function getBlueskyProfile(
    _actor: string,
    _opts?: BlueskyOptions
): Promise<BlueskyProfile> {
    throw new Error(STUB);
}

/** Post as the account; images are uploaded as blobs and embedded (up to 4). */
export async function createBlueskyPost(
    _creds: BlueskyCredentials,
    _post: { text: string; media?: PublishMedia[]; reply?: { root: BlueskyPostRef; parent: BlueskyPostRef } },
    _opts?: BlueskyOptions
): Promise<BlueskyPostRef & { url: string }> {
    throw new Error(STUB);
}

/** Counts for up to 25 posts per call (public AppView, no auth). */
export async function getBlueskyPostStats(
    _uris: string[],
    _opts?: BlueskyOptions
): Promise<Map<string, BlueskyPostStats>> {
    throw new Error(STUB);
}

/** Direct and nested replies to a post (public AppView), newest first. */
export async function listBlueskyReplies(
    _uri: string,
    _opts?: BlueskyOptions
): Promise<BlueskyReply[]> {
    throw new Error(STUB);
}

/** Public URL for a post: https://bsky.app/profile/<handle>/post/<rkey>. */
export function blueskyPostUrl(handleOrDid: string, uri: string): string {
    const rkey = uri.split("/").pop() ?? "";
    return `https://bsky.app/profile/${handleOrDid}/post/${rkey}`;
}
