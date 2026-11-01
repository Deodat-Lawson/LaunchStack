/**
 * The Usage tab's arithmetic, without a database: what each tile, chart and
 * table row adds up to, that people + former members + unattributed work is
 * exactly the workspace, and the median and streak rules.
 */

// The cost helpers' module opens the database lazily; nothing here queries it.
jest.mock("~/server/db", () => ({ db: {} }));

import type { AiAllowance } from "~/server/ai-usage/quota";
import type { MemberView } from "~/server/workspace/members";
import type { UsageCounts, UsageWindow } from "~/lib/usage/types";
import { presetWindow } from "~/lib/usage/range";
import {
    activeDaysOf,
    activityOf,
    currentMembers,
    documentsOf,
    median,
    medianOf,
    peopleOf,
    streakOf,
    summarize,
    toUsageAllowance,
    type AiUsageRow,
    type UsageMember,
    type UsageRaw,
} from "~/server/usage/rollup";

const WINDOW: UsageWindow = {
    from: "2026-10-01",
    to: "2026-10-07",
    days: 7,
    previousFrom: "2026-09-24",
    previousTo: "2026-09-30",
};
const PRICE = 2; // $ per 1M tokens, for calls whose model declared none

function ai(row: Partial<AiUsageRow> & Pick<AiUsageRow, "date" | "userId">): AiUsageRow {
    return {
        feature: "ask",
        route: "default",
        owner: "deployment",
        calls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        pricedCalls: 0,
        costUsd: 0,
        lastAt: `${row.date}T12:00:00.000Z`,
        ...row,
    };
}

const at = (date: string, userId: string, count: number) => ({
    date,
    userId,
    count,
    lastAt: `${date}T09:00:00.000Z`,
});

// a, b and c are members (b suspended, c in group 10); z has left; "" is no one.
const RAW: UsageRaw = {
    ai: [
        ai({
            date: "2026-10-01",
            userId: "a",
            calls: 2,
            inputTokens: 1000,
            outputTokens: 500,
            cachedInputTokens: 200,
            pricedCalls: 2,
            costUsd: 0.01,
        }),
        ai({ date: "2026-10-02", userId: "a", route: "fast", inputTokens: 200, outputTokens: 100 }),
        ai({
            date: "2026-10-03",
            userId: "b",
            feature: "documentWriter",
            route: "reasoning",
            owner: "workspace",
            calls: 3,
            inputTokens: 3000,
            outputTokens: 1000,
            reasoningTokens: 600,
            pricedCalls: 1,
            costUsd: 0.02,
        }),
        ai({ date: "2026-10-04", userId: "z", route: "", inputTokens: 100, outputTokens: 100 }),
        ai({
            date: "2026-10-05",
            userId: "",
            feature: "ingestion",
            route: "auxiliary",
            calls: 5,
            inputTokens: 5000,
        }),
        // The previous window, and before it.
        ai({ date: "2026-09-28", userId: "a", inputTokens: 50, outputTokens: 50 }),
        ai({ date: "2026-09-20", userId: "a", inputTokens: 9999 }),
    ],
    questions: [at("2026-10-01", "a", 3), at("2026-10-06", "c", 1), at("2026-10-02", "z", 2)],
    filesAdded: [at("2026-10-03", "b", 1), at("2026-10-06", "c", 2)],
    docsOpened: [at("2026-10-07", "a", 4), at("2026-09-29", "c", 1)],
};

function member(id: number, authUserId: string, extra: Partial<MemberView> = {}): MemberView {
    return {
        id,
        authUserId,
        name: authUserId.toUpperCase(),
        email: `${authUserId}@example.com`,
        displayName: `Person ${authUserId.toUpperCase()}`,
        title: null,
        pronouns: null,
        avatarUrl: null,
        role: "member",
        roleName: "Member",
        status: "active",
        groups: [],
        joinedAt: "2026-01-01T00:00:00.000Z",
        lastActiveAt: null,
        isSelf: false,
        ...extra,
    };
}

const MEMBERS: UsageMember[] = currentMembers([
    member(1, "a", { isSelf: true, role: "owner", roleName: "Owner" }),
    member(2, "b", { status: "suspended", lastActiveAt: "2026-10-09T08:00:00.000Z" }),
    member(3, "c", { groups: [{ id: 10, name: "Design" }] }),
    member(4, "p", { status: "pending" }),
]);

const ALLOWANCE = {
    used: 0,
    limit: null,
    percent: null,
    blocked: false,
    resetsAt: "2026-11-01T00:00:00.000Z",
};

function people(grouped = false, list: UsageMember[] = MEMBERS) {
    return peopleOf({
        window: WINDOW,
        raw: RAW,
        pricePerMillionTokens: PRICE,
        members: list,
        currentAuthIds: new Set(MEMBERS.map(m => m.authUserId)),
        allowances: new Map(list.map(m => [m.authUserId, ALLOWANCE])),
        groups: [{ id: 10, name: "Design" }],
        grouped,
    });
}

const workspace = () =>
    summarize({
        window: WINDOW,
        scope: { kind: "workspace" },
        raw: RAW,
        pricePerMillionTokens: PRICE,
        members: MEMBERS.length,
    });

describe("currentMembers", () => {
    it("leaves pending invitations out", () => {
        expect(MEMBERS.map(m => m.authUserId)).toEqual(["a", "b", "c"]);
    });
});

describe("summarize (workspace)", () => {
    const summary = workspace();

    it("adds up everything in the window, people who left and no one included", () => {
        expect(summary.totals).toMatchObject({
            questions: 6,
            filesAdded: 3,
            docsOpened: 4,
            aiCalls: 12,
            aiTokens: 11_000,
            inputTokens: 9_300,
            outputTokens: 1_700,
            cachedInputTokens: 200,
            reasoningTokens: 600,
            // a, b, c and z. Work no one started makes no one active.
            activePeople: 4,
            // Oct 5 had only an ingestion run: not an active day.
            activeDays: 6,
        });
    });

    it("prices the declared calls and the rest at the workspace's own price", () => {
        // 0.01 + 0.02 declared; unpriced: 300 + 4000 × 2/3 + 200 + 5000 tokens at $2/M.
        const unpriced = 300 + (4000 * 2) / 3 + 200 + 5000;
        expect(summary.totals.costUsd).toBeCloseTo(0.03 + (unpriced / 1_000_000) * PRICE, 10);
    });

    it("keeps the previous window apart", () => {
        expect(summary.previous).toMatchObject({
            aiCalls: 1,
            aiTokens: 100,
            docsOpened: 1,
            questions: 0,
            activePeople: 2,
            activeDays: 2,
        });
    });

    it("has every day of the window, zero-filled", () => {
        expect(summary.daily.map(d => d.date)).toEqual([
            "2026-10-01",
            "2026-10-02",
            "2026-10-03",
            "2026-10-04",
            "2026-10-05",
            "2026-10-06",
            "2026-10-07",
        ]);
        const oct5 = summary.daily[4]!;
        expect(oct5).toMatchObject({ aiCalls: 5, aiTokens: 5000, activePeople: 0 });
        expect(oct5.features).toEqual({ ingestion: 5000 });
        expect(summary.daily[1]).toMatchObject({ questions: 2, activePeople: 2 });
        expect(summary.daily[6]).toMatchObject({ docsOpened: 4, aiCalls: 0, costUsd: null });
    });

    it("ranks features and routes by tokens, counting the people each was used for", () => {
        expect(
            summary.byFeature.map(f => [f.feature, f.inputTokens + f.outputTokens, f.people])
        ).toEqual([
            ["ingestion", 5000, 0],
            ["documentWriter", 4000, 1],
            ["ask", 2000, 2],
        ]);
        // An unknown route reads as default.
        expect(summary.byRoute.map(r => [r.route, r.calls])).toEqual([
            ["auxiliary", 5],
            ["reasoning", 3],
            ["default", 3],
            ["fast", 1],
        ]);
    });

    it("reports unattributed tokens and calls to the workspace's own endpoint", () => {
        expect(summary.unattributedTokens).toBe(5000);
        expect(summary.workspaceOwnedCalls).toBe(3);
        expect(summary.members).toBe(3);
    });

    it("says null, not $0, when nothing is priced and no price is set", () => {
        const unpriced = summarize({
            window: WINDOW,
            scope: { kind: "workspace" },
            raw: { ...RAW, ai: RAW.ai.map(row => ({ ...row, pricedCalls: 0, costUsd: 0 })) },
            pricePerMillionTokens: 0,
            members: 3,
        });
        expect(unpriced.totals.costUsd).toBeNull();
        expect(unpriced.byFeature.every(f => f.costUsd === null)).toBe(true);
    });
});

describe("summarize (a person, a group)", () => {
    it("counts only that person, and never work no one started", () => {
        const summary = summarize({
            window: WINDOW,
            scope: { kind: "person", memberId: 1, displayName: "Person A" },
            raw: RAW,
            pricePerMillionTokens: PRICE,
            people: new Set(["a"]),
            members: 1,
        });
        expect(summary.totals).toMatchObject({
            questions: 3,
            docsOpened: 4,
            aiCalls: 3,
            aiTokens: 1800,
            activePeople: 1,
            activeDays: 3,
        });
        expect(summary.previous).toMatchObject({ aiTokens: 100, activeDays: 1 });
        expect(summary.unattributedTokens).toBe(0);
        expect(summary.byFeature).toHaveLength(1);
    });

    it("sums only a group's members", () => {
        const summary = summarize({
            window: WINDOW,
            scope: { kind: "group", groupId: 10, name: "Design" },
            raw: RAW,
            pricePerMillionTokens: PRICE,
            people: new Set(["c"]),
            members: 1,
        });
        expect(summary.totals).toMatchObject({
            questions: 1,
            filesAdded: 2,
            aiCalls: 0,
            costUsd: null,
            activePeople: 1,
            activeDays: 1,
        });
    });
});

describe("peopleOf", () => {
    it("lists every current member, most AI tokens first, then questions, then name", () => {
        const result = people();
        expect(result.people.map(p => p.authUserId)).toEqual(["b", "a", "c"]);
        const c = result.people[2]!;
        expect(c).toMatchObject({
            memberId: 3,
            role: "member",
            status: "active",
            topFeature: null,
            activeDays: 1,
            groups: [{ id: 10, name: "Design" }],
        });
        expect(c.totals).toMatchObject({ questions: 1, filesAdded: 2, aiTokens: 0, costUsd: null });
        expect(result.people[1]).toMatchObject({
            authUserId: "a",
            role: "owner",
            isSelf: true,
            topFeature: "ask",
            activeDays: 3,
            // Nothing from sign-in, so the latest thing counted: a's documents on Oct 7.
            lastActiveAt: "2026-10-07T09:00:00.000Z",
        });
        // A later sign-in wins over what was counted.
        expect(result.people[0]).toMatchObject({
            status: "suspended",
            topFeature: "documentWriter",
            lastActiveAt: "2026-10-09T08:00:00.000Z",
            allowance: ALLOWANCE,
        });
    });

    it("puts people who left and work no one started in one row each", () => {
        const result = people();
        expect(result.formerMembers).toMatchObject({ questions: 2, aiCalls: 1, aiTokens: 200 });
        expect(result.unattributed).toMatchObject({ questions: 0, aiCalls: 5, aiTokens: 5000 });
        expect(result.groups).toEqual([{ id: 10, name: "Design" }]);
    });

    it("leaves both out of a group's view", () => {
        const result = people(
            true,
            MEMBERS.filter(m => m.authUserId === "c")
        );
        expect(result.people.map(p => p.authUserId)).toEqual(["c"]);
        expect(result.formerMembers).toBeNull();
        expect(result.unattributed).toBeNull();
    });

    it("is null for former members and unattributed work when there was none", () => {
        const result = peopleOf({
            window: WINDOW,
            raw: { ai: [], questions: [], filesAdded: [], docsOpened: [] },
            pricePerMillionTokens: PRICE,
            members: MEMBERS,
            currentAuthIds: new Set(MEMBERS.map(m => m.authUserId)),
            allowances: new Map(MEMBERS.map(m => [m.authUserId, ALLOWANCE])),
            groups: [],
            grouped: false,
        });
        expect(result.formerMembers).toBeNull();
        expect(result.unattributed).toBeNull();
        expect(result.people.every(p => p.totals.aiTokens === 0 && p.activeDays === 0)).toBe(true);
    });
});

// ── The invariant: people + former members + unattributed = the workspace ──

const ADDITIVE: Exclude<keyof UsageCounts, "costUsd">[] = [
    "questions",
    "filesAdded",
    "docsOpened",
    "aiCalls",
    "aiTokens",
    "inputTokens",
    "outputTokens",
    "cachedInputTokens",
    "reasoningTokens",
];

function expectPartsAddUp(raw: UsageRaw, price: number) {
    const whole = summarize({
        window: WINDOW,
        scope: { kind: "workspace" },
        raw,
        pricePerMillionTokens: price,
        members: MEMBERS.length,
    });
    const parts = peopleOf({
        window: WINDOW,
        raw,
        pricePerMillionTokens: price,
        members: MEMBERS,
        currentAuthIds: new Set(MEMBERS.map(m => m.authUserId)),
        allowances: new Map(MEMBERS.map(m => [m.authUserId, ALLOWANCE])),
        groups: [],
        grouped: false,
    });
    const rows: UsageCounts[] = [
        ...parts.people.map(p => p.totals),
        ...(parts.formerMembers ? [parts.formerMembers] : []),
        ...(parts.unattributed ? [parts.unattributed] : []),
    ];
    for (const key of ADDITIVE) {
        const sum = rows.reduce((total, row) => total + row[key], 0);
        expect([key, sum]).toEqual([key, whole.totals[key]]);
    }
    const cost = rows.reduce((total, row) => total + (row.costUsd ?? 0), 0);
    if (whole.totals.costUsd === null) {
        expect(rows.every(row => row.costUsd === null)).toBe(true);
    } else {
        expect(cost).toBeCloseTo(whole.totals.costUsd, 9);
    }
    // And the days and features say the same thing as the totals.
    expect(whole.daily.reduce((t, d) => t + d.aiTokens, 0)).toBe(whole.totals.aiTokens);
    expect(whole.daily.reduce((t, d) => t + d.questions, 0)).toBe(whole.totals.questions);
    expect(whole.byFeature.reduce((t, f) => t + f.inputTokens + f.outputTokens, 0)).toBe(
        whole.totals.aiTokens
    );
}

/** A small deterministic generator, so a failure reproduces. */
function seeded(seed: number) {
    let state = seed;
    return () => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
        return state / 2_147_483_648;
    };
}

function generated(seed: number): UsageRaw {
    const random = seeded(seed);
    const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
    const users = ["a", "b", "c", "z", "y", ""];
    const days = ["2026-09-26", "2026-09-30", "2026-10-01", "2026-10-03", "2026-10-07"];
    const raw: UsageRaw = { ai: [], questions: [], filesAdded: [], docsOpened: [] };
    for (let i = 0; i < 60; i++) {
        const calls = 1 + Math.floor(random() * 4);
        const priced = Math.floor(random() * (calls + 1));
        raw.ai.push(
            ai({
                date: pick(days),
                userId: pick(users),
                feature: pick(["ask", "notes", "ingestion"]),
                route: pick(["", "default", "fast", "auxiliary"]),
                owner: pick(["deployment", "workspace"]),
                calls,
                pricedCalls: priced,
                inputTokens: Math.floor(random() * 10_000),
                outputTokens: Math.floor(random() * 3_000),
                cachedInputTokens: Math.floor(random() * 500),
                reasoningTokens: Math.floor(random() * 500),
                costUsd: priced > 0 ? random() / 10 : 0,
            })
        );
    }
    for (const list of [raw.questions, raw.filesAdded, raw.docsOpened]) {
        for (let i = 0; i < 20; i++) {
            list.push(
                at(pick(days), pick(users.filter(u => u !== "")), 1 + Math.floor(random() * 5))
            );
        }
    }
    return raw;
}

describe("people + former members + unattributed = the workspace", () => {
    it("holds for the fixture", () => {
        expectPartsAddUp(RAW, PRICE);
        expectPartsAddUp(RAW, 0);
    });

    it.each([1, 2, 3, 4, 5, 6, 7, 8])("holds for generated rows (seed %i)", seed => {
        const raw = generated(seed);
        expectPartsAddUp(raw, 0);
        expectPartsAddUp(raw, 3.5);
    });
});

describe("activityOf", () => {
    const rows: AiUsageRow[] = [
        // Two models on one day, person, feature, route and owner: one row.
        ai({ date: "2026-10-02", userId: "a", inputTokens: 100, pricedCalls: 1, costUsd: 0.5 }),
        ai({ date: "2026-10-02", userId: "a", inputTokens: 300 }),
        ai({ date: "2026-10-02", userId: "z", inputTokens: 1000 }),
        ai({ date: "2026-10-03", userId: "", feature: "ingestion", inputTokens: 10 }),
        ai({ date: "2026-10-01", userId: "b", owner: "workspace", route: "" }),
        ai({ date: "2026-09-01", userId: "b" }),
    ];
    const run = (offset = 0, limit = 100) =>
        activityOf({
            window: WINDOW,
            rows,
            members: MEMBERS,
            pricePerMillionTokens: 0,
            offset,
            limit,
        });

    it("groups by everything but the model, newest day first, then most tokens", () => {
        const result = run();
        expect(result.total).toBe(4);
        expect(result.rows.map(r => [r.date, r.person, r.inputTokens])).toEqual([
            ["2026-10-03", null, 10],
            ["2026-10-02", "former", 1000],
            ["2026-10-02", { displayName: "Person A", avatarUrl: null }, 400],
            ["2026-10-01", { displayName: "Person B", avatarUrl: null }, 0],
        ]);
        expect(result.rows[2]).toMatchObject({ memberId: 1, calls: 2, costUsd: 0.5 });
        expect(result.rows[1]).toMatchObject({ memberId: null, costUsd: null });
        expect(result.rows[3]).toMatchObject({ owner: "workspace", route: "default" });
        expect(Object.keys(result.rows[0]!)).not.toContain("modelId");
    });

    it("pages without changing the total", () => {
        const page = run(1, 2);
        expect(page).toMatchObject({ total: 4, offset: 1, limit: 2 });
        expect(page.rows.map(r => r.inputTokens)).toEqual([1000, 400]);
        expect(run(10, 2).rows).toEqual([]);
    });
});

describe("documentsOf", () => {
    it("zero-fills the trend and totals it", () => {
        const result = documentsOf({
            window: WINDOW,
            documents: [],
            totalDocuments: 12,
            trend: [
                { date: "2026-10-02", views: 3 },
                { date: "2026-10-07", views: 1 },
            ],
        });
        expect(result.trend).toHaveLength(7);
        expect(result.trend[1]).toEqual({ date: "2026-10-02", views: 3 });
        expect(result.trend[0]).toEqual({ date: "2026-10-01", views: 0 });
        expect(result.totalViews).toBe(4);
        expect(result.totalDocuments).toBe(12);
    });
});

describe("median", () => {
    it("takes the middle, or the mean of the two middle values", () => {
        expect(median([])).toBe(0);
        expect(median([5])).toBe(5);
        expect(median([9, 1, 4])).toBe(4);
        expect(median([0, 0, 3, 10])).toBe(1.5);
    });

    it("is over every current member, idle ones included", () => {
        const result = medianOf({ window: WINDOW, raw: RAW, authIds: ["a", "b", "c", "idle"] });
        // questions a3 b0 c1 idle0 → 0.5; ai tokens 1800, 4000, 0, 0 → 900.
        expect(result).toEqual({
            questions: 0.5,
            filesAdded: 0.5,
            docsOpened: 0,
            aiTokens: 900,
            activeDays: 1,
        });
    });
});

describe("streakOf", () => {
    const days = (...list: string[]) => new Set(list);

    it("runs back from today, or from yesterday while today has nothing yet", () => {
        const active = days("2026-10-05", "2026-10-06", "2026-10-07");
        expect(streakOf(active, WINDOW, "2026-10-07").current).toBe(3);
        expect(streakOf(active, WINDOW, "2026-10-08").current).toBe(3);
        expect(streakOf(active, WINDOW, "2026-10-09").current).toBe(0);
    });

    it("runs past the window's start for the current streak, not for the longest", () => {
        const active = days("2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05");
        const streak = streakOf(active, { from: "2026-10-01", to: "2026-10-05" }, "2026-10-02");
        expect(streak).toEqual({ current: 4, longest: 2 });
    });

    it("reads a person's active days from rows that cover everyone", () => {
        expect([...activeDaysOf(RAW, "c")].sort()).toEqual(["2026-09-29", "2026-10-06"]);
        // Work no one started is no one's day.
        expect(activeDaysOf(RAW, "").size).toBe(0);
        const window = presetWindow(7, new Date("2026-10-07T15:00:00Z"));
        expect(streakOf(activeDaysOf(RAW, "a"), window, "2026-10-07")).toEqual({
            current: 1,
            longest: 2,
        });
    });
});

describe("toUsageAllowance", () => {
    const base: AiAllowance = {
        start: "2026-10-01",
        resetsAt: "2026-11-01T00:00:00.000Z",
        used: 600,
        workspace: { limit: 1000, source: "default" },
        server: { limit: 800, used: 790 },
        binding: "server",
        percent: 98.8,
        blocked: false,
    };

    it("names the limit that binds", () => {
        expect(toUsageAllowance(base)).toEqual({
            used: 600,
            limit: 800,
            percent: 98.8,
            blocked: false,
            resetsAt: "2026-11-01T00:00:00.000Z",
        });
        expect(toUsageAllowance({ ...base, binding: "workspace", percent: 60 }).limit).toBe(1000);
        expect(
            toUsageAllowance({
                ...base,
                workspace: { limit: null, source: "member" },
                server: null,
                binding: null,
                percent: null,
            })
        ).toMatchObject({ limit: null, percent: null });
    });
});
