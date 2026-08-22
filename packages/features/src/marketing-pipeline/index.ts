export { runMarketingPipeline } from "./run";
export { publishContent, type PublishResult } from "./publish";
export { generateVariants, refineContent } from "./generator";
// Moved to @launchstack/tools (unification PR-2); re-exported so existing
// imports keep working. New code should import the tools.
export { extractBrandVoice } from "@launchstack/tools/brand-voice";
export { extractTargetPersona } from "@launchstack/tools/persona";
export { checkClaimSources } from "@launchstack/tools/claim-evidence";
export {
    getPerformanceHistory,
    buildPerformanceInsights,
    saveGeneratedContent,
} from "./performance";
export { buildMultiStrategy } from "./positioning";
export { analyzeCompetitors } from "./competitor";
// Moved to @launchstack/tools/company-context (unification PR-1); re-exported
// so existing route imports keep working. New code should import the tool.
export {
    buildCompanyKnowledgeContext,
    extractCompanyDNA,
} from "@launchstack/tools/company-context";

// Re-export the full types surface so the @launchstack/features/marketing-pipeline
// barrel is the single import path callers need.
export * from "./types";
