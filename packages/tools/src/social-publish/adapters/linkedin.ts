import {
    bodyText,
    classifyStatus,
    credentialMismatch,
    errorMessage,
    httpFailure,
    notConfigured,
    thrownFailure,
    verifyHttpFailure,
    verifyMismatch,
} from "../classify";
import { getLinkedInAccessToken, getLinkedInApiVersion } from "../config";
import type { PublishAdapter, PublishResult, VerifyResult } from "../types";

type UserInfo =
    | { ok: true; sub: string; name: string | null }
    | { ok: false; status: number | null; error: string };

/**
 * The OpenID Connect `userinfo` endpoint (tokens with `openid profile`
 * scopes): the member id comes back as `sub`, the display name as `name`.
 * `status` is null when the call never reached LinkedIn.
 */
async function fetchUserInfo(token: string, fetchImpl: typeof fetch): Promise<UserInfo> {
    try {
        const res = await fetchImpl("https://api.linkedin.com/v2/userinfo", {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
            const errText = await bodyText(res);
            return {
                ok: false,
                status: res.status,
                error: `LinkedIn userinfo ${res.status}: ${errText}`,
            };
        }
        const data = (await res.json()) as { sub?: string; name?: string };
        if (!data.sub) {
            return {
                ok: false,
                status: res.status,
                error: "LinkedIn userinfo returned no subject (check token scopes: openid profile)",
            };
        }
        return { ok: true, sub: data.sub, name: data.name ?? null };
    } catch (err) {
        return { ok: false, status: null, error: errorMessage(err) };
    }
}

/**
 * Resolve the authenticated member's person id (for the author URN).
 * Prefers `userinfo`, and falls back to the legacy `/v2/me` endpoint for
 * older `r_liteprofile` tokens. When both fail, the failure with a status
 * wins so the caller can classify it.
 */
async function resolveLinkedInPersonId(
    token: string,
    fetchImpl: typeof fetch
): Promise<{ ok: true; id: string } | { ok: false; status: number | null; error: string }> {
    const info = await fetchUserInfo(token, fetchImpl);
    if (info.ok) return { ok: true, id: info.sub };

    try {
        const res = await fetchImpl("https://api.linkedin.com/v2/me", {
            headers: {
                Authorization: `Bearer ${token}`,
                "X-Restli-Protocol-Version": "2.0.0",
            },
        });
        if (res.ok) {
            const data = (await res.json()) as { id?: string };
            if (data.id) return { ok: true, id: data.id };
        } else if (info.status === null) {
            const errText = await bodyText(res);
            return {
                ok: false,
                status: res.status,
                error: `LinkedIn /v2/me ${res.status}: ${errText}`,
            };
        }
    } catch {
        // fall through to the userinfo failure below
    }

    return info;
}

export const linkedinAdapter: PublishAdapter = {
    platform: "linkedin",
    async publish(request): Promise<PublishResult> {
        const { credentials, message } = request;
        const mismatch = credentialMismatch("linkedin", credentials);
        if (mismatch) return mismatch;

        const token =
            credentials?.platform === "linkedin"
                ? credentials.accessToken
                : getLinkedInAccessToken();
        if (!token) return notConfigured("linkedin", "LinkedIn credentials not configured");

        const fetchImpl = request.fetchImpl ?? fetch;
        const apiVersion = getLinkedInApiVersion();

        try {
            const author = await resolveLinkedInPersonId(token, fetchImpl);
            if (!author.ok) {
                const flags =
                    author.status === null
                        ? { retryable: true, authFailed: false }
                        : classifyStatus(author.status);
                return {
                    success: false,
                    platform: "linkedin",
                    error: `LinkedIn author lookup failed (check token scopes): ${author.error}`,
                    ...flags,
                };
            }

            // Modern versioned Posts API (`/rest/posts`) — replaces the
            // deprecated `/v2/ugcPosts` endpoint.
            const postRes = await fetchImpl("https://api.linkedin.com/rest/posts", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                    "X-Restli-Protocol-Version": "2.0.0",
                    "LinkedIn-Version": apiVersion,
                },
                body: JSON.stringify({
                    author: `urn:li:person:${author.id}`,
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
                const errText = await bodyText(postRes);
                // 426 (or an explicit version complaint) means the requested
                // `LinkedIn-Version` fell out of LinkedIn's ~12-month support
                // window — point operators at the env override.
                if (postRes.status === 426 || /version/i.test(errText)) {
                    return {
                        success: false,
                        platform: "linkedin",
                        error: `LinkedIn rejected API version ${apiVersion} (HTTP ${postRes.status}). Set LINKEDIN_API_VERSION to a currently supported YYYYMM version (LinkedIn supports each version for ~12 months). Details: ${errText}`,
                        status: postRes.status,
                        retryable: false,
                        authFailed: false,
                    };
                }
                return httpFailure(
                    "linkedin",
                    postRes.status,
                    `LinkedIn post failed: ${postRes.status} ${errText}`
                );
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
            return thrownFailure("linkedin", err);
        }
    },

    async verify(credentials, options): Promise<VerifyResult> {
        if (credentials.platform !== "linkedin") return verifyMismatch("linkedin", credentials);
        const fetchImpl = options?.fetchImpl ?? fetch;

        const info = await fetchUserInfo(credentials.accessToken, fetchImpl);
        if (info.ok) return { ok: true, identity: info.name ?? info.sub };
        if (info.status === null) {
            return { ok: false, error: info.error, retryable: true, authFailed: false };
        }
        return verifyHttpFailure(info.status, info.error);
    },
};
