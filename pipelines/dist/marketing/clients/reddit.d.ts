import type { MarketingResearchResult } from "../types.js";
declare class RedditClient {
    private accessToken;
    private tokenExpiry;
    private getAccessToken;
    searchTrendingPosts(query: string, maxResults: number): Promise<MarketingResearchResult[]>;
}
export declare const redditClient: RedditClient;
export {};
//# sourceMappingURL=reddit.d.ts.map