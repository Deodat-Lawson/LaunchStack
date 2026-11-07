/**
 * The Usage tab's services, with the database reads stubbed: who a filter
 * narrows the reads to, which ids are a 404, how allowances are asked for,
 * and that a member's own view carries no one else's name or numbers.
 */

import type * as SettingsUsage from "~/server/settings/usage";
import type { MemberView } from "~/server/workspace/members";
import type { UsageRaw } from "~/server/usage/rollup";
import type { UsageWindow } from "~/lib/usage/types";

jest.mock("~/server/db", () => ({ db: {} }));

const mockListMembers = jest.fn();
jest.mock("~/server/workspace/members", () => ({
    listMembers: (...args: unknown[]) => mockListMembers(...args),
}));

const mockUsageRaw = jest.fn();
const mockAiRows = jest.fn();
const mockDocumentUsage = jest.fn();
const mockGroups = jest.fn();
jest.mock("~/server/usage/queries", () => ({
    usageRaw: (...args: unknown[]) => mockUsageRaw(...args),
    aiUsageRows: (...args: unknown[]) => mockAiRows(...args),
    documentUsage: (...args: unknown[]) => mockDocumentUsage(...args),
    workspaceGroupList: (...args: unknown[]) => mockGroups(...args),
}));

jest.mock("~/server/settings/usage", () => ({
    ...jest.requireActual<typeof SettingsUsage>("~/server/settings/usage"),
    workspacePricePerMillionTokens: () => Promise.resolve(0),
}));

const mockAllowances = jest.fn();
jest.mock("~/server/ai-usage/quota", () => ({
    getAiAllowances: (...args: unknown[]) => mockAllowances(...args),
}));

const mockModelsScope = jest.fn();
jest.mock("~/server/workspace-models/scope", () => ({
    loadWorkspaceChatModelsScope: (...args: unknown[]) => mockModelsScope(...args),
}));

const mockScopedWhere = jest.fn();
jest.mock("~/lib/authz/scope", () => ({
    scopedDocumentWhere: (...args: unknown[]) => mockScopedWhere(...args),
}));

import { usageActivity, usageDocuments, usageMe, usagePeople, usageSummary } from "~/server/usage";
import { isWorkspaceError } from "~/server/workspace/errors";
import { makeWorkspaceContext } from "../../helpers/workspace-context";

const WINDOW: UsageWindow = {
    from: "2026-10-01",
    to: "2026-10-07",
    days: 7,
    previousFrom: "2026-09-24",
    previousTo: "2026-09-30",
};

function member(id: number, authUserId: string, extra: Partial<MemberView> = {}): MemberView {
    return {
        id,
        authUserId,
        name: `Secret ${authUserId}`,
        email: `${authUserId}@secret.example`,
        displayName: `Person ${authUserId}`,
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

const MEMBERS = [
    member(11, "me", { isSelf: true }),
    member(12, "teammate", { groups: [{ id: 7, name: "Ops" }] }),
    member(13, "invitee", { status: "pending" }),
];

const EMPTY: UsageRaw = { ai: [], questions: [], filesAdded: [], docsOpened: [] };

const RAW: UsageRaw = {
    ai: [
        {
            date: "2026-10-02",
            userId: "teammate",
            feature: "ask",
            route: "default",
            owner: "deployment",
            kind: "chat",
            calls: 4,
            weightedTokens: 4000,
            inputTokens: 4000,
            outputTokens: 0,
            cachedInputTokens: 0,
            reasoningTokens: 0,
            pricedCalls: 0,
            costUsd: 0,
            lastAt: null,
        },
    ],
    questions: [
        { date: "2026-10-02", userId: "teammate", count: 9, lastAt: null },
        { date: "2026-10-07", userId: "me", count: 1, lastAt: null },
    ],
    filesAdded: [],
    docsOpened: [],
};

const ctx = makeWorkspaceContext({ authUserId: "me", companyId: BigInt(5), role: "admin" });

async function rejection(promise: Promise<unknown>): Promise<number | null> {
    try {
        await promise;
        return null;
    } catch (error) {
        return isWorkspaceError(error) ? error.status : -1;
    }
}

beforeEach(() => {
    jest.clearAllMocks();
    mockListMembers.mockResolvedValue({ members: MEMBERS, counts: {} });
    mockUsageRaw.mockResolvedValue(EMPTY);
    mockAiRows.mockResolvedValue([]);
    mockGroups.mockResolvedValue([{ id: 7, name: "Ops" }]);
    mockModelsScope.mockResolvedValue({ source: "deployment" });
    mockAllowances.mockImplementation((_company: bigint, ids: string[]) =>
        Promise.resolve(
            new Map(
                ids.map(id => [
                    id,
                    {
                        start: "2026-10-01",
                        resetsAt: "2026-11-01T00:00:00.000Z",
                        used: 10,
                        workspace: { limit: 100, source: "default" },
                        server: null,
                        binding: "workspace",
                        percent: 10,
                        blocked: false,
                    },
                ])
            )
        )
    );
});

describe("usageSummary", () => {
    it("reads the whole workspace over both windows", async () => {
        const summary = await usageSummary(ctx, WINDOW, { person: null, group: null });
        expect(mockUsageRaw).toHaveBeenCalledWith(
            BigInt(5),
            { from: "2026-09-24", to: "2026-10-07" },
            {}
        );
        // Pending invitations aren't members.
        expect(summary).toMatchObject({ scope: { kind: "workspace" }, members: 2 });
        expect(summary.daily).toHaveLength(7);
    });

    it("narrows to one member by their member id", async () => {
        const summary = await usageSummary(ctx, WINDOW, { person: 12, group: null });
        expect(mockUsageRaw.mock.calls[0][2]).toEqual({ userIds: ["teammate"] });
        expect(summary).toMatchObject({
            scope: { kind: "person", memberId: 12, displayName: "Person teammate" },
            members: 1,
        });
    });

    it("narrows to a group's current members", async () => {
        const summary = await usageSummary(ctx, WINDOW, { person: null, group: 7 });
        expect(mockUsageRaw.mock.calls[0][2]).toEqual({ userIds: ["teammate"] });
        expect(summary).toMatchObject({
            scope: { kind: "group", groupId: 7, name: "Ops" },
            members: 1,
        });
    });

    it("is a 404 for someone who isn't a member, a pending invitation, or another workspace's group", async () => {
        await expect(
            rejection(usageSummary(ctx, WINDOW, { person: 99, group: null }))
        ).resolves.toBe(404);
        await expect(
            rejection(usageSummary(ctx, WINDOW, { person: 13, group: null }))
        ).resolves.toBe(404);
        await expect(
            rejection(usageSummary(ctx, WINDOW, { person: null, group: 8 }))
        ).resolves.toBe(404);
        expect(mockUsageRaw).not.toHaveBeenCalled();
    });
});

describe("usagePeople", () => {
    it("asks for every current member's allowance, with the server cap when it applies", async () => {
        const result = await usagePeople(ctx, WINDOW, { group: null });
        expect(mockAllowances).toHaveBeenCalledWith(BigInt(5), ["me", "teammate"], {
            serverCapApplies: true,
        });
        expect(mockUsageRaw).toHaveBeenCalledWith(BigInt(5), WINDOW, {});
        expect(result.people.map(p => p.memberId).sort()).toEqual([11, 12]);
        expect(result.people[0]!.allowance).toEqual({
            used: 10,
            limit: 100,
            percent: 10,
            blocked: false,
            resetsAt: "2026-11-01T00:00:00.000Z",
        });
        expect(result.groups).toEqual([{ id: 7, name: "Ops" }]);
    });

    it("leaves the server cap out while the workspace runs on its own endpoint", async () => {
        mockModelsScope.mockResolvedValue({ source: "workspace" });
        await usagePeople(ctx, WINDOW, { group: null });
        expect(mockAllowances.mock.calls[0][2]).toEqual({ serverCapApplies: false });
    });

    it("lists one group's members, and is a 404 for an unknown group", async () => {
        const result = await usagePeople(ctx, WINDOW, { group: 7 });
        expect(result.people.map(p => p.authUserId)).toEqual(["teammate"]);
        expect(mockUsageRaw.mock.calls[0][2]).toEqual({ userIds: ["teammate"] });
        await expect(rejection(usagePeople(ctx, WINDOW, { group: 70 }))).resolves.toBe(404);
    });
});

describe("usageActivity", () => {
    it("narrows the meter to one member and one feature", async () => {
        await usageActivity(ctx, WINDOW, { person: 12, feature: "notes", offset: 0, limit: 50 });
        expect(mockAiRows).toHaveBeenCalledWith(BigInt(5), WINDOW, {
            userIds: ["teammate"],
            feature: "notes",
        });
    });

    it("is a 404 for an unknown member", async () => {
        await expect(
            rejection(usageActivity(ctx, WINDOW, { person: 5, feature: null, offset: 0, limit: 1 }))
        ).resolves.toBe(404);
    });
});

describe("usageDocuments", () => {
    it("reads only what the caller's document scope lets them see", async () => {
        const visible = { sentinel: "scoped" };
        mockScopedWhere.mockReturnValue(visible);
        mockDocumentUsage.mockResolvedValue({ documents: [], totalDocuments: 0, trend: [] });
        const result = await usageDocuments(ctx, WINDOW, { limit: 20 });
        expect(mockScopedWhere).toHaveBeenCalledWith(BigInt(5), await ctx.documentScope());
        expect(mockDocumentUsage).toHaveBeenCalledWith(BigInt(5), visible, WINDOW, 20);
        expect(result.trend).toHaveLength(7);
    });
});

describe("usageMe", () => {
    it("is the caller's own numbers, the median and a streak, and names no one else", async () => {
        mockUsageRaw.mockImplementation(
            (_company: bigint, _range: unknown, filter?: { userIds?: string[] }) =>
                Promise.resolve(
                    filter?.userIds
                        ? {
                              ...RAW,
                              ai: [],
                              questions: RAW.questions.filter(q => q.userId === "me"),
                          }
                        : RAW
                )
        );
        const result = await usageMe(ctx, WINDOW, new Date("2026-10-07T18:00:00Z"));

        // Mine from a year back (for the streak), everyone's only for the window.
        expect(mockUsageRaw).toHaveBeenCalledWith(
            BigInt(5),
            { from: "2025-10-06", to: "2026-10-07" },
            { userIds: ["me"] }
        );
        expect(mockUsageRaw).toHaveBeenCalledWith(BigInt(5), WINDOW);

        expect(result.summary.scope).toEqual({
            kind: "person",
            memberId: 11,
            displayName: "Person me",
        });
        expect(result.summary.totals).toMatchObject({ questions: 1, aiTokens: 0 });
        expect(result.members).toBe(2);
        // Two members: the median would be their average, and mine (1) would
        // give the teammate's (9) away, so there is none.
        expect(result.median).toBeNull();
        expect(result.streak).toEqual({ current: 1, longest: 1 });

        const wire = JSON.stringify(result);
        for (const leak of ["teammate", "secret.example", "Secret", "invitee"]) {
            expect(wire).not.toContain(leak);
        }
    });

    it("gives the median from three members, idle ones included", async () => {
        mockListMembers.mockResolvedValue({
            members: [...MEMBERS, member(14, "quiet")],
            counts: {},
        });
        mockUsageRaw.mockImplementation(
            (_company: bigint, _range: unknown, filter?: { userIds?: string[] }) =>
                Promise.resolve(filter?.userIds ? { ...RAW, ai: [] } : RAW)
        );
        const result = await usageMe(ctx, WINDOW, new Date("2026-10-07T18:00:00Z"));
        expect(result.members).toBe(3);
        // questions: me 1, teammate 9, quiet 0 → 1; tokens: 0, 4000, 0 → 0.
        expect(result.median).toMatchObject({ questions: 1, aiTokens: 0 });
        expect(JSON.stringify(result)).not.toContain("quiet");
    });
});
