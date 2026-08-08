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
export type Recipient = z.infer<typeof RecipientSchema>;

/** The LLM-generated template. Body uses {{tokens}}; kept strict for structured output. */
export const EmailTemplateSchema = z.object({
  subject: z.string(),
  body: z.string(),
  variables: z.array(z.string()),
});
export type EmailTemplate = z.infer<typeof EmailTemplateSchema>;

export const ReviewCriterionEnum = z.enum([
  "grounding",
  "clarity",
  "tone",
  "spam_risk",
  "cta_strength",
  "compliance",
]);
export type ReviewCriterion = z.infer<typeof ReviewCriterionEnum>;

/** Output of the LLM review call — scores only, never a rewrite. */
export const TemplateReviewSchema = z.object({
  scores: z.array(
    z.object({
      criterion: ReviewCriterionEnum,
      score: z.number().min(0).max(100),
      rationale: z.string(),
    }),
  ),
  issues: z.array(z.string()),
  verdict: z.enum(["pass", "revise"]),
  summary: z.string(),
});
export type TemplateReview = z.infer<typeof TemplateReviewSchema>;

export const SendModeEnum = z.enum(["dry_run", "send"]);
export type SendMode = z.infer<typeof SendModeEnum>;

/** A fully-resolved email ready to deliver (output of merge). */
export interface RenderedEmail {
  subject: string;
  body: string;
}

export type SendStatus =
  | "dry_run"
  | "sent"
  | "failed"
  | "suppressed"
  | "skipped";

export interface SendResult {
  recipientEmail: string;
  status: SendStatus;
  providerMessageId?: string;
  error?: string;
}
