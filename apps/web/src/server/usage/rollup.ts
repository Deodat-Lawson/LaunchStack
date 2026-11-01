/**
 * The Usage tab's arithmetic: raw per-person, per-day rows (./queries) folded
 * into the shapes `/api/usage/*` returns (`~/lib/usage/types`). Pure — no
 * database, no clock — so every number on the tab can be pinned in a test.
 *
 * Three rules hold everywhere here:
 *
 * - **People add up.** Every row belongs to exactly one of: a current member,
 *   someone who has left (`formerMembers`), or no one (`unattributed`, the
 *   meter's empty `user_id`). The workspace's totals are the sum of those
 *   three, cost included, because cost is linear in its rows (see
 *   `estimatedCostUsd`).
 * - **Active means did something.** A person is active on a day when they
 *   asked, added, opened or had AI work done for them. Unattributed work makes
 *   no one active, and a day is an active day only when someone was.
 * - **Every day of a window is there**, zero-filled, so a chart never has to
 *   guess at a gap.
 */

import type { AiAllowance } from "~/server/ai-usage/quota";
import type { MemberView } from "~/server/workspace/members";
import { isoDay, windowDays } from "~/lib/usage/range";
import type {
    UsageActivity,
    UsageActivityRow,
    UsageAllowance,
    UsageCounts,
    UsageDay,
    UsageDocumentRow,
    UsageDocuments,
    UsageFeatureRow,
    UsageMedian,
    UsagePeople,
    UsagePersonRow,
    UsageRouteRow,
    UsageScope,
    UsageSummary,
    UsageTotals,
    UsageWindow,
} from "~/lib/usage/types";
import { estimatedCostUsd, unpricedTokensOf } from "~/server/settings/usage";

// ── Raw rows (what ./queries returns) ───────────────────────────────

/** Inclusive ISO days. */
export interface UsageRange {
    from: string;
    to: string;
}

/** One `ai_usage_daily` row, model id left out. */
export interface AiUsageRow {
    date: string;
    /** Auth user id; empty when no one person started the work. */
    userId: string;
    feature: string;
    /** Empty when the transport could not tell; read as `default`. */
    route: string;
    owner: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
    pricedCalls: number;
    /** The priced calls' cost only. */
    costUsd: number;
    /** ISO timestamp of the row's latest call. */
    lastAt: string | null;
}

/** How many of one thing a person did on one UTC day. */
export interface PersonDayCount {
    date: string;
    userId: string;
    count: number;
    /** ISO timestamp of the latest one. */
    lastAt: string | null;
}

export interface UsageRaw {
    ai: AiUsageRow[];
    questions: PersonDayCount[];
    filesAdded: PersonDayCount[];
    docsOpened: PersonDayCount[];
}

/** A current member, as the tab lists them: pending invitations are not members yet. */
export type UsageMember = Pick<
    MemberView,
    | "id"
    | "authUserId"
    | "displayName"
    | "email"
    | "avatarUrl"
    | "role"
    | "roleName"
    | "isSelf"
    | "groups"
    | "lastActiveAt"
> & { status: "active" | "suspended" };

export function currentMembers(members: readonly MemberView[]): UsageMember[] {
    return members.flatMap(member =>
        member.status === "pending" ? [] : [{ ...member, status: member.status }]
    );
}

// ── Tallies ─────────────────────────────────────────────────────────

/** Running sums for one slice; `toCounts` prices it. */
interface Tally {
    questions: number;
    filesAdded: number;
    docsOpened: number;
    aiCalls: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
    pricedCalls: number;
    pricedCostUsd: number;
    unpricedTokens: number;
}

function emptyTally(): Tally {
    return {
        questions: 0,
        filesAdded: 0,
        docsOpened: 0,
        aiCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        pricedCalls: 0,
        pricedCostUsd: 0,
        unpricedTokens: 0,
    };
}

function addTally(into: Tally, from: Tally): void {
    into.questions += from.questions;
    into.filesAdded += from.filesAdded;
    into.docsOpened += from.docsOpened;
    into.aiCalls += from.aiCalls;
    into.inputTokens += from.inputTokens;
    into.outputTokens += from.outputTokens;
    into.cachedInputTokens += from.cachedInputTokens;
    into.reasoningTokens += from.reasoningTokens;
    into.pricedCalls += from.pricedCalls;
    into.pricedCostUsd += from.pricedCostUsd;
    into.unpricedTokens += from.unpricedTokens;
}

function sumTallies(entries: readonly { tally: Tally }[]): Tally {
    const total = emptyTally();
    for (const entry of entries) addTally(total, entry.tally);
    return total;
}

const tokensOf = (tally: Tally) => tally.inputTokens + tally.outputTokens;

const isActive = (tally: Tally) =>
    tally.questions + tally.filesAdded + tally.docsOpened + tally.aiCalls > 0;

/** Whether a slice has anything in it at all, active or not. */
const hasAny = (tally: Tally) => isActive(tally) || tokensOf(tally) > 0;

function costOf(tally: Tally, pricePerMillionTokens: number): number | null {
    return estimatedCostUsd(
        { costUsd: tally.pricedCostUsd, pricedCalls: tally.pricedCalls },
        tally.unpricedTokens,
        pricePerMillionTokens
    );
}

function toCounts(tally: Tally, pricePerMillionTokens: number): UsageCounts {
    return {
        questions: tally.questions,
        filesAdded: tally.filesAdded,
        docsOpened: tally.docsOpened,
        aiCalls: tally.aiCalls,
        aiTokens: tokensOf(tally),
        inputTokens: tally.inputTokens,
        outputTokens: tally.outputTokens,
        cachedInputTokens: tally.cachedInputTokens,
        reasoningTokens: tally.reasoningTokens,
        costUsd: costOf(tally, pricePerMillionTokens),
    };
}

// ── Entries: every raw row, one shape ───────────────────────────────

interface Entry {
    date: string;
    userId: string;
    lastAt: string | null;
    tally: Tally;
    /** Set on AI rows. */
    ai?: { feature: string; route: string; owner: string };
}

/** One meter row's tally. Its unpriced share is taken per row, so tallies add up. */
function aiTally(row: AiUsageRow): Tally {
    return {
        ...emptyTally(),
        aiCalls: row.calls,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cachedInputTokens: row.cachedInputTokens,
        reasoningTokens: row.reasoningTokens,
        pricedCalls: row.pricedCalls,
        pricedCostUsd: row.costUsd,
        unpricedTokens: unpricedTokensOf(row),
    };
}

function entriesOf(raw: UsageRaw): Entry[] {
    const entries: Entry[] = [];
    for (const row of raw.ai) {
        entries.push({
            date: row.date,
            userId: row.userId,
            lastAt: row.lastAt,
            tally: aiTally(row),
            ai: { feature: row.feature, route: row.route || "default", owner: row.owner },
        });
    }
    const counted = [
        ["questions", raw.questions],
        ["filesAdded", raw.filesAdded],
        ["docsOpened", raw.docsOpened],
    ] as const;
    for (const [kind, rows] of counted) {
        for (const row of rows) {
            entries.push({
                date: row.date,
                userId: row.userId,
                lastAt: row.lastAt,
                tally: { ...emptyTally(), [kind]: row.count },
            });
        }
    }
    return entries;
}

const within = (range: UsageRange) => (entry: { date: string }) =>
    entry.date >= range.from && entry.date <= range.to;

/** People active in these entries, and the days anyone was. Unattributed work counts for neither. */
function activity(entries: readonly Entry[]): { people: Set<string>; days: Set<string> } {
    const people = new Set<string>();
    const days = new Set<string>();
    for (const entry of entries) {
        if (entry.userId === "" || !isActive(entry.tally)) continue;
        people.add(entry.userId);
        days.add(entry.date);
    }
    return { people, days };
}

function totalsOf(entries: readonly Entry[], pricePerMillionTokens: number): UsageTotals {
    const { people, days } = activity(entries);
    return {
        ...toCounts(sumTallies(entries), pricePerMillionTokens),
        activePeople: people.size,
        activeDays: days.size,
    };
}

function dailyOf(
    entries: readonly Entry[],
    window: UsageRange,
    pricePerMillionTokens: number
): UsageDay[] {
    const byDay = new Map<string, Entry[]>();
    for (const entry of entries) {
        const list = byDay.get(entry.date) ?? [];
        list.push(entry);
        byDay.set(entry.date, list);
    }
    return windowDays(window).map(date => {
        const list = byDay.get(date) ?? [];
        const features: Record<string, number> = {};
        for (const entry of list) {
            if (!entry.ai) continue;
            features[entry.ai.feature] = (features[entry.ai.feature] ?? 0) + tokensOf(entry.tally);
        }
        return {
            date,
            ...toCounts(sumTallies(list), pricePerMillionTokens),
            activePeople: activity(list).people.size,
            features,
        };
    });
}

/** Biggest first; a stable name order breaks ties. */
function byTokens<T extends { inputTokens: number; outputTokens: number }>(
    name: (row: T) => string
) {
    return (a: T, b: T) =>
        b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens) ||
        name(a).localeCompare(name(b));
}

function featuresOf(entries: readonly Entry[], pricePerMillionTokens: number): UsageFeatureRow[] {
    const byFeature = new Map<string, { tally: Tally; people: Set<string> }>();
    for (const entry of entries) {
        if (!entry.ai) continue;
        const slot = byFeature.get(entry.ai.feature) ?? { tally: emptyTally(), people: new Set() };
        addTally(slot.tally, entry.tally);
        if (entry.userId !== "" && entry.tally.aiCalls > 0) slot.people.add(entry.userId);
        byFeature.set(entry.ai.feature, slot);
    }
    return [...byFeature.entries()]
        .map(([feature, { tally, people }]) => ({
            feature,
            calls: tally.aiCalls,
            inputTokens: tally.inputTokens,
            outputTokens: tally.outputTokens,
            cachedInputTokens: tally.cachedInputTokens,
            reasoningTokens: tally.reasoningTokens,
            costUsd: costOf(tally, pricePerMillionTokens),
            people: people.size,
        }))
        .sort(byTokens(row => row.feature));
}

function routesOf(entries: readonly Entry[], pricePerMillionTokens: number): UsageRouteRow[] {
    const byRoute = new Map<string, Tally>();
    for (const entry of entries) {
        if (!entry.ai) continue;
        const tally = byRoute.get(entry.ai.route) ?? emptyTally();
        addTally(tally, entry.tally);
        byRoute.set(entry.ai.route, tally);
    }
    return [...byRoute.entries()]
        .map(([route, tally]) => ({
            route,
            calls: tally.aiCalls,
            inputTokens: tally.inputTokens,
            outputTokens: tally.outputTokens,
            costUsd: costOf(tally, pricePerMillionTokens),
        }))
        .sort(byTokens(row => row.route));
}

// ── Summary ─────────────────────────────────────────────────────────

export interface SummaryInput {
    window: UsageWindow;
    scope: UsageScope;
    /** Rows covering at least `window.previousFrom` to `window.to`. */
    raw: UsageRaw;
    pricePerMillionTokens: number;
    /**
     * The auth ids the scope covers. Absent for the workspace, which also
     * takes in people who have left and work no one started.
     */
    people?: ReadonlySet<string>;
    /** Current members in scope. */
    members: number;
}

export function summarize(input: SummaryInput): UsageSummary {
    const { window, pricePerMillionTokens: price } = input;
    const people = input.people;
    const entries = people
        ? entriesOf(input.raw).filter(entry => people.has(entry.userId))
        : entriesOf(input.raw);
    const current = entries.filter(within(window));
    const previous = entries.filter(within({ from: window.previousFrom, to: window.previousTo }));

    let unattributedTokens = 0;
    let workspaceOwnedCalls = 0;
    for (const entry of current) {
        if (!entry.ai) continue;
        if (entry.userId === "") unattributedTokens += tokensOf(entry.tally);
        if (entry.ai.owner === "workspace") workspaceOwnedCalls += entry.tally.aiCalls;
    }

    return {
        window,
        scope: input.scope,
        totals: totalsOf(current, price),
        previous: totalsOf(previous, price),
        daily: dailyOf(current, window, price),
        byFeature: featuresOf(current, price),
        byRoute: routesOf(current, price),
        unattributedTokens: people ? 0 : unattributedTokens,
        workspaceOwnedCalls,
        members: input.members,
    };
}

// ── People ──────────────────────────────────────────────────────────

export function toUsageAllowance(allowance: AiAllowance): UsageAllowance {
    return {
        used: allowance.used,
        // The binding limit: the server's cap when that is the one nearest its end.
        limit:
            allowance.binding === "server"
                ? (allowance.server?.limit ?? null)
                : allowance.workspace.limit,
        percent: allowance.percent,
        blocked: allowance.blocked,
        resetsAt: allowance.resetsAt,
    };
}

function latest(...values: (string | null)[]): string | null {
    let best: string | null = null;
    for (const value of values) {
        if (value !== null && (best === null || Date.parse(value) > Date.parse(best))) {
            best = value;
        }
    }
    return best;
}

function topFeatureOf(entries: readonly Entry[]): string | null {
    const tokens = new Map<string, number>();
    for (const entry of entries) {
        if (!entry.ai || entry.tally.aiCalls <= 0) continue;
        tokens.set(entry.ai.feature, (tokens.get(entry.ai.feature) ?? 0) + tokensOf(entry.tally));
    }
    let top: string | null = null;
    let most = -1;
    for (const [feature, count] of [...tokens.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        if (count > most) {
            top = feature;
            most = count;
        }
    }
    return top;
}

export interface PeopleInput {
    window: UsageWindow;
    /** Rows covering at least the window. */
    raw: UsageRaw;
    pricePerMillionTokens: number;
    /** The members to list: every current member, or one group's. */
    members: readonly UsageMember[];
    /** Every current member's auth id: who has not left. */
    currentAuthIds: ReadonlySet<string>;
    /** By auth id; one for every listed member. */
    allowances: ReadonlyMap<string, UsageAllowance>;
    groups: { id: number; name: string }[];
    /** A group's view: only its members, no former or unattributed rows. */
    grouped: boolean;
}

export function peopleOf(input: PeopleInput): UsagePeople {
    const { window, pricePerMillionTokens: price } = input;
    const entries = entriesOf(input.raw).filter(within(window));
    const byPerson = new Map<string, Entry[]>();
    for (const entry of entries) {
        const list = byPerson.get(entry.userId) ?? [];
        list.push(entry);
        byPerson.set(entry.userId, list);
    }

    const people: UsagePersonRow[] = input.members.map(member => {
        const mine = byPerson.get(member.authUserId) ?? [];
        const active = mine.filter(entry => isActive(entry.tally));
        return {
            memberId: member.id,
            authUserId: member.authUserId,
            displayName: member.displayName,
            email: member.email,
            avatarUrl: member.avatarUrl,
            role: member.role,
            roleName: member.roleName,
            status: member.status,
            isSelf: member.isSelf,
            groups: member.groups,
            totals: toCounts(sumTallies(mine), price),
            activeDays: new Set(active.map(entry => entry.date)).size,
            lastActiveAt: latest(member.lastActiveAt, ...active.map(entry => entry.lastAt)),
            topFeature: topFeatureOf(mine),
            allowance: input.allowances.get(member.authUserId)!,
        };
    });
    people.sort(
        (a, b) =>
            b.totals.aiTokens - a.totals.aiTokens ||
            b.totals.questions - a.totals.questions ||
            a.displayName.localeCompare(b.displayName)
    );

    let formerMembers: UsageCounts | null = null;
    let unattributed: UsageCounts | null = null;
    if (!input.grouped) {
        const former = sumTallies(
            entries.filter(entry => entry.userId !== "" && !input.currentAuthIds.has(entry.userId))
        );
        const nobody = sumTallies(entries.filter(entry => entry.userId === ""));
        formerMembers = hasAny(former) ? toCounts(former, price) : null;
        unattributed = hasAny(nobody) ? toCounts(nobody, price) : null;
    }

    return { window, people, formerMembers, unattributed, groups: input.groups };
}

// ── Activity ────────────────────────────────────────────────────────

export interface ActivityInput {
    window: UsageWindow;
    /** AI rows for the window, already narrowed to the filters. */
    rows: readonly AiUsageRow[];
    /** Current members, to name each row's person. */
    members: readonly UsageMember[];
    pricePerMillionTokens: number;
    offset: number;
    limit: number;
}

/** What one activity row is grouped by: everything but the model. */
interface ActivityKey {
    date: string;
    userId: string;
    feature: string;
    route: string;
    owner: UsageActivityRow["owner"];
}

export function activityOf(input: ActivityInput): UsageActivity {
    const { window, pricePerMillionTokens: price } = input;
    const members = new Map(input.members.map(member => [member.authUserId, member]));
    const groups = new Map<string, { key: ActivityKey; tally: Tally }>();
    for (const row of input.rows) {
        if (row.date < window.from || row.date > window.to) continue;
        const key: ActivityKey = {
            date: row.date,
            userId: row.userId,
            feature: row.feature,
            route: row.route || "default",
            owner: row.owner === "workspace" ? "workspace" : "deployment",
        };
        const id = [key.date, key.userId, key.feature, key.route, key.owner].join("\u0000");
        const slot = groups.get(id) ?? { key, tally: emptyTally() };
        addTally(slot.tally, aiTally(row));
        groups.set(id, slot);
    }

    const sorted = [...groups.values()].sort(
        (a, b) =>
            b.key.date.localeCompare(a.key.date) ||
            tokensOf(b.tally) - tokensOf(a.tally) ||
            b.tally.aiCalls - a.tally.aiCalls ||
            a.key.feature.localeCompare(b.key.feature) ||
            a.key.route.localeCompare(b.key.route) ||
            a.key.owner.localeCompare(b.key.owner) ||
            a.key.userId.localeCompare(b.key.userId)
    );

    const rows: UsageActivityRow[] = sorted
        .slice(input.offset, input.offset + input.limit)
        .map(({ key, tally }) => {
            const member = key.userId === "" ? undefined : members.get(key.userId);
            return {
                date: key.date,
                memberId: member?.id ?? null,
                person:
                    key.userId === ""
                        ? null
                        : member
                          ? { displayName: member.displayName, avatarUrl: member.avatarUrl }
                          : "former",
                feature: key.feature,
                route: key.route,
                owner: key.owner,
                calls: tally.aiCalls,
                inputTokens: tally.inputTokens,
                outputTokens: tally.outputTokens,
                cachedInputTokens: tally.cachedInputTokens,
                reasoningTokens: tally.reasoningTokens,
                costUsd: costOf(tally, price),
            };
        });

    return { window, rows, total: sorted.length, offset: input.offset, limit: input.limit };
}

// ── Documents ───────────────────────────────────────────────────────

export interface DocumentsInput {
    window: UsageWindow;
    /** Already ordered and capped by the query. */
    documents: UsageDocumentRow[];
    totalDocuments: number;
    /** Opens per day of documents in scope; days without any may be missing. */
    trend: { date: string; views: number }[];
}

export function documentsOf(input: DocumentsInput): UsageDocuments {
    const byDay = new Map<string, number>();
    for (const point of input.trend) {
        byDay.set(point.date, (byDay.get(point.date) ?? 0) + point.views);
    }
    const trend = windowDays(input.window).map(date => ({ date, views: byDay.get(date) ?? 0 }));
    return {
        window: input.window,
        documents: input.documents,
        totalDocuments: input.totalDocuments,
        totalViews: trend.reduce((sum, point) => sum + point.views, 0),
        trend,
    };
}

// ── Me: median and streak ───────────────────────────────────────────

/** The middle value; the mean of the two middle ones for an even count; 0 for none. */
export function median(values: readonly number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Each current member's figures in the window, then the median of each. */
export function medianOf(input: {
    window: UsageRange;
    raw: UsageRaw;
    authIds: readonly string[];
}): UsageMedian {
    const entries = entriesOf(input.raw).filter(within(input.window));
    const byPerson = new Map<string, Entry[]>();
    for (const entry of entries) {
        const list = byPerson.get(entry.userId) ?? [];
        list.push(entry);
        byPerson.set(entry.userId, list);
    }
    const figures = input.authIds.map(authId => {
        const mine = byPerson.get(authId) ?? [];
        const tally = sumTallies(mine);
        return {
            questions: tally.questions,
            filesAdded: tally.filesAdded,
            docsOpened: tally.docsOpened,
            aiTokens: tokensOf(tally),
            activeDays: activity(mine).days.size,
        };
    });
    return {
        questions: median(figures.map(f => f.questions)),
        filesAdded: median(figures.map(f => f.filesAdded)),
        docsOpened: median(figures.map(f => f.docsOpened)),
        aiTokens: median(figures.map(f => f.aiTokens)),
        activeDays: median(figures.map(f => f.activeDays)),
    };
}

/** The days one person was active, from rows that may cover more people. */
export function activeDaysOf(raw: UsageRaw, authUserId: string): Set<string> {
    return activity(entriesOf(raw).filter(entry => entry.userId === authUserId)).days;
}

function shiftDay(day: string, by: number): string {
    return isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000));
}

/**
 * `current`: consecutive active days ending today, or yesterday while today
 * has nothing yet. `longest`: the longest run inside the window.
 */
export function streakOf(
    activeDays: ReadonlySet<string>,
    window: UsageRange,
    today: string
): { current: number; longest: number } {
    let current = 0;
    let day = activeDays.has(today) ? today : shiftDay(today, -1);
    while (activeDays.has(day)) {
        current += 1;
        day = shiftDay(day, -1);
    }
    let longest = 0;
    let run = 0;
    for (const date of windowDays(window)) {
        run = activeDays.has(date) ? run + 1 : 0;
        longest = Math.max(longest, run);
    }
    return { current, longest };
}
