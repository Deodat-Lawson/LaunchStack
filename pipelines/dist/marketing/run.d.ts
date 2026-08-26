import type { MarketingPipelineInput, MarketingPipelineResult, OnPipelineProgress } from "./types.js";
/**
 * The pipeline as a set of stage definitions over @launchstack/tools/stage-runner
 * (unification P2). Each stage declares its failure policy — "required" aborts
 * the run, "degradable" emits a failed step and continues on its fallback —
 * and its wire reporting (detail/data/narration) as colocated data. The runner
 * owns timing, progress events, error policy, and cancellation; `signal`
 * (threaded from the route's request.signal) stops an abandoned run before its
 * next stage instead of burning tokens to completion.
 */
export declare function runMarketingPipeline(args: {
    companyId: number;
    input: MarketingPipelineInput;
    debug?: boolean;
    onProgress?: OnPipelineProgress;
    signal?: AbortSignal;
}): Promise<MarketingPipelineResult>;
//# sourceMappingURL=run.d.ts.map