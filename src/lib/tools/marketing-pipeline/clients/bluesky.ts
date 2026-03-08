import { env } from "~/env";
import type { MarketingResearchResult } from "~/lib/tools/marketing-pipeline/types";

interface BlueskySession {
    accessJwt: string;
    refreshJwt: string;
    handle: string;
    did: string;
}

interface BlueskyPost {
    uri: string;
    cid: string;
    author: {
        did: string;
        handle: string;
        displayName?: string;
    };
    record: {
        text: string;
        createdAt: string;
    };
    replyCount: number;
    repostCount: number;
    likeCount: number;
    indexedAt: string;
}

interface BlueskySearchResponse {
    posts: BlueskyPost[];
    cursor?: string;
}

class BlueskyClient {
    private session: BlueskySession | null = null;
    private sessionExpiry = 0;

    private get credentials() {
        const handle = env.server.BLUESKY_HANDLE;
        const password = env.server.BLUESKY_APP_PASSWORD;
        
        if (!handle || !password) {
            throw new Error("Bluesky credentials not configured");
        }
        
        return { handle, password };
    }

    private async createSession(): Promise<BlueskySession> {
        const { handle, password } = this.credentials;

        const response = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                identifier: handle,
                password: password,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Bluesky auth failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const session = await response.json() as BlueskySession;
        this.session = session;
        this.sessionExpiry = Date.now() + 55 * 60 * 1000; // 55 minutes

        return session;
    }

    private async getValidSession(): Promise<BlueskySession> {
        if (this.session && Date.now() < this.sessionExpiry) {
            return this.session;
        }

        return this.createSession();
    }

    private async makeAuthenticatedRequest<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
        const session = await this.getValidSession();
        
        const url = new URL(`https://bsky.social/xrpc/${endpoint}`);
        if (params) {
            Object.entries(params).forEach(([key, value]) => {
                url.searchParams.append(key, value);
            });
        }

        const response = await fetch(url.toString(), {
            headers: {
                "Authorization": `Bearer ${session.accessJwt}`,
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Bluesky API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        return response.json() as Promise<T>;
    }

    async searchTrendingPosts(query: string, maxResults: number): Promise<MarketingResearchResult[]> {
        try {
            // Search posts using the AT Protocol search endpoint
            const searchData = await this.makeAuthenticatedRequest<BlueskySearchResponse>(
                "app.bsky.feed.searchPosts",
                {
                    q: query,
                    limit: Math.min(maxResults, 100).toString(),
                    sort: "latest", // Can be 'top' for trending or 'latest' for recent
                }
            );

            return searchData.posts
                .filter(post => {
                    // Filter posts with some engagement (at least 2 likes or 1 repost)
                    return post.likeCount >= 2 || post.repostCount >= 1;
                })
                .map((post): MarketingResearchResult => ({
                    title: this.extractTitle(post.record.text),
                    url: this.generatePostUrl(post),
                    snippet: this.formatPostSnippet(post),
                    source: "bluesky" as const,
                }))
                .slice(0, maxResults);

        } catch (error) {
            console.warn("Bluesky search error:", error);
            return [];
        }
    }

    async getTrendingFeed(maxResults: number): Promise<MarketingResearchResult[]> {
        try {
            // Get trending posts from the "What's Hot" algorithm feed
            const feedData = await this.makeAuthenticatedRequest<{feed: Array<{post: BlueskyPost}>}>(
                "app.bsky.feed.getFeed",
                {
                    feed: "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot",
                    limit: Math.min(maxResults, 50).toString(),
                }
            );

            return feedData.feed
                .map(item => item.post)
                .filter(post => post.likeCount >= 5) // Higher threshold for trending
                .map((post): MarketingResearchResult => ({
                    title: this.extractTitle(post.record.text),
                    url: this.generatePostUrl(post),
                    snippet: this.formatPostSnippet(post),
                    source: "bluesky" as const,
                }))
                .slice(0, maxResults);

        } catch (error) {
            console.warn("Bluesky trending feed error:", error);
            return [];
        }
    }

    private extractTitle(text: string): string {
        const firstLine = text.split('\n')[0] ?? text;
        return firstLine.slice(0, 120) + (firstLine.length > 120 ? "..." : "");
    }

    private generatePostUrl(post: BlueskyPost): string {
        // Convert AT Protocol URI to web URL
        const postId = post.uri.split('/').pop();
        return `https://bsky.app/profile/${post.author.handle}/post/${postId}`;
    }

    private formatPostSnippet(post: BlueskyPost): string {
        const engagement = `${post.likeCount} likes, ${post.repostCount} reposts, ${post.replyCount} replies`;
        const timeAgo = this.getTimeAgo(post.record.createdAt);
        return `${post.record.text.slice(0, 250)}... [${engagement} • ${timeAgo}]`;
    }

    private getTimeAgo(dateString: string): string {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        
        if (diffHours < 1) return "< 1h ago";
        if (diffHours < 24) return `${diffHours}h ago`;
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays}d ago`;
    }
}

export const blueskyClient = new BlueskyClient();