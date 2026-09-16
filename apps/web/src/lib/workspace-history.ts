/**
 * The workspace History contract — one shape for "work that has already
 * happened", whatever produced it.
 *
 * Two very different things end up in the same list: **chat sessions**, which
 * a person can reopen and keep typing into, and **pipeline runs**, which a
 * vertical produced in the background and which are read, not resumed. They
 * share this contract so the sidebar can render one reverse-chronological
 * feed instead of one list per feature, and so a new vertical joins the feed
 * by adding a loader — not by touching the UI.
 *
 * Everything here is pure: no React, no database, no `Date.now()` baked in
 * (callers pass `now`). Both the API route and the rail import it, which is
 * what keeps the wire shape from drifting between them.
 */

export const HISTORY_KINDS = [
    "chat",
    "trend-search",
    "prospector",
    "repo-explainer",
    "distribution",
    "email",
    "weekly-review",
] as const;

export type HistoryKind = (typeof HISTORY_KINDS)[number];

export function isHistoryKind(value: string): value is HistoryKind {
    return (HISTORY_KINDS as readonly string[]).includes(value);
}

/**
 * Four states, because that is all a reader needs from a glance at a sidebar.
 * Every vertical's own status vocabulary collapses into these — the run's
 * detail surface is where the specific wording belongs.
 */
export type HistoryStatus = "queued" | "running" | "done" | "failed";

export interface HistoryEntry {
    /** Unique across kinds — `${kind}:${refId}`. Stable, so React keys are too. */
    id: string;
    kind: HistoryKind;
    /** The row's own id in its own table, for that kind's endpoints. */
    refId: string;
    title: string;
    /** One line of context under the title: the question, the repo, the program. */
    subtitle?: string;
    status: HistoryStatus;
    /** ISO 8601. Last meaningful activity — completion when there is one, else creation. */
    at: string;
    /** Where a click goes. Absent when the vertical has no surface to open yet. */
    href?: string;
    /** Chat only: how many turns are stored, shown as a count on the row. */
    messageCount?: number;
}

export interface HistoryKindMeta {
    label: string;
    /** Icon id the rail maps to a lucide component; keeps this module React-free. */
    icon: "chat" | "globe" | "map-pin" | "git-branch" | "share" | "mail" | "calendar";
    /** True when a row of this kind reopens a conversation rather than a report. */
    resumable: boolean;
}

export const HISTORY_KIND_META: Record<HistoryKind, HistoryKindMeta> = {
    chat: { label: "Chat", icon: "chat", resumable: true },
    "trend-search": { label: "Trend search", icon: "globe", resumable: false },
    prospector: { label: "Prospector", icon: "map-pin", resumable: false },
    "repo-explainer": { label: "Repo explainer", icon: "git-branch", resumable: false },
    distribution: { label: "Distribution", icon: "share", resumable: false },
    email: { label: "Email campaign", icon: "mail", resumable: false },
    "weekly-review": { label: "Weekly review", icon: "calendar", resumable: false },
};

/** Token names, not colours: the rail reads `var(--…)` off these. */
export const HISTORY_STATUS_TOKEN: Record<HistoryStatus, string> = {
    queued: "--ink-4",
    running: "--info",
    done: "--ok",
    failed: "--danger",
};

export const HISTORY_STATUS_LABEL: Record<HistoryStatus, string> = {
    queued: "Queued",
    running: "Running",
    done: "Done",
    failed: "Failed",
};

// ---------------------------------------------------------------------------
// Storage bounds
// ---------------------------------------------------------------------------

/**
 * How many turns one write may carry. A send produces two (question and
 * answer); the cap is slack for a client batching a retry, not a budget.
 */
export const MAX_SESSION_APPEND = 8;

/** Hard cap on a stored turn — long enough for any real answer, short of abuse. */
export const MAX_SESSION_MESSAGE_CHARS = 200_000;

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

/** Longest a derived session title may be before it is cut at a word boundary. */
export const SESSION_TITLE_MAX = 72;

/**
 * A chat's title is its opening question, tidied — no model call, because a
 * title that costs a request is a title that sometimes never arrives, and the
 * first thing you asked is what you will scan the list for anyway.
 */
export function deriveSessionTitle(firstMessage: string): string {
    const flat = firstMessage.replace(/\s+/g, " ").trim();
    if (flat.length === 0) return "New chat";
    if (flat.length <= SESSION_TITLE_MAX) return flat;
    const cut = flat.slice(0, SESSION_TITLE_MAX);
    const lastSpace = cut.lastIndexOf(" ");
    // Only break at a word boundary when one is reasonably near the end;
    // otherwise a long unbroken token would be truncated to almost nothing.
    const body = lastSpace > SESSION_TITLE_MAX * 0.6 ? cut.slice(0, lastSpace) : cut;
    return `${body.replace(/[\s,.;:!?-]+$/, "")}…`;
}

// ---------------------------------------------------------------------------
// Grouping and time
// ---------------------------------------------------------------------------

export interface HistoryGroup {
    id: string;
    label: string;
    entries: HistoryEntry[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight local time for a date — the boundary humans mean by "yesterday". */
function startOfDay(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Buckets entries into the date headings a history list is read by, newest
 * first, dropping empty buckets. Entries are sorted here rather than trusted
 * from the server, because the feed is merged from several tables and one
 * slow loader must not be able to scramble the order.
 */
export function groupHistoryByRecency(
    entries: HistoryEntry[],
    now: Date = new Date()
): HistoryGroup[] {
    const today = startOfDay(now);
    const buckets: { id: string; label: string; from: number; entries: HistoryEntry[] }[] = [
        { id: "today", label: "Today", from: today, entries: [] },
        { id: "yesterday", label: "Yesterday", from: today - DAY_MS, entries: [] },
        { id: "week", label: "Previous 7 days", from: today - 7 * DAY_MS, entries: [] },
        { id: "month", label: "Previous 30 days", from: today - 30 * DAY_MS, entries: [] },
        { id: "older", label: "Older", from: Number.NEGATIVE_INFINITY, entries: [] },
    ];

    const sorted = [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    for (const entry of sorted) {
        const at = Date.parse(entry.at);
        // An unparseable or future timestamp belongs at the top, not in "Older":
        // a clock skew of a few seconds is far likelier than a real future run.
        const bucket = Number.isNaN(at)
            ? buckets[0]!
            : (buckets.find(b => at >= b.from) ?? buckets[buckets.length - 1]!);
        bucket.entries.push(entry);
    }

    return buckets
        .filter(b => b.entries.length > 0)
        .map(({ id, label, entries: grouped }) => ({ id, label, entries: grouped }));
}

/**
 * Sidebar-width relative time: `now`, `12m`, `5h`, `3d`, then a date.
 *
 * One compact scale rather than a mix of units and words. "Yesterday" was the
 * obvious alternative for the one-day case, but it is three times the width of
 * everything around it in a 280px rail — and the row already sits under a date
 * heading that says "Yesterday", so it earned nothing for the space.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
    const at = Date.parse(iso);
    if (Number.isNaN(at)) return "";
    const delta = now.getTime() - at;
    if (delta < 60_000) return "now";
    if (delta < 60 * 60_000) return `${Math.floor(delta / 60_000)}m`;

    // Calendar days, not 24-hour blocks: 11pm and 1am are "yesterday" and
    // "today" to a reader, whatever the elapsed hours say.
    const days = Math.round((startOfDay(now) - startOfDay(new Date(at))) / DAY_MS);
    if (days === 0) return `${Math.floor(delta / (60 * 60_000))}h`;
    if (days < 7) return `${days}d`;
    return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/** Case-insensitive match over the three fields a row actually shows. */
export function matchesHistoryQuery(entry: HistoryEntry, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (q === "") return true;
    const hay =
        `${entry.title} ${entry.subtitle ?? ""} ${HISTORY_KIND_META[entry.kind].label}`.toLowerCase();
    return hay.includes(q);
}

export function filterHistory(entries: HistoryEntry[], query: string): HistoryEntry[] {
    return entries.filter(entry => matchesHistoryQuery(entry, query));
}
