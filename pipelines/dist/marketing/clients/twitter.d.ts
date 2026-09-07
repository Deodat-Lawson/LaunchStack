import type { MarketingResearchResult } from "../types.js";
declare class TwitterClient {
    private get bearerToken();
    private makeRequest;
    searchTrendingTweets(query: string, maxResults: number): Promise<MarketingResearchResult[]>;
    getTrendingTopics(_location?: string): Promise<
        Array<{
            trend: string;
            volume?: number;
        }>
    >;
    private formatTweetSnippet;
}
export declare const twitterClient: TwitterClient;
export {};
//# sourceMappingURL=twitter.d.ts.map
