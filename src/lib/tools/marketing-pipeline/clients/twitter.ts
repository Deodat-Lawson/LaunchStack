import { env } from "~/env";
import type { MarketingResearchResult } from "~/lib/tools/marketing-pipeline/types";

interface TwitterTweet {
    id: string;
    text: string;
    public_metrics?: {
        retweet_count: number;
        like_count: number;
        reply_count: number;
        quote_count: number;
    };
    author_id?: string;
    created_at?: string;
}

interface TwitterSearchResponse {
    data?: TwitterTweet[];
    meta?: {
        result_count: number;
    };
}

class TwitterClient {
    private get bearerToken(): string {
        const token = env.server.TWITTER_BEARER_TOKEN;
        if (!token) {
            throw new Error("Twitter Bearer Token not configured");
        }
        return token;
    }

    private async makeRequest<T>(url: string): Promise<T> {
        const response = await fetch(url, {
            headers: {
                "Authorization": `Bearer ${this.bearerToken}`,
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            throw new Error(`Twitter API error: ${response.status} ${response.statusText}`);
        }

        return response.json() as Promise<T>;
    }

    async searchTrendingTweets(query: string, maxResults: number): Promise<MarketingResearchResult[]> {
        try {
            // Search recent tweets with engagement metrics
            const searchQuery = encodeURIComponent(`${query} -is:retweet lang:en`);
            const url = `https://api.twitter.com/2/tweets/search/recent?query=${searchQuery}&max_results=${Math.min(maxResults, 100)}&tweet.fields=public_metrics,created_at,author_id&sort_order=relevancy`;

            const data = await this.makeRequest<TwitterSearchResponse>(url);

            if (!data.data) {
                return [];
            }

            return data.data
                .filter(tweet => {
                    // Filter by engagement (at least 5 likes or 2 retweets)
                    const metrics = tweet.public_metrics;
                    return metrics && (metrics.like_count >= 5 || metrics.retweet_count >= 2);
                })
                .map((tweet): MarketingResearchResult => ({
                    title: tweet.text.slice(0, 100) + (tweet.text.length > 100 ? "..." : ""),
                    url: `https://twitter.com/i/status/${tweet.id}`,
                    snippet: this.formatTweetSnippet(tweet),
                    source: "x" as const,
                }))
                .slice(0, maxResults);

        } catch (error) {
            console.warn("Twitter search error:", error);
            return [];
        }
    }

    async getTrendingTopics(_location = "1"): Promise<Array<{ trend: string; volume?: number }>> {
        try {
            // Note: Trends endpoint requires Twitter API v1.1 and may need different authentication
            // For now, we'll focus on tweet search which provides good trending content
            return [];
        } catch (error) {
            console.warn("Twitter trends error:", error);
            return [];
        }
    }

    private formatTweetSnippet(tweet: TwitterTweet): string {
        const metrics = tweet.public_metrics;
        if (!metrics) return tweet.text.slice(0, 300);

        const engagement = `${metrics.like_count} likes, ${metrics.retweet_count} retweets, ${metrics.reply_count} replies`;
        return `${tweet.text.slice(0, 250)}... [${engagement}]`;
    }
}

export const twitterClient = new TwitterClient();