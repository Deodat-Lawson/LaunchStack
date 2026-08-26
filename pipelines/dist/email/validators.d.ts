import type { EmailTemplate, Recipient, RenderedEmail } from "./types.js";
/**
 * Deterministic validation (member.md Phase 2).
 *
 * Every check here is pure: string, number and set operations only — no LLM,
 * no network. The LLM review in `reviewer.ts` judges taste; this file decides
 * whether an email is *allowed to be sent at all*, so it must be reproducible
 * and free to run on every request.
 *
 * The one impure input, the suppression list, is injected as a plain `Set` by
 * the caller (`db.isSuppressed` feeds it) rather than queried here.
 */
export type Severity = "error" | "warning";
export interface ValidationIssue {
    code: string;
    message: string;
    severity: Severity;
}
export declare function hasErrors(issues: ValidationIssue[]): boolean;
/** Hard ceiling. Above this, clients truncate and spam filters get suspicious. */
export declare const SUBJECT_MAX_CHARS = 120;
/** Soft target — most clients show ~78 characters in the list view. */
export declare const SUBJECT_RECOMMENDED_CHARS = 78;
/** RFC 5321 caps an address at 320 characters; the DB column matches. */
export declare const EMAIL_MAX_CHARS = 320;
export declare function validateEmailAddress(email: string): ValidationIssue[];
export interface RecipientVerdict {
    recipient: Recipient;
    issues: ValidationIssue[];
}
export interface RecipientListResult {
    /** Safe to send to: no error-severity issue. */
    valid: Recipient[];
    /** Blocked, each with the reason(s). Flagged, never silently dropped. */
    rejected: RecipientVerdict[];
    /** Kept, but worth showing the user (e.g. missing personalization data). */
    warnings: RecipientVerdict[];
}
export interface ValidateRecipientsOptions {
    /** Lower-cased suppressed addresses for this company. */
    suppressed?: Set<string>;
    /** Tokens the template needs that must come from the recipient. */
    requiredFields?: string[];
}
/**
 * Validate a recipient list: format, duplicates, suppression, and whether the
 * personalization fields the template needs are actually present.
 *
 * Duplicates are resolved by keeping the first occurrence — the same rule
 * `combineRecipients` uses, so ingestion and validation agree.
 */
export declare function validateRecipients(
    recipients: Recipient[],
    options?: ValidateRecipientsOptions
): RecipientListResult;
/**
 * Value a recipient can supply for a merge token, or null.
 * Kept in sync with the variable map built in `merge.ts`.
 */
export declare function resolveRecipientField(recipient: Recipient, field: string): string | null;
/** Every distinct `{{token}}` used in the subject or body. */
export declare function templateTokens(template: EmailTemplate): string[];
export interface ValidateTemplateOptions {
    /** Token the compliance footer uses. */
    unsubscribeToken?: string;
}
/**
 * Structural checks on the generated template, before any recipient is merged.
 * Compliance lives here because a template missing its unsubscribe token can
 * never produce a compliant email, whatever the recipient data looks like.
 */
export declare function validateTemplate(
    template: EmailTemplate,
    options?: ValidateTemplateOptions
): ValidationIssue[];
export interface ValidateRenderedOptions {
    senderIdentity: string;
    unsubscribeUrl: string;
}
/**
 * The final gate: run on the concrete subject/body a recipient would receive.
 *
 * A half-filled email — `Hi {{firstName}},` — is worse than no email, so an
 * unresolved token is an error, never a warning.
 */
export declare function validateRendered(
    rendered: RenderedEmail,
    options: ValidateRenderedOptions
): ValidationIssue[];
/** Throwing form, for call sites that must not proceed on a bad render. */
export declare function assertSendable(
    rendered: RenderedEmail,
    options: ValidateRenderedOptions
): void;
//# sourceMappingURL=validators.d.ts.map
