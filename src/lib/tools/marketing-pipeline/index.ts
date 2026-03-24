export { runMarketingPipeline } from "~/lib/tools/marketing-pipeline/run";
export { publishContent, type PublishResult } from "~/lib/tools/marketing-pipeline/publish";
export {
    MarketingPipelineInputSchema,
    MarketingPipelineOutputSchema,
    MarketingPlatformEnum,
    PIPELINE_STEPS,
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
} from "~/lib/tools/marketing-pipeline/types";

