/** @jest-environment node */

/**
 * The feedback store against a real, migrated Postgres: the migration, the
 * visibility rules in the queries (a bug is its reporter's and the
 * triagers'; an idea is everyone's, without its author), votes, the thread,
 * status changes, and the inbox row the reporter gets.
 *
 * Cast: Ada files a bug and an idea from Acme. Bob reads the board and files
 * an idea of his own. Olu triages (named in FEEDBACK_ADMIN_EMAILS, with a
 * sign-in account but no product profile). Cai has only an account.
 */

jest.mock("server-only", () => ({}), { virtual: true });

import type { DbClient } from "@launchstack/store/client";
import { company } from "@launchstack/store/schema";
import { and, eq } from "drizzle-orm";

import { buildWorkspaceContext } from "~/lib/require-workspace-context";
import {
    authUser,
    feedbackReports,
    feedbackVotes,
    userCompanyMemberships,
    users,
    workspaceNotifications,
} from "~/server/db/schema";
import { isWorkspaceError } from "~/server/workspace/errors";

import {
    createFounderWeeklyReviewTestDatabase,
    type FounderWeeklyReviewTestDatabase,
} from "../../founderWeeklyReview/testDb";

let mockDb: DbClient;
jest.mock("~/server/db", () => ({
    get db() {
        return mockDb;
    },
}));

// Imported after the mock so they bind to the test database.
import {
    createFeedbackReport,
    getFeedbackReport,
    listFeedback,
    readFeedbackAttachment,
    replyToFeedback,
    setFeedbackVote,
    updateFeedbackReport,
    type FeedbackViewer,
} from "~/server/feedback/store";
import { listNotifications } from "~/server/workspace/notifications";

const describeIfDatabase =
    (process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL)
        ? describe
        : describe.skip;

const ada: FeedbackViewer = { authUserId: "auth-ada", triager: false };
const bob: FeedbackViewer = { authUserId: "auth-bob", triager: false };
const olu: FeedbackViewer = { authUserId: "auth-olu", triager: true };
const cai: FeedbackViewer = { authUserId: "auth-cai", triager: false };

const screenshot = {
    data: Buffer.from("RIFF-webp-bytes"),
    contentType: "image/webp" as const,
    width: 1280,
    height: 800,
    byteSize: 15,
};

async function status(promise: Promise<unknown>): Promise<number> {
    try {
        await promise;
    } catch (error) {
        if (isWorkspaceError(error)) return error.status;
        throw error;
    }
    return 200;
}

describeIfDatabase("feedback store (Postgres)", () => {
    jest.setTimeout(120_000);

    let database: FounderWeeklyReviewTestDatabase;
    let acme: bigint;
    let adaPk: bigint;
    let bug: number;
    let adaIdea: number;
    let bobIdea: number;
    const envBefore = process.env.FEEDBACK_ADMIN_EMAILS;

    beforeAll(async () => {
        process.env.FEEDBACK_ADMIN_EMAILS = "OLU@example.com, someone-else@example.com";
        database = await createFounderWeeklyReviewTestDatabase();
        mockDb = database.db;

        const [made] = await mockDb
            .insert(company)
            .values({ name: "Acme", numberOfEmployees: "1-10" })
            .returning({ id: company.id });
        acme = BigInt(made!.id);

        const people = [
            { who: "ada", displayName: "Ada L", name: "Ada Lovelace" },
            { who: "bob", displayName: null, name: "Bob Builder" },
        ];
        for (const person of people) {
            const [row] = await mockDb
                .insert(users)
                .values({
                    userId: `auth-${person.who}`,
                    name: person.name,
                    displayName: person.displayName,
                    email: `${person.who}@example.com`,
                    companyId: acme,
                })
                .returning({ id: users.id });
            await mockDb
                .insert(userCompanyMemberships)
                .values({ userId: BigInt(row!.id), companyId: acme, role: "member" });
            if (person.who === "ada") adaPk = BigInt(row!.id);
        }
        const now = new Date();
        await mockDb.insert(authUser).values([
            {
                id: "auth-ada",
                name: "Ada Lovelace",
                email: "ada@example.com",
                createdAt: now,
                updatedAt: now,
            },
            {
                id: "auth-olu",
                name: "Olu from Ops",
                email: "olu@example.com",
                createdAt: now,
                updatedAt: now,
            },
            { id: "auth-cai", name: "", email: "cai@example.com", createdAt: now, updatedAt: now },
        ]);
    });

    afterAll(async () => {
        if (envBefore === undefined) delete process.env.FEEDBACK_ADMIN_EMAILS;
        else process.env.FEEDBACK_ADMIN_EMAILS = envBefore;
        await database?.close();
    });

    it("files reports, stamping the server's context and casting an idea's first vote", async () => {
        const created = await createFeedbackReport({
            reporter: { ...ada, companyId: acme },
            input: {
                kind: "bug",
                title: "Upload fails at 100%_done",
                body: "The spinner never stops on large PDFs.",
                severity: "blocking",
                context: { path: "/employer/documents", browser: "Chrome 141 on macOS" },
            },
            images: [screenshot],
        });
        bug = created.id;
        expect(created).toEqual({
            id: bug,
            kind: "bug",
            title: "Upload fails at 100%_done",
            severity: "blocking",
        });

        adaIdea = (
            await createFeedbackReport({
                reporter: { ...ada, companyId: null },
                input: {
                    kind: "idea",
                    title: "Dark mode for exports",
                    body: "",
                    severity: "annoying",
                    context: {},
                },
                images: [],
            })
        ).id;
        bobIdea = (
            await createFeedbackReport({
                reporter: { ...bob, companyId: acme },
                input: { kind: "idea", title: "Keyboard shortcuts", body: "Vim keys", context: {} },
                images: [],
            })
        ).id;

        const [stored] = await mockDb
            .select()
            .from(feedbackReports)
            .where(eq(feedbackReports.id, bug));
        expect(stored!.context).toMatchObject({
            path: "/employer/documents",
            workspaceName: "Acme",
            appVersion: expect.any(String),
        });
        expect(stored!.companyId).toBe(acme);
        expect(stored!.status).toBe("new");

        const [idea] = await mockDb
            .select()
            .from(feedbackReports)
            .where(eq(feedbackReports.id, adaIdea));
        // Ideas have no severity, whatever the client sent; the author's vote is in.
        expect(idea!.severity).toBeNull();
        expect(idea!.companyId).toBeNull();
        expect(idea!.voteCount).toBe(1);
        const votes = await mockDb
            .select()
            .from(feedbackVotes)
            .where(eq(feedbackVotes.reportId, adaIdea));
        expect(votes.map(v => v.userId)).toEqual(["auth-ada"]);
    });

    it("refuses new reports while nobody triages", async () => {
        const saved = process.env.FEEDBACK_ADMIN_EMAILS;
        process.env.FEEDBACK_ADMIN_EMAILS = "";
        try {
            await expect(
                status(
                    createFeedbackReport({
                        reporter: { ...ada, companyId: acme },
                        input: { kind: "bug", title: "x", body: "", context: {} },
                        images: [],
                    })
                )
            ).resolves.toBe(403);
        } finally {
            process.env.FEEDBACK_ADMIN_EMAILS = saved;
        }
    });

    it("lists each scope for whoever is asking", async () => {
        const ids = (items: { id: number }[]) => items.map(item => item.id).sort();
        const defaults = { sort: "recent" as const, limit: 50 };

        expect(ids(await listFeedback(ada, { scope: "mine", ...defaults }))).toEqual(
            [bug, adaIdea].sort()
        );
        expect(ids(await listFeedback(bob, { scope: "mine", ...defaults }))).toEqual([bobIdea]);

        const board = await listFeedback(bob, { scope: "ideas", ...defaults });
        expect(ids(board)).toEqual([adaIdea, bobIdea].sort());
        const hers = board.find(item => item.id === adaIdea)!;
        expect(hers).toMatchObject({ mine: false, voted: false, votes: 1, severity: null });
        expect(hers.reporter).toBeUndefined();
        expect(hers.workspaceName).toBeUndefined();

        await expect(status(listFeedback(bob, { scope: "triage", ...defaults }))).resolves.toBe(
            403
        );

        const triage = await listFeedback(olu, { scope: "triage", ...defaults });
        expect(ids(triage)).toEqual([bug, adaIdea, bobIdea].sort());
        const filed = triage.find(item => item.id === bug)!;
        expect(filed).toMatchObject({
            reporter: { name: "Ada L", email: "ada@example.com" },
            workspaceName: "Acme",
            awaitingReply: true,
            attachments: 1,
            severity: "blocking",
        });
        expect(triage.find(item => item.id === adaIdea)!.workspaceName).toBeNull();
        expect(triage.find(item => item.id === bobIdea)!.reporter).toEqual({
            name: "Bob Builder",
            email: "bob@example.com",
        });

        // Filters.
        expect(ids(await listFeedback(olu, { scope: "triage", kind: "bug", ...defaults }))).toEqual(
            [bug]
        );
        expect(
            ids(await listFeedback(olu, { scope: "triage", status: "done", ...defaults }))
        ).toEqual([]);
    });

    it("searches title and body, with % and _ taken literally", async () => {
        const search = (viewer: FeedbackViewer, q: string) =>
            listFeedback(viewer, { scope: "triage", q, sort: "recent", limit: 50 }).then(items =>
                items.map(item => item.id)
            );
        expect(await search(olu, "%")).toEqual([bug]);
        expect(await search(olu, "_")).toEqual([bug]);
        expect(await search(olu, "100%_")).toEqual([bug]);
        expect(await search(olu, "DARK")).toEqual([adaIdea]);
        expect(await search(olu, "vim")).toEqual([bobIdea]);
        expect(await search(olu, "no such words")).toEqual([]);
        // A board reader's search never finds a bug that isn't theirs.
        expect(
            (
                await listFeedback(bob, { scope: "ideas", q: "spinner", sort: "recent", limit: 50 })
            ).map(item => item.id)
        ).toEqual([]);
    });

    it("hides a bug from everyone but its reporter and triagers, with a 404", async () => {
        await expect(status(getFeedbackReport(bob, bug))).resolves.toBe(404);
        await expect(status(getFeedbackReport(bob, 999_999))).resolves.toBe(404);

        const own = await getFeedbackReport(ada, bug);
        expect(own.context).toMatchObject({ workspaceName: "Acme" });
        expect(own.attachmentList).toHaveLength(1);
        const url = own.attachmentList![0]!.url;
        const attachmentId = Number(url.split("/").pop());
        expect(url).toBe(`/api/feedback/${bug}/attachments/${attachmentId}`);

        expect((await readFeedbackAttachment(ada, bug, attachmentId))?.data.toString()).toBe(
            "RIFF-webp-bytes"
        );
        expect((await readFeedbackAttachment(olu, bug, attachmentId))?.contentType).toBe(
            "image/webp"
        );
        expect(await readFeedbackAttachment(bob, bug, attachmentId)).toBeNull();
        // The attachment id must belong to the report in the URL.
        expect(await readFeedbackAttachment(ada, adaIdea, attachmentId)).toBeNull();
    });

    it("shows another person's idea without its author, context or screenshots", async () => {
        const seen = await getFeedbackReport(bob, adaIdea);
        expect(seen).toMatchObject({ mine: false, canReply: false, canTriage: false });
        expect(seen.context).toBeUndefined();
        expect(seen.attachmentList).toBeUndefined();
        expect(seen.reporter).toBeUndefined();
    });

    it("counts one vote per person, on ideas only", async () => {
        await expect(setFeedbackVote(bob, adaIdea, true)).resolves.toEqual({
            votes: 2,
            voted: true,
        });
        await expect(setFeedbackVote(bob, adaIdea, true)).resolves.toEqual({
            votes: 2,
            voted: true,
        });
        expect((await getFeedbackReport(bob, adaIdea)).voted).toBe(true);
        await expect(setFeedbackVote(bob, adaIdea, false)).resolves.toEqual({
            votes: 1,
            voted: false,
        });
        await expect(setFeedbackVote(bob, adaIdea, false)).resolves.toEqual({
            votes: 1,
            voted: false,
        });

        // Concurrent votes all land.
        await Promise.all([
            setFeedbackVote(bob, bobIdea, true), // already his (auto-vote): no-op
            setFeedbackVote(ada, bobIdea, true),
            setFeedbackVote(cai, bobIdea, true),
        ]);
        const [row] = await mockDb
            .select({ votes: feedbackReports.voteCount })
            .from(feedbackReports)
            .where(eq(feedbackReports.id, bobIdea));
        expect(row!.votes).toBe(3);

        // A bug takes no votes; one you cannot see is still a 404 first.
        await expect(status(setFeedbackVote(ada, bug, true))).resolves.toBe(400);
        await expect(status(setFeedbackVote(bob, bug, true))).resolves.toBe(404);

        const byVotes = await listFeedback(cai, { scope: "ideas", sort: "votes", limit: 50 });
        expect(byVotes.map(item => [item.id, item.votes, item.voted])).toEqual([
            [bobIdea, 3, true],
            [adaIdea, 1, false],
        ]);
    });

    it("keeps a thread between the reporter and the team, and tells the reporter", async () => {
        await expect(status(replyToFeedback(bob, adaIdea, "+1 from me"))).resolves.toBe(403);
        await expect(status(replyToFeedback(bob, bug, "me too"))).resolves.toBe(404);

        const before = await getFeedbackReport(ada, bug);
        const own = await replyToFeedback(ada, bug, "Still happening on 0.1.0");
        expect(own).toMatchObject({ fromTeam: false, mine: true, author: { name: "Ada L" } });
        expect(
            (
                await listFeedback(olu, { scope: "triage", kind: "bug", sort: "recent", limit: 5 })
            )[0]!.awaitingReply
        ).toBe(true);

        const team = await replyToFeedback(olu, bug, "Thanks — looking into it.");
        expect(team).toMatchObject({
            fromTeam: true,
            mine: true,
            author: { name: "Olu from Ops", email: "olu@example.com" },
        });

        const detail = await getFeedbackReport(ada, bug);
        expect(detail.thread.map(reply => [reply.fromTeam, reply.author, reply.mine])).toEqual([
            [false, { name: "Ada L" }, true],
            [true, { name: "Olu from Ops" }, false],
        ]);
        expect(detail.replies).toBe(2);
        expect(new Date(detail.updatedAt).getTime()).toBeGreaterThan(
            new Date(before.updatedAt).getTime()
        );
        const triaged = await listFeedback(olu, {
            scope: "triage",
            kind: "bug",
            sort: "recent",
            limit: 5,
        });
        expect(triaged[0]!.awaitingReply).toBe(false);

        // Olu answers Ada's idea too — filed with no workspace, so no inbox row.
        await replyToFeedback(olu, adaIdea, "Planned.");
        const replyBoard = await getFeedbackReport(bob, adaIdea);
        expect(replyBoard.thread.map(reply => reply.author)).toEqual([{ name: "Olu from Ops" }]);

        const rows = await mockDb
            .select()
            .from(workspaceNotifications)
            .where(eq(workspaceNotifications.recipientUserId, "auth-ada"));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            companyId: acme,
            actorUserId: "auth-olu",
            kind: "feedback",
            targetType: "feedback",
            targetId: String(bug),
            targetLabel: "Upload fails at 100%_done",
            detail: { event: "reply" },
            readAt: null,
        });
    });

    it("lets only triagers move a report, and tells the reporter once per change", async () => {
        await expect(status(updateFeedbackReport(ada, bug, { status: "done" }))).resolves.toBe(403);
        await expect(
            status(updateFeedbackReport(olu, adaIdea, { severity: "cosmetic" }))
        ).resolves.toBe(400);
        await expect(status(updateFeedbackReport(olu, 999_999, { status: "done" }))).resolves.toBe(
            404
        );

        const before = await getFeedbackReport(olu, bug);
        const moved = await updateFeedbackReport(olu, bug, {
            status: "planned",
            severity: "annoying",
        });
        expect(moved).toMatchObject({ status: "planned", severity: "annoying", canTriage: true });
        expect(new Date(moved.updatedAt).getTime()).toBeGreaterThan(
            new Date(before.updatedAt).getTime()
        );

        // Same status again, and a severity-only change: no news for Ada.
        const again = await updateFeedbackReport(olu, bug, { status: "planned" });
        await updateFeedbackReport(olu, bug, { severity: null });
        expect(again.updatedAt).toBe(moved.updatedAt);

        const [stored] = await mockDb
            .select()
            .from(feedbackReports)
            .where(eq(feedbackReports.id, bug));
        expect(stored!.statusChangedAt).not.toBeNull();
        expect(stored!.severity).toBeNull();

        const rows = await mockDb
            .select({ detail: workspaceNotifications.detail })
            .from(workspaceNotifications)
            .where(
                and(
                    eq(workspaceNotifications.recipientUserId, "auth-ada"),
                    eq(workspaceNotifications.targetId, String(bug))
                )
            );
        expect(rows.map(row => row.detail)).toEqual(
            expect.arrayContaining([{ event: "reply" }, { event: "status", status: "planned" }])
        );
        expect(rows).toHaveLength(2);
    });

    it("keeps feedback rows in the reporter's inbox", async () => {
        const ctx = buildWorkspaceContext({
            authUserId: "auth-ada",
            userPk: adaPk,
            companyId: acme,
            role: "member",
            status: "active",
            permissions: new Set(),
            resolveScope: async () => ({ kind: "everything" }),
        });
        const inbox = await listNotifications(ctx);
        expect(inbox.entries.map(entry => [entry.targetType, entry.detail])).toEqual([
            ["feedback", { event: "status", status: "planned" }],
            ["feedback", { event: "reply" }],
        ]);
        expect(inbox.unread).toBe(2);
    });

    it("names someone with only a sign-in account by their email", async () => {
        const id = (
            await createFeedbackReport({
                reporter: { ...cai, companyId: null },
                input: { kind: "bug", title: "Picker is blank", body: "", context: {} },
                images: [],
            })
        ).id;
        const seen = await getFeedbackReport(olu, id);
        expect(seen.reporter).toEqual({ name: "cai", email: "cai@example.com" });
    });

    it("keeps a report when its workspace is deleted, with the name it was filed under", async () => {
        const [temp] = await mockDb
            .insert(company)
            .values({ name: "Short-lived Co", numberOfEmployees: "1-10" })
            .returning({ id: company.id });
        const id = (
            await createFeedbackReport({
                reporter: { ...cai, companyId: BigInt(temp!.id) },
                input: { kind: "bug", title: "Before the end", body: "", context: {} },
                images: [],
            })
        ).id;
        await mockDb.delete(company).where(eq(company.id, temp!.id));

        const [stored] = await mockDb
            .select({ companyId: feedbackReports.companyId })
            .from(feedbackReports)
            .where(eq(feedbackReports.id, id));
        expect(stored!.companyId).toBeNull();
        const triage = await listFeedback(olu, {
            scope: "triage",
            q: "Before the end",
            sort: "recent",
            limit: 5,
        });
        expect(triage[0]!.workspaceName).toBe("Short-lived Co");
    });
});
