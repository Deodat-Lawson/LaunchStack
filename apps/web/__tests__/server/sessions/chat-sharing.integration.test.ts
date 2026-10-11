/**
 * Shared chats against a real Postgres (ADR-014 §4–5): who can read a chat,
 * what a reader sees of its evidence, sharing, continuing as a fork, and each
 * person's own pins, archive and unread state in the History feed.
 *
 * The predicates are the point — a fake database can't tell an owner from a
 * reader from a stranger — so this runs on a throwaway database migrated with
 * both ledgers. Gated like the other integration suites: it runs only when
 * LAUNCHSTACK_TEST_DATABASE_URL (or DATABASE_URL) points at a local server.
 */

import { and, eq } from "drizzle-orm";

import { category, company, document } from "@launchstack/store/schema";
import type { DbClient } from "@launchstack/store/client";
import { builtinRolePermissions } from "~/lib/authz/permissions";
import { resolveDocumentScope } from "~/lib/authz/scope";
import type { DocumentScope } from "~/lib/authz/scope-types";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import {
    folderGrants,
    folderSettings,
    mindmaps,
    userCompanyMemberships,
    users,
    workspaceActivity,
    workspaceGroupMembers,
    workspaceGroups,
    workspaceNotifications,
    workspaceSessionMessages,
    workspaceSessions,
    workspaceSessionUserState,
} from "~/server/db/schema";
import { loadWorkspaceHistory } from "~/server/history";
import { forkSession } from "~/server/sessions/fork";
import { readSession } from "~/server/sessions/reader";
import { getChatSharing, setChatSharing } from "~/server/sessions/sharing";
import { reorderPins, setSessionState } from "~/server/sessions/user-state";
import { isWorkspaceError } from "~/server/workspace/errors";

import { createFounderWeeklyReviewTestDatabase } from "../../founderWeeklyReview/testDb";

let mockActiveDb: DbClient | null = null;
jest.mock("~/server/db", () => ({
    get db() {
        if (!mockActiveDb) throw new Error("test database not ready");
        return mockActiveDb;
    },
}));
// The pipeline loaders read tables this suite never fills; History here is about chats.
jest.mock("~/server/history/loaders", () => ({ PIPELINE_LOADERS: [] }));

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

describeDb("shared chats (integration)", () => {
    jest.setTimeout(120_000);

    let test: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyId: bigint;
    const pk: Record<string, bigint> = {};
    let salesGroup: bigint;
    let dPublic: string;
    let dSecret: string;
    let mOpen: string;
    let mSecret: string;

    /** A fresh context each call: the scope is memoised per request, as in the app. */
    function ctx(name: "ada" | "bea" | "cy" | "dee" | "gus"): WorkspaceContext {
        const role = name === "gus" ? "guest" : name === "ada" ? "owner" : "member";
        const permissions = builtinRolePermissions(role)!;
        let scope: Promise<DocumentScope> | null = null;
        return {
            authUserId: `auth_${name}`,
            userPk: pk[name]!,
            companyId,
            role,
            status: "active",
            permissions,
            can: p => permissions.has(p),
            documentScope: () =>
                (scope ??= resolveDocumentScope({
                    companyId,
                    userPk: pk[name]!,
                    role,
                    permissions,
                })),
        };
    }

    async function makeChat(owner: string, title: string, at: Date): Promise<string> {
        const id = `chat-${title.toLowerCase().replace(/\W+/g, "-")}`;
        await test.db.insert(workspaceSessions).values({
            id,
            companyId,
            userId: owner,
            title,
            contextSourceIds: [dPublic, dSecret],
            continuation: { title: "Imported", context: "secret transcript tail" },
            queuedMessages: [
                {
                    id: "q1",
                    send: {
                        text: "my unsent draft",
                        refs: [],
                        attachments: [],
                        webSearch: false,
                        thinking: false,
                        agentKey: null,
                    },
                },
            ],
            messageCount: 2,
            lastMessageAt: at,
            createdAt: at,
            updatedAt: at,
        });
        await test.db.insert(workspaceSessionMessages).values([
            {
                sessionId: id,
                seq: 0,
                role: "user",
                text: "What is the cap?",
                refs: [dPublic, dSecret],
                metadata: {
                    id: "m0",
                    send: {
                        text: "What is the cap?",
                        refs: [dPublic, dSecret],
                        attachments: [],
                        webSearch: true,
                        thinking: true,
                        agentKey: null,
                    },
                },
            },
            {
                sessionId: id,
                seq: 1,
                role: "assistant",
                text: "Five million.",
                refs: [dPublic, dSecret],
                citations: [
                    { sourceId: dPublic, snippet: "handbook says five" },
                    { sourceId: dSecret, snippet: "LEDGER-SNIPPET", matchText: "LEDGER-MATCH" },
                    { sourceId: mOpen, snippet: "open map" },
                    { sourceId: mSecret, snippet: "SECRET-MAP-SNIPPET" },
                    { snippet: "no source id at all" },
                ],
            },
        ]);
        return id;
    }

    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        mockActiveDb = test.db;

        const [co] = await test.db
            .insert(company)
            .values({ name: "Acme", numberOfEmployees: "20" })
            .returning();
        companyId = BigInt(co!.id);

        for (const [name, role] of [
            ["ada", "owner"],
            ["bea", "member"],
            ["cy", "member"],
            ["dee", "member"],
            ["gus", "guest"],
        ] as const) {
            const [u] = await test.db
                .insert(users)
                .values({
                    name: name.toUpperCase(),
                    email: `${name}@acme.test`,
                    userId: `auth_${name}`,
                    companyId,
                })
                .returning();
            const userPk = BigInt(u!.id);
            pk[name] = userPk;
            await test.db
                .insert(userCompanyMemberships)
                .values({ userId: userPk, companyId, role, status: "active" });
        }

        const [grp] = await test.db
            .insert(workspaceGroups)
            .values({ companyId, name: "Sales", slug: "sales", createdBy: "auth_ada" })
            .returning();
        salesGroup = BigInt(grp!.id);
        await test.db
            .insert(workspaceGroupMembers)
            .values({ groupId: salesGroup, userId: pk.dee!, addedBy: "auth_ada" });

        // Finance is restricted to Ada; General is everyone's.
        const [finance] = await test.db
            .insert(category)
            .values({ name: "Finance", companyId })
            .returning();
        await test.db.insert(category).values({ name: "General", companyId });
        await test.db.insert(folderSettings).values({
            categoryId: BigInt(finance!.id),
            companyId,
            visibility: "restricted",
            updatedBy: "auth_ada",
        });
        await test.db.insert(folderGrants).values({
            companyId,
            categoryId: BigInt(finance!.id),
            principalType: "user",
            principalId: pk.ada!.toString(),
            level: "manage",
            grantedBy: "auth_ada",
        });

        const mkDoc = async (title: string, cat: string) => {
            const [d] = await test.db
                .insert(document)
                .values({ companyId, url: `local://${title}`, category: cat, title })
                .returning();
            return d!.id;
        };
        const handbook = await mkDoc("Handbook", "General");
        const ledger = await mkDoc("Ledger", "Finance");
        dPublic = `d${handbook}`;
        dSecret = `d${ledger}`;

        const mkMap = async (title: string, published: number | null) => {
            const [m] = await test.db
                .insert(mindmaps)
                .values({
                    companyId,
                    createdByUserId: "auth_ada",
                    title,
                    doc: {},
                    publishedDocumentId: published === null ? null : BigInt(published),
                })
                .returning();
            return `m${m!.id}`;
        };
        mOpen = await mkMap("Open map", null);
        // Published into the restricted folder: its citations quote the Ledger copy.
        mSecret = await mkMap("Finance map", ledger);
    });

    afterAll(async () => {
        mockActiveDb = null;
        await test?.close();
    });

    async function expectWorkspaceError(promise: Promise<unknown>, status: number) {
        const error = await promise.then(
            () => null,
            (e: unknown) => e
        );
        expect(isWorkspaceError(error)).toBe(true);
        expect((error as { status: number }).status).toBe(status);
    }

    describe("reading and sharing", () => {
        let chat: string;

        beforeAll(async () => {
            chat = await makeChat("auth_ada", "Indemnity cap", new Date("2026-10-09T10:00:00Z"));
        });

        it("is private by default: the owner reads it whole, nobody else can tell it exists", async () => {
            const own = await readSession(ctx("ada"), chat);
            expect(own?.access).toEqual({
                level: "owner",
                ownerAuthUserId: "auth_ada",
                sharedAt: null,
            });
            expect(own?.messages[1]?.citations).toHaveLength(5);
            expect(own?.queuedMessages).toHaveLength(1);
            expect(own?.hiddenCitations).toBe(0);

            expect(await readSession(ctx("bea"), chat)).toBeNull();
            expect(await readSession(ctx("cy"), chat)).toBeNull();
            await expectWorkspaceError(getChatSharing(ctx("bea"), chat), 404);
        });

        it("lets only the owner change who can read it", async () => {
            await expectWorkspaceError(
                setChatSharing(ctx("bea"), chat, { general: "workspace", grants: [] }),
                404
            );
        });

        it("shares with a person and a group, notifies them, and records it once", async () => {
            const view = await setChatSharing(ctx("ada"), chat, {
                general: "private",
                grants: [
                    { principalType: "user", principalId: pk.bea!.toString() },
                    { principalType: "group", principalId: salesGroup.toString() },
                    // Naming yourself is dropped, not stored.
                    { principalType: "user", principalId: pk.ada!.toString() },
                ],
            });

            expect(view).toMatchObject({
                general: "private",
                canManage: true,
                owner: { authUserId: "auth_ada", name: "ADA" },
                workspaceName: "Acme",
                // Ada, Bea, and Dee through Sales.
                audienceCount: 3,
            });
            expect(view.grants.map(g => [g.principalType, g.principalName, g.level])).toEqual([
                ["user", "BEA", "view"],
                ["group", "Sales", "view"],
            ]);

            const [row] = await test.db
                .select({ sharedAt: workspaceSessions.sharedAt })
                .from(workspaceSessions)
                .where(eq(workspaceSessions.id, chat));
            expect(row?.sharedAt).not.toBeNull();

            const told = await test.db
                .select()
                .from(workspaceNotifications)
                .where(eq(workspaceNotifications.targetId, chat));
            expect(told.map(n => n.recipientUserId).sort()).toEqual(["auth_bea", "auth_dee"]);
            expect(told.every(n => n.targetType === "chat" && n.actorUserId === "auth_ada")).toBe(
                true
            );

            const feed = await test.db
                .select()
                .from(workspaceActivity)
                .where(eq(workspaceActivity.targetId, chat));
            expect(feed).toEqual([
                expect.objectContaining({
                    verb: "shared",
                    targetType: "chat",
                    targetLabel: "Indemnity cap",
                }),
            ]);

            // Saving the same set again changes nothing and says nothing.
            await setChatSharing(ctx("ada"), chat, {
                general: "private",
                grants: [
                    { principalType: "user", principalId: pk.bea!.toString() },
                    { principalType: "group", principalId: salesGroup.toString() },
                ],
            });
            expect(
                await test.db
                    .select()
                    .from(workspaceActivity)
                    .where(eq(workspaceActivity.targetId, chat))
            ).toHaveLength(1);
        });

        it("rejects a principal from outside the workspace", async () => {
            await expectWorkspaceError(
                setChatSharing(ctx("ada"), chat, {
                    general: "private",
                    grants: [{ principalType: "user", principalId: "999999" }],
                }),
                400
            );
        });

        it("gives a reader the live transcript with everything outside their scope removed", async () => {
            const read = await readSession(ctx("bea"), chat);
            expect(read).not.toBeNull();
            expect(read!.access).toMatchObject({ level: "view", ownerAuthUserId: "auth_ada" });
            expect(read!.access.sharedAt).not.toBeNull();

            const answer = read!.messages[1]!;
            expect(answer.text).toBe("Five million.");
            expect(answer.citations).toEqual([
                { sourceId: dPublic, snippet: "handbook says five" },
                { sourceId: mOpen, snippet: "open map" },
            ]);
            expect(answer.hiddenCitations).toBe(3);
            expect(read!.hiddenCitations).toBe(3);
            expect(answer.refs).toEqual([dPublic]);
            expect(read!.messages[0]!.refs).toEqual([dPublic]);
            expect(read!.messages[0]!.metadata?.send?.refs).toEqual([dPublic]);
            expect(read!.contextSourceIds).toEqual([dPublic]);
            // The owner's drafts and imported context stay theirs.
            expect(read!.queuedMessages).toEqual([]);
            expect(read!.continuation).toBeNull();

            const wire = JSON.stringify(read);
            expect(wire).not.toContain("LEDGER-SNIPPET");
            expect(wire).not.toContain("LEDGER-MATCH");
            expect(wire).not.toContain("SECRET-MAP-SNIPPET");
            expect(wire).not.toContain(dSecret);
            expect(wire).not.toContain("my unsent draft");
            expect(wire).not.toContain("secret transcript tail");
        });

        it("shows a reader who has access, but not the controls", async () => {
            const view = await getChatSharing(ctx("bea"), chat);
            expect(view.canManage).toBe(false);
            expect(view.grants).toHaveLength(2);
            // A reader already knows it exists: 403, not 404.
            await expectWorkspaceError(
                setChatSharing(ctx("bea"), chat, { general: "workspace", grants: [] }),
                403
            );
        });

        it("opens to everyone but guests with General access, and closes again", async () => {
            expect(await readSession(ctx("cy"), chat)).toBeNull();
            const open = await setChatSharing(ctx("ada"), chat, {
                general: "workspace",
                grants: [],
            });
            expect(open.general).toBe("workspace");
            expect(open.grants).toEqual([]);
            // Everyone but Gus the guest.
            expect(open.audienceCount).toBe(4);
            expect(await readSession(ctx("cy"), chat)).not.toBeNull();
            expect(await readSession(ctx("bea"), chat)).not.toBeNull();
            expect(await readSession(ctx("gus"), chat)).toBeNull();

            const closed = await setChatSharing(ctx("ada"), chat, {
                general: "private",
                grants: [],
            });
            expect(closed.audienceCount).toBe(1);
            expect(await readSession(ctx("cy"), chat)).toBeNull();
            expect(await readSession(ctx("bea"), chat)).toBeNull();

            const [row] = await test.db
                .select({ sharedAt: workspaceSessions.sharedAt })
                .from(workspaceSessions)
                .where(eq(workspaceSessions.id, chat));
            expect(row?.sharedAt).toBeNull();
            const verbs = (
                await test.db
                    .select({ verb: workspaceActivity.verb })
                    .from(workspaceActivity)
                    .where(eq(workspaceActivity.targetId, chat))
            ).map(r => r.verb);
            expect(verbs).toEqual(["shared", "shared", "unshared"]);
        });
    });

    describe("continuing in a new chat", () => {
        let chat: string;

        beforeAll(async () => {
            chat = await makeChat("auth_ada", "Vendor review", new Date("2026-10-08T10:00:00Z"));
            await setChatSharing(ctx("ada"), chat, {
                general: "private",
                grants: [{ principalType: "user", principalId: pk.bea!.toString() }],
            });
        });

        it("refuses someone the chat isn't shared with", async () => {
            expect(await forkSession(ctx("cy"), chat)).toBeNull();
        });

        it("copies what the reader could see into a private chat of their own", async () => {
            const fork = await forkSession(ctx("bea"), chat);
            expect(fork).toEqual({ id: expect.any(String), title: "Vendor review (copy)" });

            const [row] = await test.db
                .select()
                .from(workspaceSessions)
                .where(eq(workspaceSessions.id, fork!.id));
            expect(row).toMatchObject({
                userId: "auth_bea",
                companyId,
                forkedFromSessionId: chat,
                messageCount: 2,
                contextSourceIds: [dPublic],
                continuation: null,
                sharedAt: null,
            });

            const copied = await readSession(ctx("bea"), fork!.id);
            expect(copied?.access.level).toBe("owner");
            expect(copied?.messages.map(m => m.text)).toEqual([
                "What is the cap?",
                "Five million.",
            ]);
            expect(copied?.messages[0]?.metadata?.forkedFromSessionId).toBe(chat);
            // Ada's question stays Ada's in Bea's copy; the answer has no asker.
            expect(copied?.messages[0]?.metadata?.askedBy).toBe("auth_ada");
            expect(copied?.messages[1]?.metadata?.askedBy).toBeUndefined();
            expect(copied?.messages[1]?.citations).toEqual([
                { sourceId: dPublic, snippet: "handbook says five" },
                { sourceId: mOpen, snippet: "open map" },
            ]);
            expect(JSON.stringify(copied)).not.toContain("LEDGER");

            // Private: Ada can't read Bea's copy.
            expect(await readSession(ctx("ada"), fork!.id)).toBeNull();

            const forked = await test.db
                .select()
                .from(workspaceActivity)
                .where(
                    and(eq(workspaceActivity.targetId, chat), eq(workspaceActivity.verb, "forked"))
                );
            expect(forked).toEqual([expect.objectContaining({ actorUserId: "auth_bea" })]);
        });

        it("lets the owner fork their own chat quietly, keeping the imported context", async () => {
            const fork = await forkSession(ctx("ada"), chat);
            const [row] = await test.db
                .select()
                .from(workspaceSessions)
                .where(eq(workspaceSessions.id, fork!.id));
            expect(row?.continuation).toEqual({
                title: "Imported",
                context: "secret transcript tail",
            });
            const own = await readSession(ctx("ada"), fork!.id);
            // Ada can open the Ledger, so her copy keeps its citation.
            expect(own?.messages[1]?.citations).toHaveLength(4);
            const forked = await test.db
                .select()
                .from(workspaceActivity)
                .where(
                    and(
                        eq(workspaceActivity.verb, "forked"),
                        eq(workspaceActivity.actorUserId, "auth_ada")
                    )
                );
            expect(forked).toHaveLength(0);
        });
    });

    describe("organising History", () => {
        let adaShared: string;
        let adaPrivate: string;
        let beaOwn: string;
        let beaOld: string;

        beforeAll(async () => {
            adaShared = await makeChat(
                "auth_ada",
                "Pricing memo",
                new Date("2026-10-10T09:00:00Z")
            );
            adaPrivate = await makeChat(
                "auth_ada",
                "Ada private",
                new Date("2026-10-10T08:00:00Z")
            );
            beaOwn = await makeChat("auth_bea", "Bea notes", new Date("2026-10-10T07:00:00Z"));
            beaOld = await makeChat("auth_bea", "Bea old", new Date("2025-01-01T00:00:00Z"));
            await setChatSharing(ctx("ada"), adaShared, {
                general: "private",
                grants: [{ principalType: "user", principalId: pk.bea!.toString() }],
            });
        });

        const history = (
            name: "ada" | "bea" | "cy",
            extra: { archived?: boolean; limit?: number } = {}
        ) =>
            loadWorkspaceHistory({
                companyId,
                userId: `auth_${name}`,
                actor: ctx(name),
                ...extra,
            });

        it("puts chats shared with me in my feed, unread until I open them", async () => {
            const page = await history("bea");
            const shared = page.entries.find(e => e.refId === adaShared);
            expect(shared).toMatchObject({
                kind: "chat",
                sharedBy: "auth_ada",
                unread: true,
                pinned: false,
                archived: false,
            });
            expect(page.entries.find(e => e.refId === adaPrivate)).toBeUndefined();
            expect(page.entries.find(e => e.refId === beaOwn)).toMatchObject({ shared: false });
            expect(page.entries.find(e => e.refId === beaOwn)?.sharedBy).toBeUndefined();
            // Newest activity first.
            const at = page.entries.map(e => Date.parse(e.at));
            expect([...at].sort((a, b) => b - a)).toEqual(at);

            await setSessionState(ctx("bea"), adaShared, { seen: true });
            const after = await history("bea");
            expect(after.entries.find(e => e.refId === adaShared)?.unread).toBe(false);
        });

        it("marks my own chat as shared once someone else can read it", async () => {
            const page = await history("ada");
            expect(page.entries.find(e => e.refId === adaShared)?.shared).toBe(true);
            expect(page.entries.find(e => e.refId === adaPrivate)?.shared).toBe(false);
        });

        it("keeps state per person and refuses strangers", async () => {
            expect(await setSessionState(ctx("cy"), adaShared, { pinned: true })).toBeNull();

            const first = await setSessionState(ctx("bea"), beaOwn, { pinned: true });
            expect(first).toMatchObject({ pinned: true, pinRank: 0, archived: false });
            const second = await setSessionState(ctx("bea"), adaShared, { pinned: true });
            // A new pin lands on top.
            expect(second?.pinRank).toBe(-1);

            // Bea's pin on Ada's chat is Bea's alone.
            const adaPage = await history("ada");
            expect(adaPage.entries.find(e => e.refId === adaShared)?.pinned).toBe(false);
        });

        it("always returns pins, however old, and rewrites the pin order", async () => {
            await setSessionState(ctx("bea"), beaOld, { pinned: true });
            const page = await history("bea", { limit: 2 });
            const pins = page.entries.filter(e => e.pinned);
            expect(pins.map(e => e.refId).sort()).toEqual([adaShared, beaOld, beaOwn].sort());
            expect(page.entries.find(e => e.refId === beaOld)?.pinRank).toBe(-2);

            expect(await reorderPins(ctx("bea"), [beaOwn, "not-a-pin", adaShared])).toEqual([
                beaOwn,
                adaShared,
                beaOld,
            ]);
            const reordered = await history("bea");
            const ranks = Object.fromEntries(
                reordered.entries.filter(e => e.pinned).map(e => [e.refId, e.pinRank])
            );
            expect(ranks).toEqual({ [beaOwn]: 0, [adaShared]: 1, [beaOld]: 2 });

            // Someone else's reorder never touches Bea's rows.
            await reorderPins(ctx("ada"), [beaOld]);
            const [row] = await test.db
                .select({ rank: workspaceSessionUserState.pinRank })
                .from(workspaceSessionUserState)
                .where(
                    and(
                        eq(workspaceSessionUserState.sessionId, beaOld),
                        eq(workspaceSessionUserState.userId, "auth_bea")
                    )
                );
            expect(row?.rank).toBe(2);
        });

        it("hides archived chats from the list and shows them in the Archived view", async () => {
            const archived = await setSessionState(ctx("bea"), adaShared, { archived: true });
            // Archiving unpins.
            expect(archived).toMatchObject({ archived: true, pinned: false, pinRank: null });

            const page = await history("bea");
            expect(page.entries.find(e => e.refId === adaShared)).toBeUndefined();
            expect(page.archivedCount).toBe(1);

            const view = await history("bea", { archived: true });
            expect(view.entries.map(e => e.refId)).toEqual([adaShared]);
            expect(view.entries[0]).toMatchObject({ archived: true, sharedBy: "auth_ada" });
            expect(view.archivedCount).toBeNull();

            // Archive is per person: Ada still sees her chat.
            expect((await history("ada")).entries.find(e => e.refId === adaShared)).toBeDefined();

            await setSessionState(ctx("bea"), adaShared, { archived: false });
            expect((await history("bea")).entries.find(e => e.refId === adaShared)).toBeDefined();
        });

        it("drops a chat from my feed when it stops being shared with me", async () => {
            await setChatSharing(ctx("ada"), adaShared, { general: "private", grants: [] });
            const page = await history("bea");
            expect(page.entries.find(e => e.refId === adaShared)).toBeUndefined();
        });
    });
});
