import { z } from "zod";
/**
 * Shared enums for the Campaign Planner evaluation suite (LAU-13 → executable
 * tests). These are the vocabulary both the fixtures (member) and the
 * runner/judge (lead) build against. Frozen as part of the day-1 contract —
 * changing a member here is a breaking change for both sides.
 */
/** Company-knowledge state a fixture simulates (ticket scope). */
export declare const KnowledgeStateEnum: z.ZodEnum<["strong", "sparse", "missing", "contradictory"]>;
export type KnowledgeState = z.infer<typeof KnowledgeStateEnum>;
/** Content category the campaign targets (ticket scope). */
export declare const ContentCategoryEnum: z.ZodEnum<["product_launch", "thought_leadership", "educational", "customer_proof", "community_discussion"]>;
export type ContentCategory = z.infer<typeof ContentCategoryEnum>;
/** Campaign goal the post is optimized for. */
export declare const CampaignGoalEnum: z.ZodEnum<["awareness", "engagement", "conversion", "signups", "community"]>;
export type CampaignGoal = z.infer<typeof CampaignGoalEnum>;
/**
 * Every measurable criterion from the ticket's "Evaluation criteria" list.
 * Each maps to exactly one scorer (deterministic OR judge — see ScoringMethod).
 */
export declare const CriterionIdEnum: z.ZodEnum<["groundedness", "unsupported_claims", "specificity", "brand_voice", "audience_relevance", "goal_alignment", "platform_structure", "hook_strength", "cta_quality", "cliche_generic", "citation_coverage", "variant_quality", "variant_diversity"]>;
export type CriterionId = z.infer<typeof CriterionIdEnum>;
/**
 * How a criterion is measured. Ticket rule: deterministic wherever possible,
 * model-based judges only for subjective criteria.
 */
export declare const ScoringMethodEnum: z.ZodEnum<["deterministic", "judge"]>;
export type ScoringMethod = z.infer<typeof ScoringMethodEnum>;
/** A fixture's expected terminal state (drives failure/fallback cases). */
export declare const ExpectedFailureModeEnum: z.ZodEnum<["none", "graceful_degrade", "hard_fail"]>;
export type ExpectedFailureMode = z.infer<typeof ExpectedFailureModeEnum>;
//# sourceMappingURL=enums.d.ts.map