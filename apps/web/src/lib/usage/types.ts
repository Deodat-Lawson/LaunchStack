/**
 * The Usage tab's data, as `/api/usage/*` returns it. Plain types shared by
 * the routes (`~/server/usage`) and the tab (`_workspace/usage`), so the two
 * can't disagree about what a number means.
 *
 * What is counted, per person and UTC day:
 *
 * - **questions** — turns a person sent in Ask chats they own.
 * - **filesAdded** — documents they added (`workspace_activity`, verb `added`).
 * - **docsOpened** — documents they opened (`document_views`).
 * - **AI** — model calls made for them, with the provider's own token counts
 *   (`ai_usage_daily`). Work no one person started (a sync, a scheduled job)
 *   and calls from before per-person counting are **unattributed**.
 *
 * A person is **active** on a day when any of those is above zero.
 * Cost is an estimate: the price each model declared, plus the workspace's
 * own per-million price (`usage.pricePerMillionTokens`) for calls whose model
 * declared none; null when nothing in the window is priced.
 */

export interface UsageWindow {
    /** First day, ISO `YYYY-MM-DD` (UTC). */
    from: string;
    /** Last day, inclusive. */
    to: string;
    days: number;
    /** The window of the same length just before this one, for the change on each tile. */
    previousFrom: string;
    previousTo: string;
}

export interface UsageCounts {
    questions: number;
    filesAdded: number;
    docsOpened: number;
    aiCalls: number;
    /** Input + output. */
    aiTokens: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
    costUsd: number | null;
}

export interface UsageTotals extends UsageCounts {
    /** Distinct people active at least once in the window. */
    activePeople: number;
    /** Distinct days with any activity in the window. */
    activeDays: number;
}

/** One calendar day. Every day of the window has a row, zero-filled. */
export interface UsageDay extends UsageCounts {
    date: string;
    activePeople: number;
    /** AI tokens by feature (`AiFeature` ids). */
    features: Record<string, number>;
}

export interface UsageFeatureRow {
    /** An `AiFeature` id. */
    feature: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
    costUsd: number | null;
    /** Distinct people it was used for. */
    people: number;
}

export interface UsageRouteRow {
    /** An `AiUsageRoute` id. */
    route: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
}

export type UsageScope =
    | { kind: "workspace" }
    | { kind: "person"; memberId: number; displayName: string }
    | { kind: "group"; groupId: number; name: string };

/** `GET /api/usage/summary` (and `summary` inside `/api/usage/me`). */
export interface UsageSummary {
    window: UsageWindow;
    scope: UsageScope;
    totals: UsageTotals;
    previous: UsageTotals;
    daily: UsageDay[];
    /** Most AI tokens first. */
    byFeature: UsageFeatureRow[];
    /** Most AI tokens first. */
    byRoute: UsageRouteRow[];
    /** AI tokens in the window no one person started. Workspace scope only; 0 otherwise. */
    unattributedTokens: number;
    /** Calls that went to a model endpoint the workspace brought (it pays for those itself). */
    workspaceOwnedCalls: number;
    /** Current members in scope (pending invitations excluded). */
    members: number;
}

export interface UsageAllowance {
    /** Tokens this person used in this workspace this calendar month (UTC). */
    used: number;
    /** The limit that binds them, or null for none. */
    limit: number | null;
    /** Share of `limit` used, 0–100 (may pass 100), or null. */
    percent: number | null;
    blocked: boolean;
    resetsAt: string;
}

export interface UsagePersonRow {
    /** Workspace member id: the same id the Team tab's `/people/<id>` uses. */
    memberId: number;
    authUserId: string;
    displayName: string;
    email: string;
    avatarUrl: string | null;
    /** Role slug (`owner`, `admin`, … or a custom role's), for the translated label. */
    role: string;
    /** The role's display name as stored (a custom role's own name). */
    roleName: string;
    status: "active" | "suspended";
    isSelf: boolean;
    groups: { id: number; name: string }[];
    totals: UsageCounts;
    activeDays: number;
    /** The latest of their last sign-in activity and anything counted here; null for never. */
    lastActiveAt: string | null;
    /** The feature that used the most AI tokens for them in the window, or null. */
    topFeature: string | null;
    allowance: UsageAllowance;
}

/** `GET /api/usage/people`. */
export interface UsagePeople {
    window: UsageWindow;
    /** Most AI tokens first, then most questions, then name. */
    people: UsagePersonRow[];
    /** People who used the workspace in the window and are no longer members, as one row. */
    formerMembers: UsageCounts | null;
    /** AI work no one person started in the window. */
    unattributed: UsageCounts | null;
    /** The workspace's groups, for the filter. */
    groups: { id: number; name: string }[];
}

export interface UsageActivityRow {
    date: string;
    /** Null for unattributed work and for people who have left. */
    memberId: number | null;
    /** Null for unattributed work; `former` for someone who has left. */
    person: { displayName: string; avatarUrl: string | null } | "former" | null;
    feature: string;
    route: string;
    /** `workspace` when the call went to the workspace's own endpoint. */
    owner: "deployment" | "workspace";
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
    costUsd: number | null;
}

/** `GET /api/usage/activity`: AI use by day, person, feature and route. Newest first. */
export interface UsageActivity {
    window: UsageWindow;
    rows: UsageActivityRow[];
    /** Rows matching the filters, across every page. */
    total: number;
    offset: number;
    limit: number;
}

export interface UsageDocumentRow {
    id: number;
    title: string;
    category: string;
    /** Opens in the window. */
    views: number;
    /** Distinct people who opened it in the window. */
    viewers: number;
    lastViewedAt: string | null;
    createdAt: string;
}

/** `GET /api/usage/documents`: only documents the viewer may read. */
export interface UsageDocuments {
    window: UsageWindow;
    /** Most opened first; documents nobody opened in the window last. */
    documents: UsageDocumentRow[];
    totalDocuments: number;
    totalViews: number;
    /** Opens per day, zero-filled. */
    trend: { date: string; views: number }[];
}

/** The workspace median of each per-person figure, over every current member. */
export interface UsageMedian {
    questions: number;
    filesAdded: number;
    docsOpened: number;
    aiTokens: number;
    activeDays: number;
}

/** `GET /api/usage/me`: the caller's own numbers. Any member may read their own. */
export interface UsageMe {
    summary: UsageSummary;
    median: UsageMedian;
    /** Current members the median is taken over. */
    members: number;
    streak: {
        /** Consecutive active days ending today (or yesterday, when today has nothing yet). */
        current: number;
        /** Longest run of consecutive active days inside the window. */
        longest: number;
    };
}
