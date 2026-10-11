/** LinkedIn Pages: which ones the member runs, their follower totals, and their posts' numbers. */
import {
    encodeUrn,
    linkedInContext,
    linkedInRequest,
    mapLimit,
    readJson,
    type LinkedInContext,
} from "./http";
import {
    LinkedInApiError,
    type LinkedInClientOptions,
    type LinkedInOrganization,
    type LinkedInOrgRole,
    type LinkedInPostStats,
} from "./types";

const PAGE_ROLES: readonly LinkedInOrgRole[] = ["ADMINISTRATOR", "CONTENT_ADMINISTRATOR"];
const ACL_PAGE_SIZE = 100;
const ACL_MAX_PAGES = 10;
const ORG_URN = /^urn:li:organization:(\d+)$/;

interface AclElement {
    role?: string;
    state?: string;
    organization?: string;
    /** Newer versions name the field this way. */
    organizationTarget?: string;
}

interface OrganizationRecord {
    id?: number | string;
    localizedName?: string;
    vanityName?: string;
    logoV2?: { original?: string; cropped?: string };
}

/**
 * Pages the member administers or posts for (organizationAcls, approved),
 * with name and logo. Keeps ADMINISTRATOR and CONTENT_ADMINISTRATOR roles;
 * one entry per Page, ADMINISTRATOR winning when the member holds both.
 *
 * A 403 on organizationAcls means the token was granted without the Pages
 * scopes (Community Management API): that returns `[]`, and the caller
 * decides whether to tell the member. Page details are read one by one
 * (batch lookups are blocked on the development tier); a Page whose details
 * are refused keeps a placeholder name, and a logo that cannot be resolved
 * is null rather than a failure.
 */
export async function listAdministeredOrganizations(
    opts: LinkedInClientOptions
): Promise<LinkedInOrganization[]> {
    const ctx = linkedInContext(opts);
    const roles = new Map<string, LinkedInOrgRole>();

    for (let page = 0; page < ACL_MAX_PAGES; page++) {
        const res = await linkedInRequest(ctx, {
            path: `/rest/organizationAcls?q=roleAssignee&state=APPROVED&count=${ACL_PAGE_SIZE}&start=${page * ACL_PAGE_SIZE}`,
            what: "list the Pages this member administers",
            allow: [403],
        });
        if (res.status === 403) {
            // Read the body so the connection is released; the answer is "no Pages access".
            await res.text().catch(() => "");
            if (page === 0) return [];
            break;
        }
        const data = await readJson<{ elements?: AclElement[] }>(res);
        const elements = data?.elements ?? [];
        for (const el of elements) {
            const urn = el.organization ?? el.organizationTarget;
            const role = el.role as LinkedInOrgRole | undefined;
            if (!urn || !ORG_URN.test(urn) || !role || !PAGE_ROLES.includes(role)) continue;
            if (el.state && el.state !== "APPROVED") continue;
            if (roles.get(urn) !== "ADMINISTRATOR") roles.set(urn, role);
        }
        if (elements.length < ACL_PAGE_SIZE) break;
    }

    return mapLimit([...roles], 4, ([urn, role]) => describeOrganization(ctx, urn, role));
}

async function describeOrganization(
    ctx: LinkedInContext,
    urn: string,
    role: LinkedInOrgRole
): Promise<LinkedInOrganization> {
    const id = ORG_URN.exec(urn)![1]!;
    let record: OrganizationRecord | null = null;
    try {
        const res = await linkedInRequest(ctx, {
            path: `/rest/organizations/${id}`,
            what: `read LinkedIn Page ${id}`,
        });
        record = await readJson<OrganizationRecord>(res);
    } catch (err) {
        // A token or capacity problem fails the listing; a Page we may not read keeps a placeholder.
        if (!(err instanceof LinkedInApiError) || err.authFailed || err.retryable) throw err;
    }

    const logoUrn = record?.logoV2?.original ?? record?.logoV2?.cropped ?? null;
    return {
        id,
        urn,
        name: record?.localizedName?.trim() || `LinkedIn Page ${id}`,
        vanityName: record?.vanityName?.trim() || null,
        logoUrl: logoUrn ? await resolveImageUrl(ctx, logoUrn) : null,
        role,
    };
}

/**
 * The download URL for an image or digital-media-asset URN, or null. Asset
 * URNs (`urn:li:digitalmediaAsset:X`) are the same media as `urn:li:image:X`,
 * which is the form the Images API accepts.
 */
async function resolveImageUrl(ctx: LinkedInContext, urn: string): Promise<string | null> {
    const match = /^urn:li:(?:image|digitalmediaAsset):(.+)$/i.exec(urn);
    if (!match) return null;
    try {
        const res = await linkedInRequest(ctx, {
            path: `/rest/images/${encodeUrn(`urn:li:image:${match[1]}`)}`,
            what: "read the Page logo",
        });
        const image = await readJson<{ downloadUrl?: string }>(res);
        return image?.downloadUrl?.trim() || null;
    } catch {
        return null;
    }
}

/** The Page's follower total (networkSizes), or null when LinkedIn will not say (403/404). */
export async function getOrganizationFollowerCount(
    opts: LinkedInClientOptions & { organizationUrn: string }
): Promise<number | null> {
    const ctx = linkedInContext(opts);
    const res = await linkedInRequest(ctx, {
        path: `/rest/networkSizes/${encodeUrn(opts.organizationUrn)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`,
        what: "read the Page's follower count",
        allow: [403, 404],
    });
    if (res.status === 403 || res.status === 404) {
        await res.text().catch(() => "");
        return null;
    }
    const data = await readJson<{ firstDegreeSize?: number }>(res);
    return typeof data?.firstDegreeSize === "number" ? data.firstDegreeSize : null;
}

const STATS_CHUNK = 20;

interface ShareStatisticsElement {
    share?: string;
    ugcPost?: string;
    totalShareStatistics?: {
        impressionCount?: number;
        uniqueImpressionsCount?: number;
        clickCount?: number;
        likeCount?: number;
        commentCount?: number;
        shareCount?: number;
        engagement?: number;
    };
}

/**
 * Lifetime numbers for a Page's posts, keyed by post URN (absent = no
 * activity yet: LinkedIn omits posts with no impressions or actions).
 * `urn:li:share:` ids go in `shares=List(…)`, `urn:li:ugcPost:` ids in
 * `ugcPosts=List(…)`; other URN kinds are skipped. 20 URNs per call.
 */
export async function getOrganizationPostStats(
    opts: LinkedInClientOptions & { organizationUrn: string; postUrns: string[] }
): Promise<Map<string, LinkedInPostStats>> {
    const ctx = linkedInContext(opts);
    const stats = new Map<string, LinkedInPostStats>();
    const urns = [...new Set(opts.postUrns.filter(u => /^urn:li:(share|ugcPost):/.test(u)))];

    for (let i = 0; i < urns.length; i += STATS_CHUNK) {
        const chunk = urns.slice(i, i + STATS_CHUNK);
        const shares = chunk.filter(u => u.startsWith("urn:li:share:"));
        const ugcPosts = chunk.filter(u => u.startsWith("urn:li:ugcPost:"));
        let query = `q=organizationalEntity&organizationalEntity=${encodeUrn(opts.organizationUrn)}`;
        if (shares.length) query += `&shares=List(${shares.map(encodeUrn).join(",")})`;
        if (ugcPosts.length) query += `&ugcPosts=List(${ugcPosts.map(encodeUrn).join(",")})`;

        const res = await linkedInRequest(ctx, {
            path: `/rest/organizationalEntityShareStatistics?${query}`,
            what: "read the Page's post statistics",
        });
        const data = await readJson<{ elements?: ShareStatisticsElement[] }>(res);
        for (const el of data?.elements ?? []) {
            const postUrn = el.share ?? el.ugcPost;
            const t = el.totalShareStatistics;
            if (!postUrn || !t) continue;
            stats.set(postUrn, {
                postUrn,
                impressions: t.impressionCount ?? 0,
                uniqueImpressions: t.uniqueImpressionsCount ?? null,
                clicks: t.clickCount ?? 0,
                // likeCount can dip below zero (an unlike of a sponsored like counts as organic).
                reactions: Math.max(0, t.likeCount ?? 0),
                comments: t.commentCount ?? 0,
                shares: t.shareCount ?? 0,
                engagement: typeof t.engagement === "number" ? t.engagement : null,
            });
        }
    }
    return stats;
}
