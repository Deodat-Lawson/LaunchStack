export { runMarketingPipeline } from "~/lib/tools/marketing-pipeline/run";
export type { PipelineStageEvent, PipelineStageId, OnStageUpdate } from "~/lib/tools/marketing-pipeline/run";
export { publishContent, type PublishResult } from "~/lib/tools/marketing-pipeline/publish";
export { refineContent } from "~/lib/tools/marketing-pipeline/generator";
export { saveGeneratedContent } from "~/lib/tools/marketing-pipeline/performance";
export {
    MarketingPipelineInputSchema,
    MarketingPipelineOutputSchema,
    MarketingPlatformEnum,
    RefinementInputSchema,
    ContentTypeEnum,
    FormalityLevelEnum,
} from "~/lib/tools/marketing-pipeline/types";
export type {
    MarketingPipelineInput,
    MarketingPipelineOutput,
    MarketingPipelineResult,
    MarketingPlatform,
    MarketingResearchResult,
    ContentVariant,
    StrategyVariant,
    BrandVoice,
    TargetPersona,
    ClaimSource,
    PipelineStages,
    RefinementInput,
    RefinementResult,
    ContentType,
} from "~/lib/tools/marketing-pipeline/types";

