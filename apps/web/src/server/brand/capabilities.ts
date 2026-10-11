/**
 * What a LinkedIn grant can do, read off the scopes LinkedIn actually
 * granted. LinkedIn decides scopes per developer app (a self-serve app gets
 * member posting; a Community Management app gets Pages), so Brand never
 * assumes a product: every feature follows the scope that enables it.
 */
import type { BrandChannelCapabilities, BrandChannelKind } from "~/server/db/schema/brand";

export interface LinkedInGrantFeatures {
    /** Post as the member themself. */
    memberPosting: boolean;
    /** List the Pages the member administers. */
    pages: boolean;
    /** Post as a Page. */
    pagePosting: boolean;
    /** Page post numbers and follower count (needs the ADMINISTRATOR role too). */
    pageAnalytics: boolean;
    /** Read a Page's comments and reply as the Page. */
    pageComments: boolean;
}

function scopeSet(scopes: string | readonly string[]): Set<string> {
    const list = typeof scopes === "string" ? scopes.split(/[\s,]+/) : scopes;
    return new Set(list.map(s => s.trim()).filter(Boolean));
}

export function linkedInGrantFeatures(scopes: string | readonly string[]): LinkedInGrantFeatures {
    const has = scopeSet(scopes);
    const pagePosting = has.has("w_organization_social") || has.has("w_organization_social_feed");
    const pageReading = has.has("r_organization_social") || has.has("r_organization_social_feed");
    return {
        memberPosting: has.has("w_member_social") || has.has("w_member_social_feed"),
        pages: has.has("rw_organization_admin") || has.has("r_organization_admin"),
        pagePosting,
        pageAnalytics: has.has("rw_organization_admin"),
        pageComments: pagePosting && pageReading,
    };
}

/**
 * A channel's capabilities. A LinkedIn Page's analytics also need the
 * member to be the Page's ADMINISTRATOR — a content admin may post but
 * LinkedIn will not show them the numbers. Member post analytics need
 * `r_member_postAnalytics`, which Brand does not read yet.
 */
export function channelCapabilities(
    platform: string,
    kind: BrandChannelKind,
    scopes: string | readonly string[],
    role: string | null = null
): BrandChannelCapabilities {
    if (platform === "bluesky") {
        return { publish: true, images: true, analytics: true, comments: true };
    }
    if (platform !== "linkedin") {
        return { publish: true, images: false, analytics: false, comments: false };
    }
    const features = linkedInGrantFeatures(scopes);
    if (kind === "organization") {
        return {
            publish: features.pagePosting,
            images: features.pagePosting,
            analytics: features.pageAnalytics && role === "ADMINISTRATOR",
            comments: features.pageComments,
        };
    }
    return {
        publish: features.memberPosting,
        images: features.memberPosting,
        analytics: false,
        comments: false,
    };
}
