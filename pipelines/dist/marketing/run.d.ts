import type { MarketingPipelineInput, MarketingPipelineResult, OnPipelineProgress } from "./types.js";
export declare function runMarketingPipeline(args: {
    companyId: number;
    input: MarketingPipelineInput;
    debug?: boolean;
    onProgress?: OnPipelineProgress;
}): Promise<MarketingPipelineResult>;
//# sourceMappingURL=run.d.ts.map