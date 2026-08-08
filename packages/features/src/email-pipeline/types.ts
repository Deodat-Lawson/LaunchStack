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
export type CampaignStatus = z.infer<typeof CampaignStatusEnum>;

/** How a template version came to exist. */
export const TemplateSourceEnum = z.enum(["ai_generated", "human_edited"]);
export type TemplateSource = z.infer<typeof TemplateSourceEnum>;

/** An immutable, persisted template. Sending reads one of these — never the LLM. */
export interface TemplateVersion {
  id: number;
  campaignId: number;
  version: number;
  template: EmailTemplate;
  source: TemplateSource;
  goal: string | null;
  model: string | null;
  promptVersion: string | null;
  reviewVerdict: "pass" | "revise" | null;
  review: TemplateReview | null;
  createdAt: Date;
}

/** Campaign header — the lifecycle state, without the version history. */
export interface CampaignRecord {
  id: number;
  companyId: number;
  name: string;
  goal: string | null;
  status: CampaignStatus;
  approvedVersionId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApprovalRecord {
  id: number;
  campaignId: number;
  templateVersionId: number;
  approvedBy: number | null;
  approvedByEmail: string | null;
  approvedByKind: "human" | "automation";
  reviewVerdict: string | null;
  overrideReason: string | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** One `/send` call. The unit of idempotency. */
export interface SendAttemptRecord {
  id: number;
  campaignId: number;
  templateVersionId: number;
  idempotencyKey: string;
  mode: SendMode;
  status: "running" | "completed" | "failed";
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  suppressedCount: number;
  skippedCount: number;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

/**
 * Raised when a lifecycle rule is violated — sending an unapproved campaign,
 * approving a failed review without a reason, editing a frozen list. Carries
 * an HTTP status so routes can map it without re-deriving intent.
 */
export class CampaignLifecycleError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "CampaignLifecycleError";
  }
}

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
