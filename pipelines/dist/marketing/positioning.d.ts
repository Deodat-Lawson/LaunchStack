import type { CompanyDNA, CompetitorAnalysis, StrategyVariant, BrandVoice, TargetPersona } from "./types.js";
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