import { z } from "zod";
/**
 * Shared enums for the Campaign Planner evaluation suite (LAU-13 → executable
 * tests). These are the vocabulary both the fixtures (member) and the
 * runner/judge (lead) build against. Frozen as part of the day-1 contract —
 * changing a member here is a breaking change for both sides.
 */
/** Company-knowledge state a fixture simulates (ticket scope). */
export const KnowledgeStateEnum = z.enum(["strong", "sparse", "missing", "contradictory"]);
/** Content category the campaign targets (ticket scope). */
export const ContentCategoryEnum = z.enum([
    "product_launch",
    "thought_leadership",
    "educational",
    "customer_proof",
    "community_discussion",
]);
/** Campaign goal the post is optimized for. */
export const CampaignGoalEnum = z.enum([
    "awareness",
    "engagement",
    "conversion",
    "signups",
    "community",
]);
/**
 * Every measurable criterion from the ticket's "Evaluation criteria" list.
 * Each maps to exactly one scorer (deterministic OR judge — see ScoringMethod).
 */
export const CriterionIdEnum = z.enum([
    "groundedness", // claims trace to source facts
    "unsupported_claims", // no fabricated claims
    "specificity", // company/product-specific, not generic
    "brand_voice", // matches declared voice
    "audience_relevance", // speaks to the target audience
    "goal_alignment", // serves the campaign goal
    "platform_structure", // platform-native format + length
    "hook_strength", // first line stops the scroll
    "cta_quality", // clear, appropriate call to action
    "cliche_generic", // low cliché / generic-language density
    "citation_coverage", // required citations/evidence present
    "variant_quality", // quality across generated variants
    "variant_diversity", // variants are meaningfully distinct
]);
/**
 * How a criterion is measured. Ticket rule: deterministic wherever possible,
 * model-based judges only for subjective criteria.
 */
export const ScoringMethodEnum = z.enum(["deterministic", "judge"]);
/** A fixture's expected terminal state (drives failure/fallback cases). */
export const ExpectedFailureModeEnum = z.enum([
    "none", // should succeed normally
    "graceful_degrade", // should succeed via fallback (e.g. research unavailable)
    "hard_fail", // should error cleanly, not silently produce garbage
]);
//# sourceMappingURL=enums.js.map