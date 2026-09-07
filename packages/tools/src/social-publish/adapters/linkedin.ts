import { getLinkedInAccessToken, getLinkedInApiVersion } from "../config";
import type { PublishAdapter, PublishResult } from "../types";

/**
 * Resolve the authenticated member's person id (for the author URN).
 * Prefers the modern OpenID Connect `userinfo` endpoint (tokens with
 * `openid profile` scopes, which return the id as `sub`), and falls back to
 * the legacy `/v2/me` endpoint for older `r_liteprofile` tokens.
 */
async function resolveLinkedInPersonId(token: string): Promise<string | null> {
    try {
        const res = await fetch("https://api.linkedin.com/v2/userinfo", {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
            const data = (await res.json()) as { sub?: string };
            if (data.sub) return data.sub;
        }
    } catch {
        // fall through to the legacy endpoint
    }

    try {
        const res = await fetch("https://api.linkedin.com/v2/me", {
            headers: {
                Authorization: `Bearer ${token}`,
                "X-Restli-Protocol-Version": "2.0.0",
            },
        });
        if (res.ok) {
            const data = (await res.json()) as { id?: string };
            if (data.id) return data.id;
        }
    } catch {
        // ignore — handled by the null return below
    }

    return null;
}

export const linkedinAdapter: PublishAdapter = {
    platform: "linkedin",
    async publish({ message }): Promise<PublishResult> {
        const token = getLinkedInAccessToken();
        if (!token) {
            return {
                success: false,
                platform: "linkedin",
                error: "LinkedIn credentials not configured",
            };
        }

        const apiVersion = getLinkedInApiVersion();

        try {
            const personId = await resolveLinkedInPersonId(token);
            if (!personId) {
                return {
                    success: false,
                    platform: "linkedin",
                    error: "LinkedIn author lookup failed (check token scopes)",
                };
            }

            // Modern versioned Posts API (`/rest/posts`) — replaces the
            // deprecated `/v2/ugcPosts` endpoint.
            const postRes = await fetch("https://api.linkedin.com/rest/posts", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                    "X-Restli-Protocol-Version": "2.0.0",
                    "LinkedIn-Version": apiVersion,
                },
                body: JSON.stringify({
                    author: `urn:li:person:${personId}`,
                    commentary: message,
                    visibility: "PUBLIC",
                    distribution: {
                        feedDistribution: "MAIN_FEED",
                        targetEntities: [],
                        thirdPartyDistributionChannels: [],
                    },
                    lifecycleState: "PUBLISHED",
                    isReshareDisabledByAuthor: false,
                }),
            });

            if (!postRes.ok) {
                const errText = await postRes.text();
                // 426 (or an explicit version complaint) means the requested
                // `LinkedIn-Version` fell out of LinkedIn's ~12-month support
                // window — point operators at the env override.
                if (postRes.status === 426 || /version/i.test(errText)) {
                    return {
                        success: false,
                        platform: "linkedin",
                        error: `LinkedIn rejected API version ${apiVersion} (HTTP ${postRes.status}). Set LINKEDIN_API_VERSION to a currently supported YYYYMM version (LinkedIn supports each version for ~12 months). Details: ${errText}`,
                    };
                }
                return {
                    success: false,
                    platform: "linkedin",
                    error: `LinkedIn post failed: ${postRes.status} ${errText}`,
                };
            }

            // The created post's URN is returned in the `x-restli-id` response
            // header; build a public feed URL from it for the "View post" link.
            const postUrn = postRes.headers.get("x-restli-id") ?? undefined;
            return {
                success: true,
                platform: "linkedin",
                postId: postUrn,
                postUrl: postUrn ? `https://www.linkedin.com/feed/update/${postUrn}` : undefined,
            };
        } catch (err) {
            return {
                success: false,
                platform: "linkedin",
                error: err instanceof Error ? err.message : "Unknown error",
            };
        }
    },
};
