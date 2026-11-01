/**
 * The Usage tab against a real database: the four sources read per person
 * and day, a question copied into a fork counted once, other workspaces left
 * out, documents limited to the reader's scope, and the people table adding
 * up to the workspace's totals.
 */
import { eq, inArray } from "drizzle-orm";

jest.mock("~/server/engine", () => {
    const databaseUrl = process.env.DATABASE_URL;
    const coreDb = jest.requireActual<{ createDb: typeof createDb }>("@launchstack/store/client");
    const engineDb = databaseUrl
        ? coreDb.createDb({ url: databaseUrl, maxConnections: 5 }).db
        : undefined;
    return { getEngine: jest.fn(() => ({ db: engineDb })) };
});

import type { createDb } from "@launchstack/store/client";
import { company, document } from "@launchstack/store/schema";

import { isoDay, parseUsageWindow } from "~/lib/usage/range";
import type { UsageCounts, UsageWindow } from "~/lib/usage/types";
import { db } from "~/server/db";
import {
    aiUsageDaily,
    documentViews,
    settingsValues,
    userCompanyMemberships,
    users,
    workspaceActivity,
    workspaceGroupMembers,
    workspaceGroups,
    workspaceSessionMessages,
    workspaceSessions,
} from "~/server/db/schema";
import { usageActivity, usageDocuments, usageMe, usagePeople, usageSummary } from "~/server/usage";

import { makeWorkspaceContext } from "../helpers/workspace-context";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb("Usage tab", () => {
    jest.setTimeout(60_000);
    const stamp = Date.now();
    const id = (name: string) => `usage-${name}-${stamp}`;
    const alice = id("alice");
    const bob = id("bob");
    const carol = id("carol");
    const dave = id("dave"); // used the workspace, then left
    const pat = id("pat"); // a pending invitation
    let workspace: bigint;
    let elsewhere: bigint;
    let alicePk: bigint;
    let carolPk: bigint;
    let groupId: number;
    let doc1: number;
    let doc2: number;

    const parsed = parseUsageWindow(new URLSearchParams("from=2026-09-01&to=2026-09-07"));
    if (!parsed.ok) throw new Error(parsed.error);
    const window: UsageWindow = parsed.window;
    const at = (iso: string) => new Date(iso);
    const ctx = () =>
        makeWorkspaceContext({
            authUserId: alice,
            userPk: alicePk,
            companyId: workspace,
            role: "owner",
        });

    beforeAll(async () => {
        const companies = await db
            .insert(company)
            .values([
                { name: "Usage W", numberOfEmployees: "1" },
                { name: "Usage X", numberOfEmployees: "1" },
            ])
            .returning({ id: company.id });
        workspace = BigInt(companies[0]!.id);
        elsewhere = BigInt(companies[1]!.id);

        const people = await db
            .insert(users)
            .values(
                [alice, bob, carol, dave, pat].map(userId => ({
                    name: userId,
                    email: `${userId}@launchstack.test`,
                    userId,
                    companyId: workspace,
                }))
            )
            .returning({ id: users.id, userId: users.userId });
        const pk = (userId: string) => BigInt(people.find(p => p.userId === userId)!.id);
        alicePk = pk(alice);
        carolPk = pk(carol);
        await db.insert(userCompanyMemberships).values([
            { userId: pk(alice), companyId: workspace, role: "owner" },
            { userId: pk(bob), companyId: workspace, role: "member", status: "suspended" },
            { userId: pk(carol), companyId: workspace, role: "member" },
            { userId: pk(pat), companyId: workspace, role: "member", status: "pending" },
            { userId: pk(alice), companyId: elsewhere, role: "owner" },
        ]);
        const [group] = await db
            .insert(workspaceGroups)
            .values({
                companyId: workspace,
                name: "Design",
                slug: `design-${stamp}`,
                createdBy: alice,
            })
            .returning({ id: workspaceGroups.id });
        groupId = Number(group!.id);
        await db
            .insert(workspaceGroupMembers)
            .values({ groupId: BigInt(group!.id), userId: carolPk, addedBy: alice });

        await db.insert(settingsValues).values({
            companyId: workspace,
            scopeType: "workspace",
            scopeId: "",
            key: "usage.pricePerMillionTokens",
            value: 10,
        });

        const meter = (row: {
            companyId?: bigint;
            date: string;
            userId: string;
            feature?: string;
            route?: string;
            modelId?: string;
            owner?: string;
            calls: number;
            inputTokens: number;
            outputTokens?: number;
            pricedCalls?: number;
            costUsd?: string;
        }) => ({
            companyId: workspace,
            feature: "ask",
            route: "default",
            modelId: "vendor/m1",
            owner: "deployment",
            outputTokens: 0,
            pricedCalls: 0,
            costUsd: "0",
            ...row,
            // Chat rows, as the recorder writes them: a chat token counts one.
            kind: "chat",
            weightedTokens: row.inputTokens + (row.outputTokens ?? 0),
        });
        await db.insert(aiUsageDaily).values([
            meter({
                date: "2026-09-02",
                userId: alice,
                calls: 2,
                inputTokens: 1000,
                outputTokens: 200,
                pricedCalls: 2,
                costUsd: "0.004",
            }),
            // Another model, same everything else: one activity row.
            meter({
                date: "2026-09-02",
                userId: alice,
                modelId: "vendor/m2",
                calls: 1,
                inputTokens: 500,
            }),
            meter({
                date: "2026-09-03",
                userId: bob,
                feature: "documentWriter",
                route: "reasoning",
                owner: "workspace",
                calls: 1,
                inputTokens: 300,
                outputTokens: 300,
            }),
            meter({ date: "2026-09-04", userId: dave, route: "", calls: 1, inputTokens: 100 }),
            meter({
                date: "2026-09-05",
                userId: "",
                feature: "ingestion",
                route: "auxiliary",
                calls: 4,
                inputTokens: 4000,
            }),
            meter({
                date: "2026-08-30",
                userId: alice,
                calls: 1,
                inputTokens: 50,
                outputTokens: 50,
            }),
            // This month, for the allowance; outside the window.
            meter({ date: isoDay(new Date()), userId: alice, calls: 1, inputTokens: 7 }),
            // A July week with every kind, read back by the kinds test.
            meter({
                date: "2026-07-03",
                userId: alice,
                calls: 1,
                inputTokens: 1000,
                outputTokens: 200,
            }),
            meter({
                companyId: elsewhere,
                date: "2026-09-02",
                userId: alice,
                calls: 9,
                inputTokens: 9,
            }),
        ]);

        // Embeddings, searches and pages read, as the recorder writes them.
        const other = (kind: string, row: Record<string, unknown>) => ({
            companyId: workspace,
            date: "2026-07-03",
            userId: alice,
            feature: "ask",
            route: "",
            owner: "deployment",
            kind,
            outputTokens: 0,
            ...row,
        });
        await db.insert(aiUsageDaily).values([
            other("embedding", {
                feature: "ingestion",
                modelId: "text-embedding-3-large",
                calls: 2,
                inputTokens: 1_000_000,
                weightedTokens: 130_000,
                pricedCalls: 2,
                costUsd: "0.13",
            }),
            other("web_search", {
                modelId: "exa",
                calls: 2,
                inputTokens: 0,
                weightedTokens: 14_000,
                pricedCalls: 2,
                costUsd: "0.014",
            }),
            other("web_contents", {
                feature: "prospects",
                modelId: "exa",
                calls: 3,
                inputTokens: 0,
                weightedTokens: 6_000,
                pricedCalls: 3,
                costUsd: "0.006",
            }),
        ]);

        const session = (sessionId: string, owner: string, companyId = workspace) => ({
            id: `${sessionId}-${stamp}`,
            companyId,
            userId: owner,
            title: sessionId,
        });
        await db
            .insert(workspaceSessions)
            .values([
                session("s1", alice),
                session("s2", alice),
                session("s3", carol),
                session("s4", bob),
                session("s5", bob),
                session("s6", dave),
                session("sx", alice, elsewhere),
            ]);
        const turn = (
            sessionId: string,
            seq: number,
            createdAt: string,
            metadata: Record<string, unknown> | null,
            text = "a question",
            role: "user" | "assistant" = "user"
        ) => ({
            sessionId: `${sessionId}-${stamp}`,
            seq,
            role,
            text,
            metadata,
            createdAt: at(createdAt),
        });
        await db.insert(workspaceSessionMessages).values([
            turn("s1", 0, "2026-09-02T10:00:00Z", { id: "q1" }),
            turn("s1", 1, "2026-09-02T10:00:05Z", { id: "a1" }, "an answer", "assistant"),
            turn("s1", 2, "2026-09-03T11:00:00Z", { id: "q2" }),
            // "Fork from here" copies q1 under today's time, and goes on.
            turn("s2", 0, "2026-09-06T09:00:00Z", { id: "q1" }),
            turn("s2", 1, "2026-09-06T09:05:00Z", { id: "q3" }),
            // Carol continues Alice's chat: q1 stays Alice's.
            turn("s3", 0, "2026-09-02T10:00:00Z", { id: "q1", askedBy: alice }),
            turn("s3", 1, "2026-09-06T12:00:00Z", { id: "c1" }),
            // A turn from before client ids, and its server-side copy.
            turn("s4", 0, "2026-09-03T08:00:00Z", null, "hello"),
            turn("s5", 0, "2026-09-03T08:00:00Z", null, "hello"),
            turn("s6", 0, "2026-09-04T15:00:00Z", { id: "d1" }),
            turn("sx", 0, "2026-09-02T10:00:00Z", { id: "x1" }),
        ]);

        const activity = (
            actorUserId: string,
            verb: string,
            targetType: string,
            createdAt: string
        ) => ({
            companyId: workspace,
            actorUserId,
            verb,
            targetType,
            targetId: "1",
            targetLabel: "thing",
            createdAt: at(createdAt),
        });
        await db
            .insert(workspaceActivity)
            .values([
                activity(carol, "added", "document", "2026-09-06T08:00:00Z"),
                activity(carol, "added", "document", "2026-09-06T08:30:00Z"),
                activity(alice, "renamed", "document", "2026-09-02T08:00:00Z"),
                activity(alice, "added", "folder", "2026-09-02T08:00:00Z"),
                activity(bob, "added", "document", "2026-08-31T08:00:00Z"),
            ]);

        const docs = await db
            .insert(document)
            .values(
                // Added before the window: the documents list counts those that existed by its end.
                [
                    { url: "u1", category: "General", title: "Plan", companyId: workspace },
                    { url: "u2", category: "General", title: "Notes", companyId: workspace },
                    { url: "u3", category: "General", title: "Other", companyId: elsewhere },
                ].map(row => ({ ...row, createdAt: at("2026-08-01T00:00:00Z") }))
            )
            .returning({ id: document.id });
        doc1 = Number(docs[0]!.id);
        doc2 = Number(docs[1]!.id);
        const view = (
            documentId: number,
            userId: string,
            viewedAt: string,
            companyId = workspace
        ) => ({
            documentId: BigInt(documentId),
            userId,
            companyId,
            viewedAt: at(viewedAt),
        });
        await db
            .insert(documentViews)
            .values([
                view(doc1, alice, "2026-09-07T10:00:00Z"),
                view(doc1, alice, "2026-09-07T10:05:00Z"),
                view(doc1, bob, "2026-09-03T09:00:00Z"),
                view(doc2, carol, "2026-08-20T09:00:00Z"),
                view(doc2, alice, "2026-09-20T09:00:00Z"),
                view(Number(docs[2]!.id), alice, "2026-09-02T09:00:00Z", elsewhere),
            ]);
    });

    afterAll(async () => {
        if (workspace) await db.delete(company).where(eq(company.id, Number(workspace)));
        if (elsewhere) await db.delete(company).where(eq(company.id, Number(elsewhere)));
        await db.delete(users).where(inArray(users.userId, [alice, bob, carol, dave, pat]));
    });

    it("counts each source per person, in this workspace only", async () => {
        const summary = await usageSummary(ctx(), window, { person: null, group: null });
        expect(summary.totals).toMatchObject({
            // q1, q2, q3 (Alice), c1 (Carol), the legacy turn once (Bob), d1 (Dave).
            questions: 6,
            filesAdded: 2,
            docsOpened: 3,
            aiCalls: 9,
            aiTokens: 6400,
            activePeople: 4,
            // Sep 2, 3, 4, 6 and 7; Sep 5 had only an ingestion run no one started.
            activeDays: 5,
        });
        // $0.004 declared, and 5,200 unpriced tokens at the workspace's $10/M.
        expect(summary.totals.costUsd).toBeCloseTo(0.004 + 0.052, 10);
        expect(summary.previous).toMatchObject({ aiTokens: 100, filesAdded: 1, activePeople: 2 });
        expect(summary.daily).toHaveLength(7);
        expect(summary.daily.find(d => d.date === "2026-09-06")).toMatchObject({
            questions: 2,
            filesAdded: 2,
            activePeople: 2,
        });
        expect(summary.unattributedTokens).toBe(4000);
        expect(summary.workspaceOwnedCalls).toBe(1);
        expect(summary.members).toBe(3);
    });

    it("adds up: people + former members + unattributed = the workspace", async () => {
        const [summary, people] = await Promise.all([
            usageSummary(ctx(), window, { person: null, group: null }),
            usagePeople(ctx(), window, { group: null }),
        ]);
        expect(people.people.map(p => p.authUserId).sort()).toEqual([alice, bob, carol].sort());
        expect(people.formerMembers).toMatchObject({ questions: 1, aiCalls: 1, aiTokens: 100 });
        expect(people.unattributed).toMatchObject({ aiCalls: 4, aiTokens: 4000 });
        const rows: UsageCounts[] = [
            ...people.people.map(p => p.totals),
            people.formerMembers!,
            people.unattributed!,
        ];
        for (const key of [
            "questions",
            "filesAdded",
            "docsOpened",
            "aiCalls",
            "aiTokens",
            "inputTokens",
            "outputTokens",
        ] as const) {
            expect([key, rows.reduce((t, r) => t + r[key], 0)]).toEqual([key, summary.totals[key]]);
        }
        expect(rows.reduce((t, r) => t + (r.costUsd ?? 0), 0)).toBeCloseTo(
            summary.totals.costUsd!,
            10
        );
    });

    it("lists each member with their allowance and groups", async () => {
        const people = await usagePeople(ctx(), window, { group: null });
        const a = people.people.find(p => p.authUserId === alice)!;
        expect(a).toMatchObject({
            role: "owner",
            isSelf: true,
            topFeature: "ask",
            activeDays: 4,
            totals: { questions: 3, docsOpened: 2, aiCalls: 3, aiTokens: 1700 },
        });
        // The allowance is this month's, whatever the window.
        expect(a.allowance.used).toBeGreaterThanOrEqual(7);
        expect(people.groups).toEqual([{ id: groupId, name: "Design" }]);
        const c = people.people.find(p => p.authUserId === carol)!;
        expect(c.groups).toEqual([{ id: groupId, name: "Design" }]);
        expect(people.people.find(p => p.authUserId === bob)!.status).toBe("suspended");
    });

    it("narrows to a group or a person", async () => {
        const group = await usagePeople(ctx(), window, { group: groupId });
        expect(group.people.map(p => p.authUserId)).toEqual([carol]);
        expect(group.formerMembers).toBeNull();
        expect(group.unattributed).toBeNull();

        const summary = await usageSummary(ctx(), window, { person: null, group: groupId });
        expect(summary.totals).toMatchObject({ questions: 1, filesAdded: 2, aiCalls: 0 });
        expect(summary.unattributedTokens).toBe(0);

        const people = await usagePeople(ctx(), window, { group: null });
        const bobRow = people.people.find(p => p.authUserId === bob)!;
        const one = await usageSummary(ctx(), window, { person: bobRow.memberId, group: null });
        expect(one.scope).toMatchObject({ kind: "person", memberId: bobRow.memberId });
        expect(one.totals).toMatchObject({ questions: 1, docsOpened: 1, aiTokens: 600 });
    });

    it("logs AI use by day, person, feature and route, newest first", async () => {
        const result = await usageActivity(ctx(), window, {
            person: null,
            feature: null,
            offset: 0,
            limit: 100,
        });
        expect(result.total).toBe(4);
        expect(
            result.rows.map(r => [
                r.date,
                r.feature,
                r.person === null ? null : r.person === "former" ? "former" : "member",
            ])
        ).toEqual([
            ["2026-09-05", "ingestion", null],
            ["2026-09-04", "ask", "former"],
            ["2026-09-03", "documentWriter", "member"],
            ["2026-09-02", "ask", "member"],
        ]);
        expect(result.rows[3]).toMatchObject({ calls: 3, inputTokens: 1500, owner: "deployment" });
        expect(result.rows[2]).toMatchObject({ owner: "workspace", route: "reasoning" });
        expect(JSON.stringify(result)).not.toContain("vendor/");

        const ask = await usageActivity(ctx(), window, {
            person: null,
            feature: "ask",
            offset: 1,
            limit: 1,
        });
        expect(ask).toMatchObject({ total: 2, offset: 1, limit: 1 });
        expect(ask.rows.map(r => r.date)).toEqual(["2026-09-02"]);
    });

    it("reads every kind back in chat-token equivalents, with each kind's own units", async () => {
        const july = parseUsageWindow(new URLSearchParams("from=2026-07-01&to=2026-07-07"));
        if (!july.ok) throw new Error(july.error);
        const summary = await usageSummary(ctx(), july.window, { person: null, group: null });
        expect(summary.totals).toMatchObject({
            aiTokens: 1_200 + 130_000 + 14_000 + 6_000,
            aiSplit: { chat: 1_200, embedding: 130_000, search: 20_000 },
            // One chat call, two embedding requests, two searches; pages read aren't requests.
            aiCalls: 5,
            chatCalls: 1,
            inputTokens: 1000,
            outputTokens: 200,
            embeddedTokens: 1_000_000,
            searches: 2,
            pages: 3,
        });
        // The priced rows' own cost, plus the unpriced chat call's 1,200 at the workspace's $10 per 1M.
        expect(summary.totals.costUsd).toBeCloseTo(0.13 + 0.014 + 0.006 + 0.012, 9);
        expect(summary.byRoute.map(r => r.route)).toEqual(["default"]);
        expect(summary.byFeature.map(f => [f.feature, f.aiTokens])).toEqual([
            ["ingestion", 130_000],
            ["ask", 15_200],
            ["prospects", 6_000],
        ]);
        expect(summary.rates).toMatchObject({ embeddingPerMillion: 130_000, perSearch: 7_000 });
    });

    it("lists the documents in scope, most opened first", async () => {
        const result = await usageDocuments(ctx(), window, { limit: 50 });
        expect(result.totalDocuments).toBe(2);
        expect(result.totalViews).toBe(3);
        expect(result.documents).toEqual([
            {
                id: doc1,
                title: "Plan",
                category: "General",
                views: 3,
                viewers: 2,
                lastViewedAt: "2026-09-07T10:05:00.000Z",
                createdAt: expect.any(String),
            },
            {
                id: doc2,
                title: "Notes",
                category: "General",
                views: 0,
                viewers: 0,
                // Its last open up to the window's end, not the later one.
                lastViewedAt: "2026-08-20T09:00:00.000Z",
                createdAt: expect.any(String),
            },
        ]);
        expect(result.trend.filter(p => p.views > 0)).toEqual([
            { date: "2026-09-03", views: 1 },
            { date: "2026-09-07", views: 2 },
        ]);

        // A reader kept out of the Plan sees neither it nor its opens.
        const restricted = await usageDocuments(
            makeWorkspaceContext({
                authUserId: carol,
                companyId: workspace,
                role: "member",
                scope: {
                    kind: "except",
                    deniedCategories: [],
                    deniedDocumentIds: [doc1],
                    allowedDocumentIds: [],
                },
            }),
            window,
            { limit: 50 }
        );
        expect(restricted.totalDocuments).toBe(1);
        expect(restricted.totalViews).toBe(0);
        expect(restricted.documents.map(d => d.id)).toEqual([doc2]);
    });

    it("gives a member their own numbers and the median, and no one else's", async () => {
        const me = await usageMe(
            makeWorkspaceContext({
                authUserId: carol,
                userPk: carolPk,
                companyId: workspace,
                role: "member",
            }),
            window,
            new Date("2026-09-07T20:00:00Z")
        );
        expect(me.summary.scope).toMatchObject({ kind: "person" });
        expect(me.summary.totals).toMatchObject({ questions: 1, filesAdded: 2, activeDays: 1 });
        expect(me.members).toBe(3);
        // Questions: Alice 3, Bob 1, Carol 1. Files: 0, 0, 2. Active days: 4, 1, 1.
        expect(me.median).toEqual({
            questions: 1,
            filesAdded: 0,
            docsOpened: 1,
            aiTokens: 600,
            activeDays: 1,
        });
        expect(me.streak).toEqual({ current: 1, longest: 1 });
        const wire = JSON.stringify(me);
        for (const other of [alice, bob, dave]) expect(wire).not.toContain(other);
    });
});
