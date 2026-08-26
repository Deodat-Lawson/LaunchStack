import { type PlatformMeta } from "@launchstack/tools/platform-profiles";
import type { MarketingPlatform, MarketingResearchResult, BrandVoice, TargetPersona, ContentType, StrategyVariant, ContentVariant, RefinementResult } from "./types.js";
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
//# sourceMappingURL=generator.d.ts.map