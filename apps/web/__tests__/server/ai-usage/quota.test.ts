/**
 * Per-person AI allowances, the pure half: which month counts, which limit
 * binds, when work is refused, how each person's chat-token equivalents are
 * added up and split by kind, and how the server cap is read from the
 * environment. The database half is ai-allowance.integration.test.ts.
 */

const mockEnv = {
    server: {
        AI_MONTHLY_TOKEN_LIMIT_PER_USER: undefined as string | undefined,
        AI_TOKEN_LIMIT_EXEMPT_EMAILS: undefined as string | undefined,
    },
};
jest.mock("~/env", () => ({
    get env() {
        return mockEnv;
    },
}));
/**
 * A stand-in for the few queries getAiAllowances makes: each `from(table)`
 * answers with the next rows queued for that table, whether the query ends at
 * `where` or goes on to `groupBy`.
 */
const mockRows = new Map<unknown, unknown[][]>();
jest.mock("~/server/db", () => ({
    db: {
        select: () => ({
            from: (table: unknown) => {
                const rows = mockRows.get(table)?.shift() ?? [];
                return {
                    where: () =>
                        Object.assign(Promise.resolve(rows), {
                            groupBy: () => Promise.resolve(rows),
                        }),
                };
            },
        }),
    },
}));
const mockReadWorkspaceSetting = jest.fn();
jest.mock("~/server/settings/store", () => ({
    readWorkspaceSetting: (...args: unknown[]) => mockReadWorkspaceSetting(...args) as unknown,
}));

import {
    allowancePeriod,
    evaluateAllowance,
    getAiAllowances,
    isExemptFromServerLimit,
    serverMonthlyLimit,
} from "~/server/ai-usage/quota";
import { aiUsageDaily, memberAiLimits, users } from "~/server/db/schema";

const period = allowancePeriod(new Date("2026-10-25T12:00:00Z"));

beforeEach(() => {
    mockEnv.server.AI_MONTHLY_TOKEN_LIMIT_PER_USER = undefined;
    mockEnv.server.AI_TOKEN_LIMIT_EXEMPT_EMAILS = undefined;
});

describe("allowancePeriod", () => {
    it("runs from the 1st of the month to the 1st of the next, in UTC", () => {
        expect(period).toEqual({ start: "2026-10-01", resetsAt: "2026-11-01T00:00:00.000Z" });
    });

    it("rolls December over into January", () => {
        expect(allowancePeriod(new Date("2026-12-31T23:59:59Z"))).toEqual({
            start: "2026-12-01",
            resetsAt: "2027-01-01T00:00:00.000Z",
        });
    });

    it("uses UTC, not the server's zone, at a month boundary", () => {
        // 23:30 on Oct 31 in UTC-5 is already November in UTC.
        expect(allowancePeriod(new Date("2026-11-01T04:30:00Z")).start).toBe("2026-11-01");
    });
});

describe("evaluateAllowance", () => {
    const base = { period, workspaceSource: "default" as const, server: null };

    it("refuses nothing when no limit applies", () => {
        const allowance = evaluateAllowance({ ...base, used: 5_000_000, workspaceLimit: null });
        expect(allowance).toMatchObject({ binding: null, percent: null, blocked: false });
    });

    it("reports how far along the workspace limit is", () => {
        const allowance = evaluateAllowance({ ...base, used: 800_000, workspaceLimit: 1_000_000 });
        expect(allowance).toMatchObject({ binding: "workspace", percent: 80, blocked: false });
    });

    it("refuses once usage reaches the limit, not only past it", () => {
        expect(
            evaluateAllowance({ ...base, used: 1_000_000, workspaceLimit: 1_000_000 }).blocked
        ).toBe(true);
        expect(
            evaluateAllowance({ ...base, used: 999_999, workspaceLimit: 1_000_000 }).blocked
        ).toBe(false);
    });

    it("binds the tighter of the two limits", () => {
        const serverTighter = evaluateAllowance({
            ...base,
            used: 100_000,
            workspaceLimit: 1_000_000,
            server: { limit: 500_000, used: 450_000 },
        });
        expect(serverTighter).toMatchObject({ binding: "server", percent: 90, blocked: false });

        const workspaceTighter = evaluateAllowance({
            ...base,
            used: 950_000,
            workspaceLimit: 1_000_000,
            server: { limit: 5_000_000, used: 950_000 },
        });
        expect(workspaceTighter).toMatchObject({ binding: "workspace", percent: 95 });
    });

    it("refuses on the server cap alone, with usage from other workspaces", () => {
        const allowance = evaluateAllowance({
            ...base,
            used: 10,
            workspaceLimit: null,
            server: { limit: 2_000_000, used: 2_100_000 },
        });
        expect(allowance).toMatchObject({ binding: "server", percent: 105, blocked: true });
    });

    it("counts a bare total as chat, for the workspace and the server", () => {
        const allowance = evaluateAllowance({
            ...base,
            used: 800_000,
            workspaceLimit: 1_000_000,
            server: { limit: 2_000_000, used: 1_500_000 },
        });
        expect(allowance.split).toEqual({ chat: 800_000, embedding: 0, search: 0 });
        expect(allowance.server).toEqual({
            limit: 2_000_000,
            used: 1_500_000,
            split: { chat: 1_500_000, embedding: 0, search: 0 },
        });
    });

    it("keeps the split it is given, and binds on the total", () => {
        const split = { chat: 600_000, embedding: 130_000, search: 14_000 };
        const serverSplit = { chat: 1_100_000, embedding: 130_000, search: 14_000 };
        const allowance = evaluateAllowance({
            ...base,
            used: 744_000,
            split,
            workspaceLimit: 1_000_000,
            server: { limit: 2_000_000, used: 1_244_000, split: serverSplit },
        });
        expect(allowance).toMatchObject({
            used: 744_000,
            split,
            server: { used: 1_244_000, split: serverSplit },
            binding: "workspace",
            percent: 74.4,
        });
    });

    it("keeps where the workspace limit came from", () => {
        const allowance = evaluateAllowance({
            ...base,
            used: 0,
            workspaceLimit: null,
            workspaceSource: "member",
        });
        expect(allowance.workspace).toEqual({ limit: null, source: "member" });
    });
});

describe("getAiAllowances", () => {
    beforeEach(() => {
        mockRows.clear();
        mockReadWorkspaceSetting.mockReset();
        mockReadWorkspaceSetting.mockResolvedValue(1_000_000);
    });

    it("adds up each person's chat-token equivalents and splits them by kind", async () => {
        mockEnv.server.AI_MONTHLY_TOKEN_LIMIT_PER_USER = "2000000";
        mockRows.set(aiUsageDaily, [
            // This workspace (asked first), as (person, kind, weighted sum); sums arrive as strings.
            [
                { userId: "alice", kind: "chat", tokens: "600000" },
                { userId: "alice", kind: "embedding", tokens: "130000" },
                { userId: "alice", kind: "web_search", tokens: "14000" },
                { userId: "alice", kind: "web_contents", tokens: "2000" },
                { userId: "bob", kind: "chat", tokens: 100_000 },
            ],
            // Every workspace, on the server's own models and keys.
            [
                { userId: "alice", kind: "chat", tokens: "1100000" },
                { userId: "alice", kind: "embedding", tokens: "130000" },
                { userId: "alice", kind: "web_search", tokens: "14000" },
                { userId: "alice", kind: "web_contents", tokens: "2000" },
                { userId: "bob", kind: "chat", tokens: "100000" },
            ],
        ]);
        mockRows.set(memberAiLimits, [[]]);
        mockRows.set(users, [
            [
                { userId: "alice", email: "alice@example.com" },
                { userId: "bob", email: "bob@example.com" },
                { userId: "carol", email: "carol@example.com" },
            ],
        ]);

        const allowances = await getAiAllowances(1n, ["alice", "bob", "carol"], {
            serverCapApplies: true,
            at: new Date("2026-10-25T12:00:00Z"),
        });

        expect(allowances.get("alice")).toMatchObject({
            used: 746_000,
            split: { chat: 600_000, embedding: 130_000, search: 16_000 },
            workspace: { limit: 1_000_000, source: "default" },
            server: {
                limit: 2_000_000,
                used: 1_246_000,
                split: { chat: 1_100_000, embedding: 130_000, search: 16_000 },
            },
            binding: "workspace",
            percent: 74.6,
            blocked: false,
        });
        expect(allowances.get("bob")).toMatchObject({
            used: 100_000,
            split: { chat: 100_000, embedding: 0, search: 0 },
        });
        expect(allowances.get("carol")).toMatchObject({
            used: 0,
            split: { chat: 0, embedding: 0, search: 0 },
            server: { used: 0, split: { chat: 0, embedding: 0, search: 0 } },
        });
    });
});

describe("the server cap", () => {
    it("is off when unset, empty, zero or not a number", () => {
        for (const value of [undefined, "", "0", "-5", "lots"]) {
            mockEnv.server.AI_MONTHLY_TOKEN_LIMIT_PER_USER = value;
            expect(serverMonthlyLimit()).toBeNull();
        }
    });

    it("reads digits with separators", () => {
        mockEnv.server.AI_MONTHLY_TOKEN_LIMIT_PER_USER = "2,000,000";
        expect(serverMonthlyLimit()).toBe(2_000_000);
        mockEnv.server.AI_MONTHLY_TOKEN_LIMIT_PER_USER = " 1_500_000 ";
        expect(serverMonthlyLimit()).toBe(1_500_000);
    });

    it("exempts listed emails, ignoring case and spaces", () => {
        mockEnv.server.AI_TOKEN_LIMIT_EXEMPT_EMAILS = " Founder@Example.com , ops@example.com";
        expect(isExemptFromServerLimit("founder@example.com")).toBe(true);
        expect(isExemptFromServerLimit("OPS@example.com")).toBe(true);
        expect(isExemptFromServerLimit("member@example.com")).toBe(false);
        expect(isExemptFromServerLimit(null)).toBe(false);
    });
});
