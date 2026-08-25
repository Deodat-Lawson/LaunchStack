import type { MarketingPlatform, MarketingResearchResult, MessagingStrategy, BrandVoice, TargetPersona, ContentType, StrategyVariant, ContentVariant, RefinementResult } from "./types.js";
interface PlatformMeta {
    subreddit?: string;
    hashtags?: string[];
}
export declare function generateCampaignOutput(args: {
    platform: MarketingPlatform;
    prompt: string;
    companyContext: string;
    research: MarketingResearchResult[];
    strategy?: MessagingStrategy;
    enableQualityGate?: boolean;
    platformMeta?: PlatformMeta;
}): Promise<{
    platform: MarketingPlatform;
    message: string;
    "image/video": "image" | "video";
    competitiveAngle?: string;
    strategyUsed?: MessagingStrategy;
}>;
export declare function generateVariants(args: {
    platform: MarketingPlatform;
    prompt: string;
    companyContext: string;
    research: MarketingResearchResult[];
    strategies: StrategyVariant[];
    enableQualityGate?: boolean;
    platformMeta?: PlatformMeta;
    brandVoice?: BrandVoice;
    targetPersona?: TargetPersona;
    contentType?: ContentType;
}): Promise<ContentVariant[]>;
export declare function refineContent(args: {
    platform: MarketingPlatform;
    originalMessage: string;
    feedback: string;
    companyContext: string;
    brandVoice?: BrandVoice;
}): Promise<RefinementResult>;
export {};
//# sourceMappingURL=generator.d.ts.map