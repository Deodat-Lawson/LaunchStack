import type { MergeFn } from "./contracts";
import type { EmailTemplate, Recipient, RenderedEmail } from "./types";

/**
 * Token substitution and the per-recipient renderer (member.md Phase 3).
 *
 * Pure and deterministic: no LLM, no network, no clock. The same template and
 * recipient always render the same email, which is what makes the dry-run
 * preview trustworthy — what you see is byte-for-byte what would be delivered.
 */

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Replace {{token}} with vars[token]; leave unknown tokens intact (so the guard catches them). */
export function renderTokens(text: string, vars: Record<string, string>): string {
    return (text ?? "").replace(TOKEN_RE, (_m, key: string) =>
        key in vars ? vars[key]! : `{{${key}}}`
    );
}

/** Any {{tokens}} still present after rendering (must be empty before sending). */
export function unresolvedTokens(text: string): string[] {
    return [...(text ?? "").matchAll(TOKEN_RE)].map(m => m[1]!);
}

/* ──────────────────────────────────────────────────────────────
 * Production merge
 * ────────────────────────────────────────────────────────────── */

export interface MergeOptions {
    /**
     * Owner-company values from `company-fields.ts` (value prop, differentiators,
     * CTA link…). Lowest precedence: recipient data always wins over company data.
     */
    companyFields?: Record<string, string>;
    /**
     * Compliance values. HIGHEST precedence — deliberately not overridable by
     * recipient data, so a CSV column named `unsubscribeUrl` can never replace the
     * real unsubscribe link or the sender identity.
     */
    compliance?: { unsubscribeUrl?: string; senderIdentity?: string };
    /**
     * Defaults for personalization tokens the recipient has no value for.
     * Applied below recipient data, so a real name always beats the fallback.
     */
    fallbacks?: Record<string, string>;
}

/** Used when the caller supplies no `fallbacks`. */
export const DEFAULT_FALLBACKS: Readonly<Record<string, string>> = {
    firstName: "there",
    recipientCompany: "your team",
};

/**
 * Values a recipient contributes. Derived fields (`firstName`) sit below the
 * recipient's explicit `vars`, so an author who sets `firstName` in a CSV wins
 * over the name we split out of `name`.
 */
function recipientVars(recipient: Recipient): Record<string, string> {
    const vars: Record<string, string> = {};

    const name = recipient?.name?.trim();
    if (name) {
        vars.name = name;
        const first = name.split(/\s+/)[0];
        if (first) vars.firstName = first;
    }

    const company = recipient?.company?.trim();
    if (company) {
        vars.company = company;
        vars.recipientCompany = company;
    }

    const notes = recipient?.contextNotes?.trim();
    if (notes) vars.contextNotes = notes;

    for (const [k, v] of Object.entries(recipient?.vars ?? {})) {
        const value = typeof v === "string" ? v.trim() : "";
        if (value) vars[k] = value;
    }

    return vars;
}

/**
 * Build the production `MergeFn`.
 *
 * Precedence, lowest to highest:
 *   fallbacks → company fields → recipient (derived, then explicit vars) → compliance
 */
export function createMerge(options: MergeOptions = {}): MergeFn {
    const compliance: Record<string, string> = {};
    if (options.compliance?.unsubscribeUrl) {
        compliance.unsubscribeUrl = options.compliance.unsubscribeUrl;
    }
    if (options.compliance?.senderIdentity) {
        compliance.senderIdentity = options.compliance.senderIdentity;
    }

    return (template: EmailTemplate, recipient: Recipient): RenderedEmail => {
        const vars: Record<string, string> = {
            ...(options.fallbacks ?? DEFAULT_FALLBACKS),
            ...(options.companyFields ?? {}),
            ...recipientVars(recipient),
            ...compliance,
        };

        return {
            subject: renderTokens(template?.subject ?? "", vars),
            body: renderTokens(template?.body ?? "", vars),
        };
    };
}

/** One-shot convenience wrapper around {@link createMerge}. */
export function merge(
    template: EmailTemplate,
    recipient: Recipient,
    options: MergeOptions = {}
): RenderedEmail {
    return createMerge(options)(template, recipient);
}

/**
 * Merge and refuse to return a half-filled email.
 *
 * The send path should prefer this: an email containing a literal
 * `{{firstName}}` is more damaging than one that never went out, so an
 * unresolved token throws rather than degrading.
 */
export function mergeStrict(
    template: EmailTemplate,
    recipient: Recipient,
    options: MergeOptions = {}
): RenderedEmail {
    const rendered = merge(template, recipient, options);
    const leftover = [
        ...new Set([...unresolvedTokens(rendered.subject), ...unresolvedTokens(rendered.body)]),
    ];
    if (leftover.length > 0) {
        throw new Error(
            `[email-pipeline] unresolved merge tokens for ${recipient?.email ?? "unknown recipient"}: ` +
                leftover.map(t => `{{${t}}}`).join(", ")
        );
    }
    return rendered;
}

/**
 * Original default renderer, kept so `send.ts` and any existing caller keep
 * working. New code should use {@link createMerge}, which also resolves company
 * fields and compliance tokens.
 *
 * @deprecated Prefer `createMerge` / `mergeStrict`.
 */
export function simpleMerge(template: EmailTemplate, recipient: Recipient): RenderedEmail {
    return createMerge()(template, recipient);
}
