import type { MarketingResearchResult } from "../types.js";
declare class LinkedInClient {
    private get accessToken();
    private makeRequest;
    searchTrendingPosts(query: string, maxResults: number): Promise<MarketingResearchResult[]>;
    private isRelevantPost;
    private getPostText;
    private extractTitle;
    private generatePostUrl;
    private formatPostSnippet;
    searchLinkedInContent(_query: string, _maxResults: number): Promise<MarketingResearchResult[]>;
}
export declare const linkedinClient: LinkedInClient;
export {};
//# sourceMappingURL=linkedin.d.ts.map
