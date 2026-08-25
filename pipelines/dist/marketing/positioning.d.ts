import type {
    CompanyDNA,
    CompetitorAnalysis,
    MessagingStrategy,
    StrategyVariant,
    BrandVoice,
    TargetPersona,
} from "./types.js";
/**
 * Build a single MessagingStrategy from company DNA, competitor analysis, and optional trend summary.
 */
export declare function buildMessagingStrategy(args: {
    dna: CompanyDNA;
    competitors: CompetitorAnalysis;
    trendsSummary?: string;
    userPrompt?: string;
}): Promise<MessagingStrategy>;
/**
 * Build 3 strategy variants from different positioning angles.
 */
export declare function buildMultiStrategy(args: {
    dna: CompanyDNA;
    competitors: CompetitorAnalysis;
    trendsSummary?: string;
    userPrompt?: string;
    brandVoice?: BrandVoice;
    targetPersona?: TargetPersona;
    performanceInsights?: string[];
}): Promise<StrategyVariant[]>;
//# sourceMappingURL=positioning.d.ts.map
