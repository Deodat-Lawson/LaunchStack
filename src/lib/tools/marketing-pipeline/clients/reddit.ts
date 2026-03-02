import { env } from "~/env";
import type { MarketingResearchResult } from "~/lib/tools/marketing-pipeline/types";

interface RedditPost {
    data: {
        title: string;
        url: string;
        selftext: string;
        score: number;
        num_comments: number;
        subreddit: string;
        permalink: string;
    };
}

interface RedditResponse {
    data: {
        children: RedditPost[];
    };
}

class RedditClient {
    private accessToken: string | null = null;
    private tokenExpiry: number = 0;

    private async getAccessToken(): Promise<string> {
        const clientId = env.server.REDDIT_CLIENT_ID;
        const clientSecret = env.server.REDDIT_CLIENT_SECRET;
        const userAgent = env.server.REDDIT_USER_AGENT;

        if (!clientId || !clientSecret || !userAgent) {
            throw new Error("Reddit API credentials not configured");
        }

        // Use cached token if still valid
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }

        // Get new access token
        const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        
        const response = await fetch("https://www.reddit.com/api/v1/access_token", {
            method: "POST",
            headers: {
                "Authorization": `Basic ${authString}`,
                "User-Agent": userAgent,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: "grant_type=client_credentials",
        });

        if (!response.ok) {
            throw new Error(`Reddit auth failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as { access_token: string; expires_in: number };
        this.accessToken = data.access_token;
        this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // Refresh 1 min early

        return this.accessToken;
    }

    async searchTrendingPosts(query: string, maxResults: number): Promise<MarketingResearchResult[]> {
        const token = await this.getAccessToken();
        const userAgent = env.server.REDDIT_USER_AGENT!;

        // Search both hot and top posts for trending content
        const searches = [
            `https://oauth.reddit.com/search?q=${encodeURIComponent(query)}&sort=hot&limit=${Math.min(maxResults, 25)}&type=link`,
            `https://oauth.reddit.com/r/all/hot?limit=${Math.min(maxResults, 25)}&q=${encodeURIComponent(query)}`
        ];

        const results: MarketingResearchResult[] = [];

        for (const searchUrl of searches) {
            try {
                const response = await fetch(searchUrl, {
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "User-Agent": userAgent,
                    },
                });

                if (!response.ok) continue;

                const data = await response.json() as RedditResponse;
                
                const posts = data.data.children
                    .filter(post => post.data.score > 50) // Filter by engagement
                    .map((post): MarketingResearchResult => ({
                        title: post.data.title,
                        url: `https://reddit.com${post.data.permalink}`,
                        snippet: post.data.selftext.slice(0, 300) || `${post.data.score} upvotes, ${post.data.num_comments} comments in r/${post.data.subreddit}`,
                        source: "reddit" as const,
                    }));

                results.push(...posts);
                
                if (results.length >= maxResults) break;
            } catch (error) {
                console.warn("Reddit search error:", error);
                continue;
            }
        }

        return results.slice(0, maxResults);
    }
}

export const redditClient = new RedditClient();