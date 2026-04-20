export { runMarketingPipeline } from "~/lib/tools/marketing-pipeline/run";
export { publishContent, type PublishResult } from "~/lib/tools/marketing-pipeline/publish";
export { generateVariants, refineContent } from "~/lib/tools/marketing-pipeline/generator";
export { extractBrandVoice } from "~/lib/tools/marketing-pipeline/voice";
export { extractTargetPersona } from "~/lib/tools/marketing-pipeline/persona";
export { verifyClaimSources } from "~/lib/tools/marketing-pipeline/claim-verifier";
export { getPerformanceHistory, buildPerformanceInsights, saveGeneratedContent } from "~/lib/tools/marketing-pipeline/performance";
export { buildMultiStrategy } from "~/lib/tools/marketing-pipeline/positioning";
export {
    MarketingPipelineInputSchema,
    MarketingPipelineOutputSchema,
    MarketingPlatformEnum,
    PIPELINE_STEPS,
    BrandVoiceSchema,
    TargetPersonaSchema,
    ContentTypeEnum,
    FormalityLevelEnum,
} from "~/lib/tools/marketing-pipeline/types";
export type {
    MarketingPipelineInput,
    MarketingPipelineOutput,
    MarketingPipelineResult,
    MarketingPlatform,
    MarketingResearchResult,
    PipelineStepId,
    PipelineSSEEvent,
    OnPipelineProgress,
    BrandVoice,
    TargetPersona,
    StrategyVariant,
    ContentVariant,
    ClaimSource,
    ContentType,
    FormalityLevel,
    PipelineStages,
    RefinementResult,
} from "~/lib/tools/marketing-pipeline/types";

