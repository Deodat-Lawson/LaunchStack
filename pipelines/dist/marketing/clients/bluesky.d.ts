import type { MarketingResearchResult } from "../types.js";
declare class BlueskyClient {
    private session;
    private sessionExpiry;
    private get credentials();
    private createSession;
    private getValidSession;
    private makeAuthenticatedRequest;
    searchTrendingPosts(query: string, maxResults: number): Promise<MarketingResearchResult[]>;
    getTrendingFeed(maxResults: number): Promise<MarketingResearchResult[]>;
    private extractTitle;
    private generatePostUrl;
    private formatPostSnippet;
    private getTimeAgo;
}
export declare const blueskyClient: BlueskyClient;
export {};
//# sourceMappingURL=bluesky.d.ts.map
