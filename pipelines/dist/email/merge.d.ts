import type { MergeFn } from "./contracts.js";
import type { EmailTemplate, Recipient, RenderedEmail } from "./types.js";
/** Replace {{token}} with vars[token]; leave unknown tokens intact (so the guard catches them). */
export declare function renderTokens(text: string, vars: Record<string, string>): string;
/** Any {{tokens}} still present after rendering (must be empty before sending). */
export declare function unresolvedTokens(text: string): string[];
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
    compliance?: {
        unsubscribeUrl?: string;
        senderIdentity?: string;
    };
    /**
     * Defaults for personalization tokens the recipient has no value for.
     * Applied below recipient data, so a real name always beats the fallback.
     */
    fallbacks?: Record<string, string>;
}
/** Used when the caller supplies no `fallbacks`. */
export declare const DEFAULT_FALLBACKS: Readonly<Record<string, string>>;
/**
 * Build the production `MergeFn`.
 *
 * Precedence, lowest to highest:
 *   fallbacks → company fields → recipient (derived, then explicit vars) → compliance
 */
export declare function createMerge(options?: MergeOptions): MergeFn;
/** One-shot convenience wrapper around {@link createMerge}. */
export declare function merge(
    template: EmailTemplate,
    recipient: Recipient,
    options?: MergeOptions
): RenderedEmail;
/**
 * Merge and refuse to return a half-filled email.
 *
 * The send path should prefer this: an email containing a literal
 * `{{firstName}}` is more damaging than one that never went out, so an
 * unresolved token throws rather than degrading.
 */
export declare function mergeStrict(
    template: EmailTemplate,
    recipient: Recipient,
    options?: MergeOptions
): RenderedEmail;
/**
 * Original default renderer, kept so `send.ts` and any existing caller keep
 * working. New code should use {@link createMerge}, which also resolves company
 * fields and compliance tokens.
 *
 * @deprecated Prefer `createMerge` / `mergeStrict`.
 */
export declare function simpleMerge(template: EmailTemplate, recipient: Recipient): RenderedEmail;
//# sourceMappingURL=merge.d.ts.map
