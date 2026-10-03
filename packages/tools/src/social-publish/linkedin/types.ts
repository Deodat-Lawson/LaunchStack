/** The LinkedIn client's public shapes; behaviour lives in the sibling modules. */

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
        readonly body = ""
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
