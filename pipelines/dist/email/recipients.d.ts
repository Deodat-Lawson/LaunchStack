import { type Recipient } from "./types.js";
/**
 * Recipient ingestion (member.md Phase 1).
 *
 * Turns the three supported sources — a pasted list, a CSV, and
 * client-prospector results — into a normalized, validated `Recipient[]`.
 *
 * Pure and synchronous: no network, no DB, no LLM. Suppression and
 * cross-campaign checks live in `validators.ts`, which needs I/O.
 *
 * Nothing here invents an address. A row that cannot yield a real email is
 * reported in `skipped` (or `needsEmail`) so a human can fix it — per the
 * "no fabricated recipient facts" rule.
 */
export interface SkippedRow {
    /** 1-based line/row number in the input, for pointing a user at it. */
    row: number;
    reason: string;
    raw: string;
}
export interface IngestResult {
    recipients: Recipient[];
    skipped: SkippedRow[];
}
/**
 * Deliberately permissive: this is a *shape* check to catch obvious typos, not
 * an RFC 5322 implementation. `validators.ts` owns the authoritative check and
 * both share this regex so ingestion and validation can never disagree.
 */
export declare const EMAIL_RE: RegExp;
export declare function looksLikeEmail(value: string): boolean;
/** Lowercase + trim. Address comparison is case-insensitive in practice. */
export declare function normalizeEmail(value: string): string;
/**
 * Parse a pasted blob of addresses. Accepts one per line or several separated
 * by commas/semicolons, with or without a display name.
 */
export declare function parsePastedRecipients(text: string): IngestResult;
/**
 * Parse a CSV with a header row. Unmapped columns are preserved as per-recipient
 * merge `vars`, so a template can use `{{industry}}` if the sheet had one.
 */
export declare function parseRecipientCsv(text: string): IngestResult;
/**
 * Structural subset of `ProspectResult` (packages/core/db/schema/client-prospector).
 * Declared structurally so this module does not depend on the prospector package.
 */
export interface ProspectLike {
    name: string;
    address?: string;
    website?: string;
    phone?: string;
    categories?: string[];
    rationale?: string;
}
export interface ProspectIngestResult extends IngestResult {
    /**
     * Prospects with no known address. `ProspectResult` carries name, website and
     * phone but NO email, so a prospector run alone can never produce a sendable
     * recipient. These are surfaced — with their context preserved — for a human
     * to complete rather than guessed at (`info@`, `contact@`, …), which would be
     * both a fabricated fact and a deliverability risk.
     */
    needsEmail: Array<{
        prospect: ProspectLike;
        contextNotes: string;
    }>;
}
/** One line of grounded context per prospect, used to personalize the email. */
export declare function prospectContextNotes(p: ProspectLike): string;
/**
 * Convert prospector results into recipients.
 *
 * `emailByName` supplies addresses a human has already researched, keyed by the
 * prospect's name. Anything absent from it lands in `needsEmail`.
 */
export declare function recipientsFromProspects(
    prospects: ProspectLike[],
    emailByName?: Record<string, string>
): ProspectIngestResult;
/**
 * Merge several ingest results, de-duplicating by address. The first occurrence
 * wins, and later duplicates are reported rather than silently dropped — a
 * duplicate usually means someone pasted a list twice.
 */
export declare function combineRecipients(...results: IngestResult[]): IngestResult;
//# sourceMappingURL=recipients.d.ts.map
