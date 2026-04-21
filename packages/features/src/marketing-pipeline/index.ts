export { runMarketingPipeline } from "./run";
export {
    publishContent,
    type PublishResult,
} from "./publish";
export { generateVariants, refineContent } from "./generator";
export { extractBrandVoice } from "./voice";
export { extractTargetPersona } from "./persona";
export { verifyClaimSources } from "./claim-verifier";
export {
    getPerformanceHistory,
    buildPerformanceInsights,
    saveGeneratedContent,
} from "./performance";
export { buildMultiStrategy } from "./positioning";
export { analyzeCompetitors } from "./competitor";
export { buildCompanyKnowledgeContext, extractCompanyDNA } from "./context";
export { MARKETING_MODELS } from "./models";

// Re-export the full types surface so the @launchstack/features/marketing-pipeline
// barrel is the single import path callers need.
export * from "./types";
