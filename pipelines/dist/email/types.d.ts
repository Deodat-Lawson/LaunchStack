import { z } from "zod";
/** Email outreach pipeline — shared types (zod + inferred). */
/** A person to email. Ingestion/validation is owned by member.md. */
export declare const RecipientSchema: z.ZodObject<
    {
        email: z.ZodString;
        name: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        company: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        contextNotes: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        /** Extra per-recipient merge variables. */
        vars: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    },
    "strip",
    z.ZodTypeAny,
    {
        company: string | null;
        name: string | null;
        email: string;
        contextNotes: string | null;
        vars: Record<string, string>;
    },
    {
        email: string;
        company?: string | null | undefined;
        name?: string | null | undefined;
        contextNotes?: string | null | undefined;
        vars?: Record<string, string> | undefined;
    }
>;
export type Recipient = z.infer<typeof RecipientSchema>;
/** The LLM-generated template. Body uses {{tokens}}; kept strict for structured output. */
export declare const EmailTemplateSchema: z.ZodObject<
    {
        subject: z.ZodString;
        body: z.ZodString;
        variables: z.ZodArray<z.ZodString, "many">;
    },
    "strip",
    z.ZodTypeAny,
    {
        subject: string;
        body: string;
        variables: string[];
    },
    {
        subject: string;
        body: string;
        variables: string[];
    }
>;
export type EmailTemplate = z.infer<typeof EmailTemplateSchema>;
export declare const ReviewCriterionEnum: z.ZodEnum<
    ["grounding", "clarity", "tone", "spam_risk", "cta_strength", "compliance"]
>;
export type ReviewCriterion = z.infer<typeof ReviewCriterionEnum>;
/** Output of the LLM review call — scores only, never a rewrite. */
export declare const TemplateReviewSchema: z.ZodObject<
    {
        scores: z.ZodArray<
            z.ZodObject<
                {
                    criterion: z.ZodEnum<
                        ["grounding", "clarity", "tone", "spam_risk", "cta_strength", "compliance"]
                    >;
                    score: z.ZodNumber;
                    rationale: z.ZodString;
                },
                "strip",
                z.ZodTypeAny,
                {
                    rationale: string;
                    criterion:
                        | "compliance"
                        | "grounding"
                        | "clarity"
                        | "tone"
                        | "spam_risk"
                        | "cta_strength";
                    score: number;
                },
                {
                    rationale: string;
                    criterion:
                        | "compliance"
                        | "grounding"
                        | "clarity"
                        | "tone"
                        | "spam_risk"
                        | "cta_strength";
                    score: number;
                }
            >,
            "many"
        >;
        issues: z.ZodArray<z.ZodString, "many">;
        verdict: z.ZodEnum<["pass", "revise"]>;
        summary: z.ZodString;
    },
    "strip",
    z.ZodTypeAny,
    {
        issues: string[];
        summary: string;
        scores: {
            rationale: string;
            criterion:
                | "compliance"
                | "grounding"
                | "clarity"
                | "tone"
                | "spam_risk"
                | "cta_strength";
            score: number;
        }[];
        verdict: "pass" | "revise";
    },
    {
        issues: string[];
        summary: string;
        scores: {
            rationale: string;
            criterion:
                | "compliance"
                | "grounding"
                | "clarity"
                | "tone"
                | "spam_risk"
                | "cta_strength";
            score: number;
        }[];
        verdict: "pass" | "revise";
    }
>;
export type TemplateReview = z.infer<typeof TemplateReviewSchema>;
export declare const SendModeEnum: z.ZodEnum<["dry_run", "send"]>;
export type SendMode = z.infer<typeof SendModeEnum>;
/**
 * Campaign lifecycle. Generation and delivery are separate transitions:
 * content is produced in `draft` → `pending_approval`, and only an `approved`
 * campaign can be dispatched.
 */
export declare const CampaignStatusEnum: z.ZodEnum<
    ["draft", "needs_revision", "pending_approval", "approved", "sending", "sent", "failed"]
>;
export type CampaignStatus = z.infer<typeof CampaignStatusEnum>;
/** How a template version came to exist. */
export declare const TemplateSourceEnum: z.ZodEnum<["ai_generated", "human_edited"]>;
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
    /** Set only for campaigns created by an unattended run. */
    automationKey: string | null;
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
    /** `abandoned` — the process died mid-delivery and recovery reclaimed it. */
    status: "running" | "completed" | "failed" | "abandoned";
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
export declare class CampaignLifecycleError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(message: string, code: string, status?: number);
}
/** A fully-resolved email ready to deliver (output of merge). */
export interface RenderedEmail {
    subject: string;
    body: string;
}
/**
 * `queued` is the in-flight claim: written before the provider call, so a
 * process that dies mid-delivery leaves evidence that the address may already
 * have been emailed. It is never a final state in a completed attempt.
 */
export type SendStatus = "queued" | "dry_run" | "sent" | "failed" | "suppressed" | "skipped";
/** Statuses that must block any future delivery to the same address. */
export declare const DELIVERED_OR_IN_FLIGHT: ReadonlySet<SendStatus>;
export interface SendResult {
    recipientEmail: string;
    status: SendStatus;
    /**
     * The subject this recipient actually received, after merge — not the
     * template's raw `{{token}}` form. Absent for `skipped` / `suppressed`,
     * which are settled before the template is rendered.
     */
    subject?: string;
    providerMessageId?: string;
    error?: string;
}
//# sourceMappingURL=types.d.ts.map
