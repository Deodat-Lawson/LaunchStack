import { unresolvedTokens } from "./merge";
import { EMAIL_RE, normalizeEmail } from "./recipients";
import type { EmailTemplate, Recipient, RenderedEmail } from "./types";

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

const err = (code: string, message: string): ValidationIssue => ({
    code,
    message,
    severity: "error",
});
const warn = (code: string, message: string): ValidationIssue => ({
    code,
    message,
    severity: "warning",
});

export function hasErrors(issues: ValidationIssue[]): boolean {
    return issues.some(i => i.severity === "error");
}

/* ──────────────────────────────────────────────────────────────
 * Limits
 * ────────────────────────────────────────────────────────────── */

/** Hard ceiling. Above this, clients truncate and spam filters get suspicious. */
export const SUBJECT_MAX_CHARS = 120;
/** Soft target — most clients show ~78 characters in the list view. */
export const SUBJECT_RECOMMENDED_CHARS = 78;
/** RFC 5321 caps an address at 320 characters; the DB column matches. */
export const EMAIL_MAX_CHARS = 320;

/* ──────────────────────────────────────────────────────────────
 * Address-level checks
 * ────────────────────────────────────────────────────────────── */

/**
 * A CR or LF inside an address or subject lets an attacker inject extra SMTP
 * headers (BCC, Reply-To). Checked separately from format so the failure is
 * named for what it is.
 */
const CRLF_RE = /[\r\n]/;

export function validateEmailAddress(email: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const raw = email ?? "";

    if (!raw.trim()) {
        issues.push(err("email_empty", "Address is empty."));
        return issues;
    }
    if (CRLF_RE.test(raw)) {
        issues.push(err("email_crlf", "Address contains a line break (header-injection risk)."));
    }
    if (raw.length > EMAIL_MAX_CHARS) {
        issues.push(err("email_too_long", `Address exceeds ${EMAIL_MAX_CHARS} characters.`));
    }
    if (!EMAIL_RE.test(raw.trim())) {
        issues.push(err("email_format", `"${raw.trim()}" is not a valid address.`));
    }
    return issues;
}

/* ──────────────────────────────────────────────────────────────
 * Recipient list
 * ────────────────────────────────────────────────────────────── */

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
export function validateRecipients(
    recipients: Recipient[],
    options: ValidateRecipientsOptions = {}
): RecipientListResult {
    const suppressed = options.suppressed ?? new Set<string>();
    const required = options.requiredFields ?? [];

    const valid: Recipient[] = [];
    const rejected: RecipientVerdict[] = [];
    const warnings: RecipientVerdict[] = [];
    const seen = new Set<string>();

    for (const recipient of recipients) {
        const issues = validateEmailAddress(recipient.email);
        const key = normalizeEmail(recipient.email);

        if (seen.has(key)) {
            issues.push(err("duplicate", `"${key}" appears more than once.`));
        }
        if (suppressed.has(key)) {
            issues.push(
                err("suppressed", `"${key}" is on the suppression list (unsubscribed or bounced).`)
            );
        }

        for (const field of required) {
            if (!resolveRecipientField(recipient, field)) {
                issues.push(
                    warn(
                        "missing_field",
                        `No value for "${field}"; the template will fall back to a default.`
                    )
                );
            }
        }

        if (hasErrors(issues)) {
            rejected.push({ recipient, issues });
            continue;
        }

        seen.add(key);
        valid.push(recipient);
        if (issues.length > 0) warnings.push({ recipient, issues });
    }

    return { valid, rejected, warnings };
}

/**
 * Value a recipient can supply for a merge token, or null.
 * Kept in sync with the variable map built in `merge.ts`.
 */
export function resolveRecipientField(recipient: Recipient, field: string): string | null {
    // Note: an empty/whitespace value must collapse to null, so `??` would be
    // wrong here — it only replaces null/undefined and would let "" through.
    const nonEmpty = (value: string | null | undefined): string | null => {
        const trimmed = value?.trim();
        if (!trimmed) return null;
        return trimmed;
    };

    switch (field) {
        case "firstName":
            return nonEmpty(recipient.name?.trim().split(/\s+/)[0]);
        case "name":
            return nonEmpty(recipient.name);
        case "recipientCompany":
        case "company":
            return nonEmpty(recipient.company);
        case "contextNotes":
            return nonEmpty(recipient.contextNotes);
        default:
            return nonEmpty(recipient.vars?.[field]);
    }
}

/* ──────────────────────────────────────────────────────────────
 * Template-level checks
 * ────────────────────────────────────────────────────────────── */

/** Every distinct `{{token}}` used in the subject or body. */
export function templateTokens(template: EmailTemplate): string[] {
    return [
        ...new Set([
            ...unresolvedTokens(template.subject ?? ""),
            ...unresolvedTokens(template.body ?? ""),
        ]),
    ];
}

export interface ValidateTemplateOptions {
    /** Token the compliance footer uses. */
    unsubscribeToken?: string;
}

/**
 * Structural checks on the generated template, before any recipient is merged.
 * Compliance lives here because a template missing its unsubscribe token can
 * never produce a compliant email, whatever the recipient data looks like.
 */
export function validateTemplate(
    template: EmailTemplate,
    options: ValidateTemplateOptions = {}
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const unsubscribeToken = options.unsubscribeToken ?? "unsubscribeUrl";
    const subject = template?.subject ?? "";
    const body = template?.body ?? "";

    if (!subject.trim()) {
        issues.push(err("subject_empty", "Subject is empty."));
    }
    if (CRLF_RE.test(subject)) {
        issues.push(err("subject_crlf", "Subject contains a line break (header-injection risk)."));
    }
    if (subject.length > SUBJECT_MAX_CHARS) {
        issues.push(
            err(
                "subject_too_long",
                `Subject is ${subject.length} characters; the limit is ${SUBJECT_MAX_CHARS}.`
            )
        );
    } else if (subject.length > SUBJECT_RECOMMENDED_CHARS) {
        issues.push(
            warn(
                "subject_long",
                `Subject is ${subject.length} characters; most clients truncate around ${SUBJECT_RECOMMENDED_CHARS}.`
            )
        );
    }

    if (!body.trim()) {
        issues.push(err("body_empty", "Body is empty."));
    }
    if (!templateTokens(template).includes(unsubscribeToken)) {
        issues.push(
            err(
                "missing_unsubscribe_token",
                `Body must include {{${unsubscribeToken}}} so every email carries an unsubscribe link.`
            )
        );
    }

    // `variables` is what the generator claims it used; a mismatch means the
    // declared contract and the actual body have drifted apart.
    const declared = new Set(template?.variables ?? []);
    for (const token of templateTokens(template)) {
        if (!declared.has(token)) {
            issues.push(
                warn(
                    "undeclared_variable",
                    `{{${token}}} is used but not listed in template.variables.`
                )
            );
        }
    }

    return issues;
}

/* ──────────────────────────────────────────────────────────────
 * Post-merge checks — the last gate before delivery
 * ────────────────────────────────────────────────────────────── */

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
export function validateRendered(
    rendered: RenderedEmail,
    options: ValidateRenderedOptions
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const subject = rendered?.subject ?? "";
    const body = rendered?.body ?? "";

    const leftover = [...new Set([...unresolvedTokens(subject), ...unresolvedTokens(body)])];
    if (leftover.length > 0) {
        issues.push(
            err(
                "unresolved_tokens",
                `Unresolved merge tokens: ${leftover.map(t => `{{${t}}}`).join(", ")}.`
            )
        );
    }

    if (!subject.trim()) issues.push(err("subject_empty", "Rendered subject is empty."));
    if (CRLF_RE.test(subject)) {
        issues.push(err("subject_crlf", "Rendered subject contains a line break."));
    }
    if (!body.trim()) issues.push(err("body_empty", "Rendered body is empty."));

    if (options.unsubscribeUrl && !body.includes(options.unsubscribeUrl)) {
        issues.push(err("missing_unsubscribe", "Rendered body has no unsubscribe link."));
    }
    if (options.senderIdentity && !body.includes(options.senderIdentity)) {
        issues.push(
            err(
                "missing_sender_identity",
                "Rendered body is missing the sender identity required by CAN-SPAM."
            )
        );
    }

    return issues;
}

/** Throwing form, for call sites that must not proceed on a bad render. */
export function assertSendable(rendered: RenderedEmail, options: ValidateRenderedOptions): void {
    const issues = validateRendered(rendered, options).filter(i => i.severity === "error");
    if (issues.length > 0) {
        throw new Error(
            `[email-pipeline] refusing to send: ${issues.map(i => i.message).join(" ")}`
        );
    }
}
