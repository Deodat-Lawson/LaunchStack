/**
 * Marketing content publisher — sends generated content to platform APIs.
 * Currently supports Twitter/X, Reddit, LinkedIn, and Bluesky.
 *
 * Each publisher is behind an env-var gate so missing credentials
 * gracefully return an error instead of crashing.
 */


import type { MarketingPlatform } from './types';

export type PublishResult = {
    success: boolean;
    platform: MarketingPlatform;
    postUrl?: string;
    error?: string;
};

async function publishToTwitter(message: string): Promise<PublishResult> {
    const token = process.env.TWITTER_BEARER_TOKEN;
    if (!token) {
        return { success: false, platform: 'x', error: 'Twitter credentials not configured' };
    }

    try {
        const response = await fetch('https://api.twitter.com/2/tweets', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: message.slice(0, 280) }),
        });

        if (!response.ok) {
            const errText = await response.text();
            return { success: false, platform: 'x', error: `Twitter API ${response.status}: ${errText}` };
        }

        const data = await response.json() as { data?: { id?: string } };
        const tweetId = data.data?.id;
        return {
            success: true,
            platform: 'x',
            postUrl: tweetId ? `https://twitter.com/i/status/${tweetId}` : undefined,
        };
    } catch (err) {
        return { success: false, platform: 'x', error: err instanceof Error ? err.message : 'Unknown error' };
    }
}

async function publishToBluesky(message: string): Promise<PublishResult> {
    const handle = process.env.BLUESKY_HANDLE;
    const password = process.env.BLUESKY_APP_PASSWORD;
    if (!handle || !password) {
        return { success: false, platform: 'bluesky', error: 'Bluesky credentials not configured' };
    }

    try {
        const sessionRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: handle, password }),
        });
        if (!sessionRes.ok) {
            return { success: false, platform: 'bluesky', error: `Bluesky auth failed: ${sessionRes.status}` };
        }

        const session = await sessionRes.json() as { accessJwt: string; did: string };

        const postRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.accessJwt}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                repo: session.did,
                collection: 'app.bsky.feed.post',
                record: {
                    text: message.slice(0, 300),
                    createdAt: new Date().toISOString(),
                },
            }),
        });

        if (!postRes.ok) {
            const errText = await postRes.text();
            return { success: false, platform: 'bluesky', error: `Bluesky post failed: ${errText}` };
        }

        const postData = await postRes.json() as { uri?: string };
        const rkey = postData.uri?.split('/').pop();
        return {
            success: true,
            platform: 'bluesky',
            postUrl: rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : undefined,
        };
    } catch (err) {
        return { success: false, platform: 'bluesky', error: err instanceof Error ? err.message : 'Unknown error' };
    }
}

async function publishToReddit(message: string, title?: string): Promise<PublishResult> {
    const clientId = process.env.REDDIT_CLIENT_ID;
    const clientSecret = process.env.REDDIT_CLIENT_SECRET;
    const userAgent = process.env.REDDIT_USER_AGENT;
    if (!clientId || !clientSecret || !userAgent) {
        return { success: false, platform: 'reddit', error: 'Reddit credentials not configured' };
    }

    try {
        const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${authString}`,
                'User-Agent': userAgent,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
        });
        if (!tokenRes.ok) {
            return { success: false, platform: 'reddit', error: `Reddit auth failed: ${tokenRes.status}` };
        }

        const tokenData = await tokenRes.json() as { access_token: string };
        const postTitle = title ?? message.split('\n')[0]?.slice(0, 300) ?? 'Marketing Post';

        const submitRes = await fetch('https://oauth.reddit.com/api/submit', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'User-Agent': userAgent,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                kind: 'self',
                sr: 'u_me',
                title: postTitle,
                text: message,
            }),
        });

        if (!submitRes.ok) {
            return { success: false, platform: 'reddit', error: `Reddit submit failed: ${submitRes.status}` };
        }

        return { success: true, platform: 'reddit' };
    } catch (err) {
        return { success: false, platform: 'reddit', error: err instanceof Error ? err.message : 'Unknown error' };
    }
}

/**
 * Resolve the authenticated member's person id (for the author URN).
 * Prefers the modern OpenID Connect `userinfo` endpoint (tokens with
 * `openid profile` scopes, which return the id as `sub`), and falls back to
 * the legacy `/v2/me` endpoint for older `r_liteprofile` tokens.
 */
async function resolveLinkedInPersonId(token: string): Promise<string | null> {
    try {
        const res = await fetch('https://api.linkedin.com/v2/userinfo', {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
            const data = await res.json() as { sub?: string };
            if (data.sub) return data.sub;
        }
    } catch {
        // fall through to the legacy endpoint
    }

    try {
        const res = await fetch('https://api.linkedin.com/v2/me', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Restli-Protocol-Version': '2.0.0',
            },
        });
        if (res.ok) {
            const data = await res.json() as { id?: string };
            if (data.id) return data.id;
        }
    } catch {
        // ignore — handled by the null return below
    }

    return null;
}

async function publishToLinkedIn(message: string): Promise<PublishResult> {
    const token = process.env.LINKEDIN_ACCESS_TOKEN;
    if (!token) {
        return { success: false, platform: 'linkedin', error: 'LinkedIn credentials not configured' };
    }

    // The versioned Posts API requires a `LinkedIn-Version` header in YYYYMM
    // form. Override via env when LinkedIn rolls its supported window.
    const apiVersion = process.env.LINKEDIN_API_VERSION ?? '202405';

    try {
        const personId = await resolveLinkedInPersonId(token);
        if (!personId) {
            return {
                success: false,
                platform: 'linkedin',
                error: 'LinkedIn author lookup failed (check token scopes)',
            };
        }

        // Modern versioned Posts API (`/rest/posts`) — replaces the deprecated
        // `/v2/ugcPosts` endpoint.
        const postRes = await fetch('https://api.linkedin.com/rest/posts', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-Restli-Protocol-Version': '2.0.0',
                'LinkedIn-Version': apiVersion,
            },
            body: JSON.stringify({
                author: `urn:li:person:${personId}`,
                commentary: message,
                visibility: 'PUBLIC',
                distribution: {
                    feedDistribution: 'MAIN_FEED',
                    targetEntities: [],
                    thirdPartyDistributionChannels: [],
                },
                lifecycleState: 'PUBLISHED',
                isReshareDisabledByAuthor: false,
            }),
        });

        if (!postRes.ok) {
            const errText = await postRes.text();
            return { success: false, platform: 'linkedin', error: `LinkedIn post failed: ${postRes.status} ${errText}` };
        }

        // The created post's URN is returned in the `x-restli-id` response
        // header; build a public feed URL from it for the "View post" link.
        const postUrn = postRes.headers.get('x-restli-id') ?? undefined;
        return {
            success: true,
            platform: 'linkedin',
            postUrl: postUrn ? `https://www.linkedin.com/feed/update/${postUrn}` : undefined,
        };
    } catch (err) {
        return { success: false, platform: 'linkedin', error: err instanceof Error ? err.message : 'Unknown error' };
    }
}

const PUBLISHERS: Record<MarketingPlatform, (message: string, title?: string) => Promise<PublishResult>> = {
    x: publishToTwitter,
    bluesky: publishToBluesky,
    reddit: publishToReddit,
    linkedin: publishToLinkedIn,
};

/**
 * Publish generated marketing content to the specified platform.
 * Returns a result object indicating success/failure with optional post URL.
 */
export async function publishContent(
    platform: MarketingPlatform,
    message: string,
    title?: string,
): Promise<PublishResult> {
    const publisher = PUBLISHERS[platform];
    return publisher(message, title);
}
