class LinkedInClient {
    get accessToken() {
        const token = process.env.LINKEDIN_ACCESS_TOKEN;
        if (!token) {
            throw new Error("LinkedIn Access Token not configured");
        }
        return token;
    }
    async makeRequest(url) {
        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
                "Content-Type": "application/json",
                "X-Restli-Protocol-Version": "2.0.0",
            },
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                `LinkedIn API error: ${response.status} ${response.statusText} - ${errorText}`
            );
        }
        return response.json();
    }
    async searchTrendingPosts(query, maxResults) {
        try {
            // Note: LinkedIn's public content search is limited
            // We'll focus on UGC (User Generated Content) posts that are publicly available
            // This is a simplified approach - LinkedIn's search API has strict access requirements
            // You may need to use LinkedIn's Content API or Partner Program for full access
            const url = `https://api.linkedin.com/v2/ugcPosts?q=authors&count=${Math.min(maxResults, 50)}`;
            const data = await this.makeRequest(url);
            if (!data.elements) {
                console.warn("No LinkedIn posts found - API access may be limited");
                return [];
            }
            return data.elements
                .filter(post => this.isRelevantPost(post, query))
                .map(post => ({
                    title: this.extractTitle(post),
                    url: this.generatePostUrl(post.id),
                    snippet: this.formatPostSnippet(post),
                    source: "linkedin",
                }))
                .slice(0, maxResults);
        } catch (error) {
            console.warn("LinkedIn search error:", error);
            // Return empty array instead of throwing to allow fallback to web search
            return [];
        }
    }
    isRelevantPost(post, query) {
        const text = this.getPostText(post).toLowerCase();
        const queryWords = query.toLowerCase().split(" ");
        return queryWords.some(word => text.includes(word));
    }
    getPostText(post) {
        return post.specificContent?.["com.linkedin.ugc.ShareContent"]?.shareCommentary?.text ?? "";
    }
    extractTitle(post) {
        const text = this.getPostText(post);
        const firstLine = text.split("\n")[0] ?? text;
        return firstLine.slice(0, 120) + (firstLine.length > 120 ? "..." : "");
    }
    generatePostUrl(postId) {
        // LinkedIn post URLs follow this pattern
        return `https://www.linkedin.com/feed/update/${postId}`;
    }
    formatPostSnippet(post) {
        const text = this.getPostText(post);
        const social = post.socialDetail?.totalSocialActivityCounts;
        if (social) {
            const engagement = `${social.numLikes} likes, ${social.numComments} comments, ${social.numShares} shares`;
            return `${text.slice(0, 250)}... [${engagement}]`;
        }
        return text.slice(0, 300);
    }
    // Alternative: Search LinkedIn articles/posts via web scraping approach
    async searchLinkedInContent(_query, _maxResults) {
        try {
            // This is a fallback approach using LinkedIn's public search
            // Note: This requires careful rate limiting and may have restrictions
            // For now, we'll return an empty array and log that manual implementation is needed
            console.warn(
                "LinkedIn content search requires manual implementation due to API restrictions"
            );
            return [];
        } catch (error) {
            console.warn("LinkedIn content search error:", error);
            return [];
        }
    }
}
export const linkedinClient = new LinkedInClient();
//# sourceMappingURL=linkedin.js.map
