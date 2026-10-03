/** Words for the Proposals screens: statuses, deadlines, money. Pure. */
import type { ApplicationStatus, FindingSeverity, FunderStatus, SectionStatus } from "../api";

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

export const FUNDER_STATUS_LABEL: Record<FunderStatus, string> = {
    candidate: "Found",
    saved: "Saved",
    dismissed: "Dismissed",
    applied: "Applying",
};

export const SEVERITY_LABEL: Record<FindingSeverity, string> = {
    blocker: "Blocker",
    warning: "Warning",
    note: "Note",
};

/** "due in 12 days", "due today", "3 days overdue", "no deadline". */
export function deadlineWords(deadline: string | null, daysLeft: number | null): string {
    if (!deadline || daysLeft === null) return "no deadline";
    if (daysLeft < 0) return `${-daysLeft} day${daysLeft === -1 ? "" : "s"} overdue`;
    if (daysLeft === 0) return "due today";
    if (daysLeft === 1) return "due tomorrow";
    return `due in ${daysLeft} days`;
}

/** "closes in 12 days", "closed", "open". */
export function closeWords(closesOn: string | null, daysLeft: number | null): string {
    if (!closesOn || daysLeft === null) return "no close date";
    if (daysLeft < 0) return "closed";
    if (daysLeft === 0) return "closes today";
    return `closes in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
}

export function usd(amount: number | null): string | null {
    if (amount === null) return null;
    if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(amount % 1_000_000 ? 1 : 0)}m`;
    if (amount >= 1_000) return `$${Math.round(amount / 1_000)}k`;
    return `$${amount.toLocaleString()}`;
}

/** "$25k–$150k", "up to $150k", "from $25k". */
export function amountWords(min: number | null, max: number | null): string | null {
    const lo = usd(min);
    const hi = usd(max);
    if (lo && hi) return lo === hi ? lo : `${lo}–${hi}`;
    if (hi) return `up to ${hi}`;
    if (lo) return `from ${lo}`;
    return null;
}

/** A deadline "sooner than a week" is urgent; overdue is a problem. */
export function deadlineTone(daysLeft: number | null): "quiet" | "warn" | "lost" {
    if (daysLeft === null) return "quiet";
    if (daysLeft < 0) return "lost";
    if (daysLeft <= 7) return "warn";
    return "quiet";
}
