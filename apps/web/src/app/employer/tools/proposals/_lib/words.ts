/**
 * Words for the Proposals screens: tones, deadlines, money. Pure: the words
 * come from `proposals.words` through the `t` the caller passes, and status
 * labels are `proposals.<map>.<status>` messages read where they render.
 */
import type { useTranslations } from "next-intl";

import type { ApplicationStatus, SectionStatus } from "../api";

export type Tone = "quiet" | "info" | "active" | "won" | "lost" | "warn";

export const APPLICATION_TONE: Record<ApplicationStatus, Tone> = {
    draft: "quiet",
    in_progress: "active",
    in_review: "info",
    ready: "won",
    submitted: "info",
    awarded: "won",
    declined: "lost",
    withdrawn: "quiet",
};

export const SECTION_TONE: Record<SectionStatus, Tone> = {
    empty: "quiet",
    drafted: "active",
    edited: "info",
    approved: "won",
};

export type WordsT = ReturnType<typeof useTranslations<"proposals.words">>;

/** "due in 12 days", "due today", "3 days overdue", "no deadline". */
export function deadlineWords(t: WordsT, deadline: string | null, daysLeft: number | null): string {
    if (!deadline || daysLeft === null) return t("noDeadline");
    if (daysLeft < 0) return t("overdue", { days: -daysLeft });
    if (daysLeft === 0) return t("dueToday");
    if (daysLeft === 1) return t("dueTomorrow");
    return t("dueIn", { days: daysLeft });
}

/** "closes in 12 days", "closed", "open". */
export function closeWords(t: WordsT, closesOn: string | null, daysLeft: number | null): string {
    if (!closesOn || daysLeft === null) return t("noCloseDate");
    if (daysLeft < 0) return t("closed");
    if (daysLeft === 0) return t("closesToday");
    return t("closesIn", { days: daysLeft });
}

export function usd(amount: number | null): string | null {
    if (amount === null) return null;
    if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(amount % 1_000_000 ? 1 : 0)}m`;
    if (amount >= 1_000) return `$${Math.round(amount / 1_000)}k`;
    return `$${amount.toLocaleString()}`;
}

/** "$25k–$150k", "up to $150k", "from $25k". */
export function amountWords(t: WordsT, min: number | null, max: number | null): string | null {
    const lo = usd(min);
    const hi = usd(max);
    if (lo && hi) return lo === hi ? lo : `${lo}–${hi}`;
    if (hi) return t("upTo", { amount: hi });
    if (lo) return t("from", { amount: lo });
    return null;
}

/** A deadline "sooner than a week" is urgent; overdue is a problem. */
export function deadlineTone(daysLeft: number | null): "quiet" | "warn" | "lost" {
    if (daysLeft === null) return "quiet";
    if (daysLeft < 0) return "lost";
    if (daysLeft <= 7) return "warn";
    return "quiet";
}
