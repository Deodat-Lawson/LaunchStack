import { z } from "zod";
/** Email outreach pipeline — shared types (zod + inferred). */
/** A person to email. Ingestion/validation is owned by member.md. */
export const RecipientSchema = z.object({
    email: z.string().email(),
    name: z.string().nullable().default(null),
    company: z.string().nullable().default(null),
    contextNotes: z.string().nullable().default(null),
    /** Extra per-recipient merge variables. */
    vars: z.record(z.string()).default({}),
});
/** The LLM-generated template. Body uses {{tokens}}; kept strict for structured output. */
export const EmailTemplateSchema = z.object({
    subject: z.string(),
    body: z.string(),
    variables: z.array(z.string()),
});
export const ReviewCriterionEnum = z.enum([
    "grounding",
    "clarity",
    "tone",
    "spam_risk",
    "cta_strength",
    "compliance",
]);
/** Output of the LLM review call — scores only, never a rewrite. */
export const TemplateReviewSchema = z.object({
    scores: z.array(
        z.object({
            criterion: ReviewCriterionEnum,
            score: z.number().min(0).max(100),
            rationale: z.string(),
        })
    ),
    issues: z.array(z.string()),
    verdict: z.enum(["pass", "revise"]),
    summary: z.string(),
});
export const SendModeEnum = z.enum(["dry_run", "send"]);
/**
 * Campaign lifecycle. Generation and delivery are separate transitions:
 * content is produced in `draft` → `pending_approval`, and only an `approved`
 * campaign can be dispatched.
 */
export const CampaignStatusEnum = z.enum([
    "draft",
    "needs_revision",
    "pending_approval",
    "approved",
    "sending",
    "sent",
    "failed",
]);
/** How a template version came to exist. */
export const TemplateSourceEnum = z.enum(["ai_generated", "human_edited"]);
/**
 * Raised when a lifecycle rule is violated — sending an unapproved campaign,
 * approving a failed review without a reason, editing a frozen list. Carries
 * an HTTP status so routes can map it without re-deriving intent.
 */
export class CampaignLifecycleError extends Error {
    code;
    status;
    constructor(message, code, status = 409) {
        super(message);
        this.code = code;
        this.status = status;
        this.name = "CampaignLifecycleError";
    }
}
/** Statuses that must block any future delivery to the same address. */
export const DELIVERED_OR_IN_FLIGHT = new Set(["sent", "queued"]);
//# sourceMappingURL=types.js.map
