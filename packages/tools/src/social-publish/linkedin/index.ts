/**
 * LinkedIn REST client for Brand: who the token belongs to, which Pages it
 * administers, posting (with images), read-back of post and Page numbers,
 * and comments. Pure functions over an access token and an injectable
 * `fetch`; the host owns the token's storage and refresh.
 *
 * CONTRACT STUB — implementation lands in the next commit.
 */
import type { PublishMedia } from "../types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface LinkedInClientOptions {
    accessToken: string;
    fetch?: FetchLike;
    /** Defaults to LINKEDIN_API_BASE_URL or https://api.linkedin.com. */
    apiBaseUrl?: string;
    /** YYYYMM; defaults to LINKEDIN_API_VERSION or the built-in current version. */
    version?: string;
}

/** A non-2xx answer from LinkedIn, classified for the caller. */
export class LinkedInApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        /** 401, or 403 that names the token: reconnect rather than retry. */
        readonly authFailed: boolean,
        /** 429, 5xx or a network failure. */
        readonly retryable: boolean,
        readonly body: string = ""
    ) {
        super(message);
        this.name = "LinkedInApiError";
    }
}

export interface LinkedInMember {
    /** The person id (OpenID `sub`, or `/v2/me` id). */
    id: string;
    /** `urn:li:person:<id>`. */
    urn: string;
    name: string | null;
    email: string | null;
    pictureUrl: string | null;
}

export type LinkedInOrgRole = "ADMINISTRATOR" | "CONTENT_ADMINISTRATOR";

export interface LinkedInOrganization {
    id: string;
    /** `urn:li:organization:<id>`. */
    urn: string;
    name: string;
    vanityName: string | null;
    logoUrl: string | null;
    role: LinkedInOrgRole;
}

export interface LinkedInPostStats {
    postUrn: string;
    impressions: number;
    uniqueImpressions: number | null;
    clicks: number;
    reactions: number;
    comments: number;
    shares: number;
    /** LinkedIn's engagement rate, 0..1. */
    engagement: number | null;
}

export interface LinkedInComment {
    /** `urn:li:comment:(<object urn>,<id>)`. */
    urn: string;
    id: string;
    /** The post (or parent comment) it is on. */
    objectUrn: string;
    parentCommentUrn: string | null;
    actorUrn: string;
    actorName: string | null;
    text: string;
    createdAt: Date;
}

const STUB = "linkedin client: not implemented yet";

/** The token's member: OpenID `/v2/userinfo`, falling back to `/v2/me` (r_basicprofile). */
export async function getLinkedInMember(_opts: LinkedInClientOptions): Promise<LinkedInMember> {
    throw new Error(STUB);
}

/** Pages the member administers or posts for (organizationAcls, approved), with name and logo. */
export async function listAdministeredOrganizations(
    _opts: LinkedInClientOptions
): Promise<LinkedInOrganization[]> {
    throw new Error(STUB);
}

/** Initialize, upload and return the `urn:li:image:…` for one image owned by `ownerUrn`. */
export async function uploadLinkedInImage(
    _opts: LinkedInClientOptions & { ownerUrn: string; image: PublishMedia }
): Promise<string> {
    throw new Error(STUB);
}

/** Create a post (text, optionally one image) as `authorUrn`. */
export async function createLinkedInPost(
    _opts: LinkedInClientOptions & { authorUrn: string; text: string; media?: PublishMedia[] }
): Promise<{ postUrn: string; postUrl: string }> {
    throw new Error(STUB);
}

export async function deleteLinkedInPost(
    _opts: LinkedInClientOptions & { postUrn: string }
): Promise<void> {
    throw new Error(STUB);
}

/** Lifetime numbers for a Page's posts, keyed by post URN (absent = no activity yet). */
export async function getOrganizationPostStats(
    _opts: LinkedInClientOptions & { organizationUrn: string; postUrns: string[] }
): Promise<Map<string, LinkedInPostStats>> {
    throw new Error(STUB);
}

/** The Page's follower total (networkSizes), or null when LinkedIn will not say. */
export async function getOrganizationFollowerCount(
    _opts: LinkedInClientOptions & { organizationUrn: string }
): Promise<number | null> {
    throw new Error(STUB);
}

/** Comments on a post, newest first. */
export async function listLinkedInComments(
    _opts: LinkedInClientOptions & { postUrn: string; count?: number }
): Promise<LinkedInComment[]> {
    throw new Error(STUB);
}

/** Comment on a post as `actorUrn`; with `parentCommentUrn`, a reply to that comment. */
export async function createLinkedInComment(
    _opts: LinkedInClientOptions & {
        actorUrn: string;
        postUrn: string;
        parentCommentUrn?: string | null;
        text: string;
    }
): Promise<LinkedInComment> {
    throw new Error(STUB);
}

/** Public URL for a post URN. */
export function linkedInPostUrl(postUrn: string): string {
    return `https://www.linkedin.com/feed/update/${postUrn}`;
}
