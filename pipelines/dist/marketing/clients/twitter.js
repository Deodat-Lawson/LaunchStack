class TwitterClient {
    get bearerToken() {
        const token = process.env.TWITTER_BEARER_TOKEN;
        if (!token) {
            throw new Error("Twitter Bearer Token not configured");
        }
        return token;
    }
    async makeRequest(url) {
        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${this.bearerToken}`,
                "Content-Type": "application/json",
            },
        });
        if (!response.ok) {
            throw new Error(`Twitter API error: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
    async searchTrendingTweets(query, maxResults) {
        try {
            // Search recent tweets with engagement metrics
            const searchQuery = encodeURIComponent(`${query} -is:retweet lang:en`);
            const url = `https://api.twitter.com/2/tweets/search/recent?query=${searchQuery}&max_results=${Math.min(maxResults, 100)}&tweet.fields=public_metrics,created_at,author_id&sort_order=relevancy`;
            const data = await this.makeRequest(url);
            if (!data.data) {
                return [];
            }
            return data.data
                .filter(tweet => {
                    // Filter by engagement (at least 5 likes or 2 retweets)
                    const metrics = tweet.public_metrics;
                    return metrics && (metrics.like_count >= 5 || metrics.retweet_count >= 2);
                })
                .map(tweet => ({
                    title: tweet.text.slice(0, 100) + (tweet.text.length > 100 ? "..." : ""),
                    url: `https://twitter.com/i/status/${tweet.id}`,
                    snippet: this.formatTweetSnippet(tweet),
                    source: "x",
                }))
                .slice(0, maxResults);
        } catch (error) {
            console.warn("Twitter search error:", error);
            return [];
        }
    }
    async getTrendingTopics(_location = "1") {
        try {
            // Note: Trends endpoint requires Twitter API v1.1 and may need different authentication
            // For now, we'll focus on tweet search which provides good trending content
            return [];
        } catch (error) {
            console.warn("Twitter trends error:", error);
            return [];
        }
    }
    formatTweetSnippet(tweet) {
        const metrics = tweet.public_metrics;
        if (!metrics) return tweet.text.slice(0, 300);
        const engagement = `${metrics.like_count} likes, ${metrics.retweet_count} retweets, ${metrics.reply_count} replies`;
        return `${tweet.text.slice(0, 250)}... [${engagement}]`;
    }
}
export const twitterClient = new TwitterClient();
//# sourceMappingURL=twitter.js.map
