/** @jest-environment node */

/**
 * A member's own connections against a real, migrated Postgres: what happens
 * to a personal Gmail connection, and the mail it brought in, when its owner
 * is removed, leaves, is suspended, or was removed before this rule existed.
 *
 * Cast, all in Acme: Oli is the Owner, Ben an Admin. Ada, Cai, Dee, Fay,
 * Ivy, Jo and Kim are Members with Gmail connected; Eve is a Viewer with
 * Gmail connected. Lea, Mo, Ned, Pia, Rex, Sam and Tia are Members with
 * Outlook connected (Lea has Gmail too): an Outlook mailbox gets exactly the
 * treatment a Gmail one does.
 *
 * The bug this pins down: removing Ada used to leave her Gmail connection
 * syncing, and handed her `Gmail/<address>` folder to Ben, the Admin who
 * removed her, so her new mail kept arriving somewhere Ben could read.
 *
 * Gated like the other integration suites: runs only when
 * LAUNCHSTACK_TEST_DATABASE_URL (or DATABASE_URL) points at a local server.
 */

import { and, eq, inArray, like } from "drizzle-orm";

import type { DbClient } from "@launchstack/store/client";
import { configureSecretBox, encryptSecret } from "@launchstack/store/crypto";
import { category, company, document } from "@launchstack/store/schema";

import { createFounderWeeklyReviewTestDatabase } from "../../founderWeeklyReview/testDb";

let mockActiveDb: DbClient | null = null;
jest.mock("~/server/db", () => ({
    get db() {
        if (!mockActiveDb) throw new Error("test database not ready");
        return mockActiveDb;
    },
}));

const mockRevokeGoogleToken = jest.fn(async (_token: string) => true);
jest.mock("~/server/services/connectors/gmail/connections", () => ({
    ...jest.requireActual("~/server/services/connectors/gmail/connections"),
    revokeGoogleToken: (token: string) => mockRevokeGoogleToken(token),
    getGmailAccessToken: async () => "access-token",
}));

// Stands in for the mailbox walk, so a test can act while a run is in flight.
// The real sink writes through the engine's own connection, which the stub
// walk never uses, so it is stubbed too.
const mockSyncGmail = jest.fn();
jest.mock("@launchstack/pipelines/connectors/gmail", () => ({
    ...jest.requireActual("@launchstack/pipelines/connectors/gmail"),
    syncGmail: (...args: unknown[]) => mockSyncGmail(...args),
}));
jest.mock("~/server/services/connectors/gmail/sink", () => ({
    ...jest.requireActual("~/server/services/connectors/gmail/sink"),
    createGmailSink: async () => ({}),
}));

// The same three seams for Outlook: no token is minted, the mailbox walk is
// the test's to script, and the sink writes nothing of its own.
jest.mock("~/server/services/microsoft/connections", () => ({
    ...jest.requireActual("~/server/services/microsoft/connections"),
    getMicrosoftAccessToken: async () => "access-token",
}));
const mockSyncOutlook = jest.fn();
jest.mock("@launchstack/pipelines/connectors/outlook", () => ({
    ...jest.requireActual("@launchstack/pipelines/connectors/outlook"),
    syncOutlook: (...args: unknown[]) => mockSyncOutlook(...args),
}));
jest.mock("~/server/services/connectors/outlook/sink", () => ({
    ...jest.requireActual("~/server/services/connectors/outlook/sink"),
    createOutlookSink: async () => ({}),
}));

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

type Person =
    | "oli"
    | "ben"
    | "ada"
    | "cai"
    | "dee"
    | "eve"
    | "fay"
    | "ivy"
    | "jo"
    | "kim"
    | "lea"
    | "mo"
    | "ned"
    | "pia"
    | "rex"
    | "sam"
    | "tia";
const ROLES: Record<Person, string> = {
    oli: "owner",
    ben: "admin",
    ada: "member",
    cai: "member",
    dee: "member",
    eve: "viewer",
    fay: "member",
    ivy: "member",
    jo: "member",
    kim: "member",
    lea: "member",
    mo: "member",
    ned: "member",
    pia: "member",
    rex: "member",
    sam: "member",
    tia: "member",
};

describeDb("departing members' own connections (integration)", () => {
    jest.setTimeout(120_000);

    let test: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyId: bigint;
    const pk = {} as Record<Person, bigint>;

    const email = (who: Person) => `${who}@acme.test`;
    const mailbox = (who: Person) => `Gmail/${email(who)}`;
    const outlookMailbox = (who: Person) => `Outlook/${email(who)}`;

    async function schema() {
        return import("~/server/db/schema");
    }

    async function ctxFor(who: Person) {
        const { buildWorkspaceContext } = await import("~/lib/require-workspace-context");
        const { builtinRolePermissions } = await import("~/lib/authz/permissions");
        return buildWorkspaceContext({
            authUserId: `auth_${who}`,
            userPk: pk[who],
            companyId,
            role: ROLES[who],
            status: "active",
            permissions: builtinRolePermissions(ROLES[who])!,
        });
    }

    /** A Gmail connection, sync state, scope and private folder, as connecting makes them. */
    async function connectGmail(who: Person, account = email(who)): Promise<number> {
        const { connectorConnections, gmailSyncScope, gmailSyncState } = await schema();
        const { ciphertext, keyVersion } = encryptSecret(`refresh-${who}`);
        const [row] = await test.db
            .insert(connectorConnections)
            .values({
                companyId,
                provider: "gmail",
                providerAccountId: `google-${account}`,
                providerAccountEmail: account,
                grantedByUserId: pk[who],
                ownerUserId: pk[who],
                refreshTokenCiphertext: ciphertext,
                encryptionKeyVersion: keyVersion,
                scopes: "https://www.googleapis.com/auth/gmail.readonly openid email",
                status: "active",
            })
            .returning();
        await test.db.insert(gmailSyncState).values({ connectionId: row!.id });
        await test.db
            .insert(gmailSyncScope)
            .values({ connectionId: row!.id, kind: "label", value: "INBOX", name: "Inbox" });
        const { ensurePrivateGmailFolder } = await import(
            "~/server/services/connectors/gmail/folder"
        );
        await ensurePrivateGmailFolder({
            companyId,
            ownerUserPk: pk[who],
            ownerAuthUserId: `auth_${who}`,
            accountEmail: account,
        });
        return row!.id;
    }

    /** An Outlook connection, sync state, scope and private folder, as connecting makes them. */
    async function connectOutlook(who: Person, account = email(who)): Promise<number> {
        const { connectorConnections, outlookSyncScope, outlookSyncState } = await schema();
        const { ciphertext, keyVersion } = encryptSecret(`outlook-refresh-${who}`);
        const [row] = await test.db
            .insert(connectorConnections)
            .values({
                companyId,
                provider: "outlook",
                providerAccountId: `entra-${account}`,
                providerAccountEmail: account,
                grantedByUserId: pk[who],
                ownerUserId: pk[who],
                refreshTokenCiphertext: ciphertext,
                encryptionKeyVersion: keyVersion,
                scopes: "Mail.Read offline_access openid email profile",
                status: "active",
            })
            .returning();
        await test.db.insert(outlookSyncState).values({
            connectionId: row!.id,
            deltaLinks: { "mf-inbox": "https://graph.example/delta?token=1" },
        });
        await test.db
            .insert(outlookSyncScope)
            .values({ connectionId: row!.id, kind: "folder", value: "mf-inbox", name: "Inbox" });
        const { ensurePrivateOutlookFolder } = await import(
            "~/server/services/connectors/outlook/folder"
        );
        await ensurePrivateOutlookFolder({
            companyId,
            ownerUserPk: pk[who],
            ownerAuthUserId: `auth_${who}`,
            accountEmail: account,
        });
        return row!.id;
    }

    async function addDocument(
        title: string,
        folder: string,
        connectionId?: number,
        connector: "gmail" | "outlook" = "gmail"
    ) {
        const [row] = await test.db
            .insert(document)
            .values({
                companyId,
                url: `local://${title}`,
                category: folder,
                title,
                ocrMetadata: connectionId
                    ? { connector, connectionId: String(connectionId), sourceId: title }
                    : {},
            })
            .returning({ id: document.id });
        return row!.id;
    }

    /** A loose file private to `who`, as an upload makes it (ADR-014). */
    async function addPrivateUpload(who: Person, title: string) {
        const { documentGrants, documentSettings } = await schema();
        const id = await addDocument(title, "Unfiled");
        await test.db.insert(documentSettings).values({
            documentId: BigInt(id),
            companyId,
            restricted: true,
            updatedBy: `auth_${who}`,
        });
        await test.db.insert(documentGrants).values({
            companyId,
            documentId: BigInt(id),
            principalType: "user",
            principalId: pk[who].toString(),
            level: "manage",
            grantedBy: `auth_${who}`,
        });
        return id;
    }

    async function connectionsOf(who: Person) {
        const { connectorConnections } = await schema();
        return test.db
            .select({ id: connectorConnections.id })
            .from(connectorConnections)
            .where(
                and(
                    eq(connectorConnections.companyId, companyId),
                    eq(connectorConnections.ownerUserId, pk[who])
                )
            );
    }

    async function folderExists(path: string) {
        const rows = await test.db
            .select({ id: category.id })
            .from(category)
            .where(and(eq(category.companyId, companyId), eq(category.name, path)));
        return rows.length > 0;
    }

    async function existingDocuments(ids: number[]) {
        const rows = await test.db
            .select({ id: document.id })
            .from(document)
            .where(inArray(document.id, ids));
        return rows.map(row => row.id).sort();
    }

    /** Every grant `who` holds on a folder under `Gmail/` (or, when asked, `Outlook/`). */
    async function mailboxGrantsOf(who: Person, root: "Gmail" | "Outlook" = "Gmail") {
        const { folderGrants } = await schema();
        return test.db
            .select({ name: category.name, level: folderGrants.level })
            .from(folderGrants)
            .innerJoin(category, eq(category.id, folderGrants.categoryId))
            .where(
                and(
                    eq(folderGrants.companyId, companyId),
                    eq(folderGrants.principalType, "user"),
                    eq(folderGrants.principalId, pk[who].toString()),
                    like(category.name, `${root}/%`)
                )
            );
    }

    async function visibleFolderPaths(who: Person) {
        const { listVisibleFolders } = await import("~/server/folders");
        const ctx = await ctxFor(who);
        return (await listVisibleFolders(companyId, await ctx.documentScope())).map(f => f.path);
    }

    /** The engine registers the environment's key when it starts; tests use their own. */
    function useTestSecretsKey() {
        configureSecretBox({ key: Buffer.alloc(32, 7).toString("base64") });
    }

    beforeAll(async () => {
        useTestSecretsKey();
        test = await createFounderWeeklyReviewTestDatabase();
        mockActiveDb = test.db;
        const { users, userCompanyMemberships } = await schema();
        const [co] = await test.db
            .insert(company)
            .values({ name: "Acme", numberOfEmployees: "5" })
            .returning();
        companyId = BigInt(co!.id);
        // Oli first: the longest-standing Owner is the heir when someone leaves.
        for (const who of Object.keys(ROLES) as Person[]) {
            const [u] = await test.db
                .insert(users)
                .values({ name: who, email: email(who), userId: `auth_${who}`, companyId })
                .returning();
            pk[who] = BigInt(u!.id);
            await test.db.insert(userCompanyMemberships).values({
                userId: pk[who],
                companyId,
                role: ROLES[who],
                status: "active",
            });
        }
    });

    beforeEach(() => {
        useTestSecretsKey();
        mockRevokeGoogleToken.mockClear();
        mockSyncGmail.mockReset();
        mockSyncOutlook.mockReset();
    });

    afterAll(async () => {
        mockActiveDb = null;
        configureSecretBox({ key: undefined });
        await test?.close();
    });

    it("removing a member closes their Gmail, deletes the mail in their mailbox, and hands none of it to the remover", async () => {
        const { gmailSyncScope, gmailSyncState } = await schema();
        const connectionId = await connectGmail("ada");
        const inbox = [
            await addDocument("Offer letter", mailbox("ada"), connectionId),
            await addDocument("Doctor's appointment", mailbox("ada"), connectionId),
        ];
        // Mail Ada filed in a team folder herself, and a file of her own.
        const filedForTeam = await addDocument("Customer thread", "Sales", connectionId);
        const ownUpload = await addPrivateUpload("ada", "Ada's plan.docx");

        expect(await visibleFolderPaths("ben")).not.toContain(mailbox("ada"));

        const { removeMember } = await import("~/server/workspace/members");
        await removeMember(await ctxFor("ben"), pk.ada);

        // The connection, and its state and scope with it.
        expect(await connectionsOf("ada")).toEqual([]);
        const state = await test.db
            .select()
            .from(gmailSyncState)
            .where(eq(gmailSyncState.connectionId, connectionId));
        const scope = await test.db
            .select()
            .from(gmailSyncScope)
            .where(eq(gmailSyncScope.connectionId, connectionId));
        expect(state).toEqual([]);
        expect(scope).toEqual([]);
        expect(mockRevokeGoogleToken).toHaveBeenCalledWith("refresh-ada");

        // Her mailbox and the mail in it are gone; the shared root stays.
        expect(await existingDocuments(inbox)).toEqual([]);
        expect(await folderExists(mailbox("ada"))).toBe(false);
        expect(await folderExists("Gmail")).toBe(true);
        expect(await mailboxGrantsOf("ben")).toEqual([]);
        expect(await visibleFolderPaths("ben")).not.toContain(mailbox("ada"));

        // The removal's audit entry says what went with her.
        const { workspaceAuditEvents } = await schema();
        const [audit] = await test.db
            .select({ detail: workspaceAuditEvents.detail })
            .from(workspaceAuditEvents)
            .where(
                and(
                    eq(workspaceAuditEvents.companyId, companyId),
                    eq(workspaceAuditEvents.action, "member.removed")
                )
            );
        expect(audit?.detail).toMatchObject({ closedConnections: 1, deletedMail: 2 });

        // What she put in front of the team stays, and her own file passes to Ben as before.
        expect(await existingDocuments([filedForTeam, ownUpload])).toEqual(
            [filedForTeam, ownUpload].sort()
        );
        const { documentAccess, accessSubject } = await import("~/server/workspace/item-access");
        const ben = await ctxFor("ben");
        const access = await documentAccess(
            ben,
            { id: ownUpload, category: "Unfiled" },
            await accessSubject(ben)
        );
        expect(access.level).toBe("manage");
    });

    it("someone leaving closes their own Gmail the same way, and the Owner inherits none of it", async () => {
        const connectionId = await connectGmail("cai");
        const mail = await addDocument("Payslip", mailbox("cai"), connectionId);

        const { leaveWorkspace } = await import("~/server/workspace/members");
        await leaveWorkspace(await ctxFor("cai"));

        expect(await connectionsOf("cai")).toEqual([]);
        expect(await existingDocuments([mail])).toEqual([]);
        expect(await folderExists(mailbox("cai"))).toBe(false);
        expect(await mailboxGrantsOf("oli")).toEqual([]);
        expect(mockRevokeGoogleToken).toHaveBeenCalledWith("refresh-cai");
    });

    it("pauses the sync for a suspended member or one whose role can't add files, and resumes it on reinstatement", async () => {
        const { userCompanyMemberships } = await schema();
        const { personalSyncStanding } = await import(
            "~/server/services/connectors/personal-connections"
        );
        const { runGmailSync } = await import("~/server/services/connectors/gmail/sync-service");
        const deeConnection = await connectGmail("dee");
        const deeMail = await addDocument("Lease", mailbox("dee"), deeConnection);
        await connectGmail("eve");

        expect(await personalSyncStanding(companyId, pk.dee)).toBe("active");
        // A Viewer can't add files, so their mailbox doesn't sync into the workspace.
        expect(await personalSyncStanding(companyId, pk.eve)).toBe("paused");

        const { updateMember } = await import("~/server/workspace/members");
        await updateMember(await ctxFor("ben"), pk.dee, { status: "suspended" });
        expect(await personalSyncStanding(companyId, pk.dee)).toBe("paused");

        const result = await runGmailSync(deeConnection);
        expect(result).toEqual({ outcome: "skipped", reason: expect.stringContaining("paused") });
        // Paused, not closed: nothing of hers is touched.
        expect(await connectionsOf("dee")).toHaveLength(1);
        expect(await existingDocuments([deeMail])).toEqual([deeMail]);

        await updateMember(await ctxFor("ben"), pk.dee, { status: "active" });
        expect(await personalSyncStanding(companyId, pk.dee)).toBe("active");

        // Checked straight from the membership row, so a role change counts too.
        await test.db
            .update(userCompanyMemberships)
            .set({ role: "viewer" })
            .where(eq(userCompanyMemberships.userId, pk.dee));
        expect(await personalSyncStanding(companyId, pk.dee)).toBe("paused");
    });

    it("a sync whose owner was removed before this rule existed closes the connection itself", async () => {
        const { folderGrants, userCompanyMemberships } = await schema();
        const connectionId = await connectGmail("fay");
        const mail = await addDocument("Bank statement", mailbox("fay"), connectionId);

        // The old removal: Ben inherited the mailbox, Fay's grant and membership went,
        // and her connection was left running.
        const [folder] = await test.db
            .select({ id: category.id })
            .from(category)
            .where(and(eq(category.companyId, companyId), eq(category.name, mailbox("fay"))));
        await test.db.insert(folderGrants).values({
            companyId,
            categoryId: BigInt(folder!.id),
            principalType: "user",
            principalId: pk.ben.toString(),
            level: "manage",
            grantedBy: "auth_ben",
        });
        await test.db
            .delete(folderGrants)
            .where(
                and(
                    eq(folderGrants.categoryId, BigInt(folder!.id)),
                    eq(folderGrants.principalId, pk.fay.toString())
                )
            );
        await test.db
            .delete(userCompanyMemberships)
            .where(eq(userCompanyMemberships.userId, pk.fay));
        expect(await visibleFolderPaths("ben")).toContain(mailbox("fay"));

        const { runGmailSync } = await import("~/server/services/connectors/gmail/sync-service");
        const result = await runGmailSync(connectionId);

        expect(result).toEqual({
            outcome: "skipped",
            reason: expect.stringContaining("connection closed"),
        });
        expect(await connectionsOf("fay")).toEqual([]);
        expect(await existingDocuments([mail])).toEqual([]);
        expect(await folderExists(mailbox("fay"))).toBe(false);
        expect(await visibleFolderPaths("ben")).not.toContain(mailbox("fay"));
        expect(mockRevokeGoogleToken).toHaveBeenCalledWith("refresh-fay");
    });

    it("never hands a mailbox on, even one the departing person manages alone", async () => {
        const { folderGrants, folderSettings } = await schema();
        const { createFolder } = await import("~/server/folders");

        /** A restricted mailbox folder whose one manage grant is Ben's, given by `grantedBy`. */
        async function mailboxManagedByBen(path: string, grantedBy: string) {
            await createFolder(companyId, path);
            const [row] = await test.db
                .select({ id: category.id })
                .from(category)
                .where(and(eq(category.companyId, companyId), eq(category.name, path)));
            const categoryId = BigInt(row!.id);
            await test.db
                .insert(folderSettings)
                .values({ categoryId, companyId, visibility: "restricted", updatedBy: grantedBy });
            await test.db.insert(folderGrants).values({
                companyId,
                categoryId,
                principalType: "user",
                principalId: pk.ben.toString(),
                level: "manage",
                grantedBy,
            });
        }

        // Gus shared his mailbox with Ben and then dropped his own grant: Ben
        // holds the only manage grant, but it isn't Ben's mailbox.
        const gus = "Gmail/gus@acme.test";
        await mailboxManagedByBen(gus, "auth_gus");
        const gusMail = await addDocument("Gus's flight", gus);

        // Hal's mailbox reached Ben under the old removal. Ben granted it to
        // himself, so it reads as his and goes when he does: Hal is long gone.
        const hal = "Gmail/hal@acme.test";
        await mailboxManagedByBen(hal, "auth_ben");
        const halMail = await addDocument("Hal's old mail", hal);

        const { removeMember } = await import("~/server/workspace/members");
        await removeMember(await ctxFor("oli"), pk.ben);

        expect(await mailboxGrantsOf("oli")).toEqual([]);
        expect(await visibleFolderPaths("oli")).not.toContain(gus);
        // Gus's mailbox stays, closed to everyone; Hal's went with Ben.
        expect(await folderExists(gus)).toBe(true);
        expect(await existingDocuments([gusMail])).toEqual([gusMail]);
        expect(await folderExists(hal)).toBe(false);
        expect(await existingDocuments([halMail])).toEqual([]);
    });
    it("keeps a mailbox someone else has since connected, though the departing member made it", async () => {
        const { deleteGmailConnection } = await import(
            "~/server/services/connectors/gmail/connections"
        );
        const shared = "Gmail/support@acme.test";
        // Jo connected the support inbox and disconnected it again: the folder
        // and her own grant on it stay, as a disconnect leaves them.
        await deleteGmailConnection(await connectGmail("jo", "support@acme.test"));
        useTestSecretsKey();
        // Kim then connected the same account, into the same folder.
        const kimConnection = await connectGmail("kim", "support@acme.test");
        const kimsMail = await addDocument("Refund request", shared, kimConnection);

        const { removeMember } = await import("~/server/workspace/members");
        await removeMember(await ctxFor("oli"), pk.jo);

        expect(await connectionsOf("kim")).toHaveLength(1);
        expect(await folderExists(shared)).toBe(true);
        expect(await existingDocuments([kimsMail])).toEqual([kimsMail]);
        expect(await visibleFolderPaths("kim")).toContain(shared);
        expect(await mailboxGrantsOf("jo")).toEqual([]);
        expect(await mailboxGrantsOf("oli")).toEqual([]);
    });

    it("sweeps what a sync already running writes after its owner is removed", async () => {
        const connectionId = await connectGmail("ivy");
        const { ensurePrivateGmailFolder } = await import(
            "~/server/services/connectors/gmail/folder"
        );
        let lateMail = 0;
        mockSyncGmail.mockImplementationOnce(async () => {
            // Ivy is removed while this run is reading her mailbox...
            const { removeMember } = await import("~/server/workspace/members");
            await removeMember(await ctxFor("oli"), pk.ivy);
            // ...and the run carries on: it makes the folder again and stores a thread.
            await ensurePrivateGmailFolder({
                companyId,
                ownerUserPk: pk.ivy,
                ownerAuthUserId: "auth_ivy",
                accountEmail: email("ivy"),
            });
            lateMail = await addDocument("Late thread", mailbox("ivy"), connectionId);
            return {
                dirty: true,
                discovered: 1,
                stored: [],
                skipped: [],
                failed: [],
                missingSourceIds: [],
                notFound: [],
                nextHistoryId: "2",
                historyExpired: false,
                truncated: false,
                changedThreads: 1,
                accountEmail: email("ivy"),
                durationMs: 1,
            };
        });

        const { runGmailSync } = await import("~/server/services/connectors/gmail/sync-service");
        await runGmailSync(connectionId);

        expect(mockSyncGmail).toHaveBeenCalledTimes(1);
        expect(lateMail).toBeGreaterThan(0);
        expect(await connectionsOf("ivy")).toEqual([]);
        expect(await existingDocuments([lateMail])).toEqual([]);
        expect(await folderExists(mailbox("ivy"))).toBe(false);
    });

    // ── Outlook: the same rules, the other mailbox ─────────────────────────

    /** What `syncOutlook` answers for a run that stored one conversation. */
    function outlookReport(who: Person) {
        return {
            connectorId: "outlook",
            startedAt: "2026-11-12T00:00:00.000Z",
            finishedAt: "2026-11-12T00:00:01.000Z",
            durationMs: 1000,
            dirty: true,
            discovered: 1,
            stored: [],
            skipped: [],
            failed: [],
            missingSourceIds: [],
            notFound: [],
            nextDeltaLinks: { "mf-inbox": "https://graph.example/delta?token=2" },
            deltaExpired: false,
            truncated: false,
            changedConversations: 1,
            removedMessages: 0,
            accountEmail: email(who),
        };
    }

    it("removing a member closes their Outlook and their Gmail alike: the mail in both mailboxes is deleted and none of it reaches the remover", async () => {
        const { outlookSyncScope, outlookSyncState, workspaceAuditEvents } = await schema();
        const outlookConnection = await connectOutlook("lea");
        const gmailConnection = await connectGmail("lea");
        const outlookMail = [
            await addDocument("Salary review", outlookMailbox("lea"), outlookConnection, "outlook"),
            await addDocument("Clinic letter", outlookMailbox("lea"), outlookConnection, "outlook"),
        ];
        const gmailMail = await addDocument("Mortgage offer", mailbox("lea"), gmailConnection);
        // Mail she moved in front of the team herself, and a file of her own.
        const filedForTeam = await addDocument(
            "Supplier conversation",
            "Sales",
            outlookConnection,
            "outlook"
        );
        const ownUpload = await addPrivateUpload("lea", "Lea's plan.docx");

        expect(await visibleFolderPaths("lea")).toContain(outlookMailbox("lea"));
        expect(await visibleFolderPaths("ben")).not.toContain(outlookMailbox("lea"));
        expect(await visibleFolderPaths("oli")).not.toContain(outlookMailbox("lea"));

        // Microsoft has no endpoint to revoke at, so nothing may be sent anywhere.
        const network = jest.spyOn(global, "fetch");
        const { removeMember } = await import("~/server/workspace/members");
        await removeMember(await ctxFor("ben"), pk.lea);
        expect(network).not.toHaveBeenCalled();
        network.mockRestore();

        // Both connections, and the Outlook one's state and scope with it.
        expect(await connectionsOf("lea")).toEqual([]);
        expect(
            await test.db
                .select()
                .from(outlookSyncState)
                .where(eq(outlookSyncState.connectionId, outlookConnection))
        ).toEqual([]);
        expect(
            await test.db
                .select()
                .from(outlookSyncScope)
                .where(eq(outlookSyncScope.connectionId, outlookConnection))
        ).toEqual([]);
        // Gmail's grant is revoked at Google as before; the Outlook token is only deleted.
        expect(mockRevokeGoogleToken).toHaveBeenCalledTimes(1);
        expect(mockRevokeGoogleToken).toHaveBeenCalledWith("refresh-lea");

        // Both mailboxes and the mail in them are gone; the shared roots stay.
        expect(await existingDocuments([...outlookMail, gmailMail])).toEqual([]);
        expect(await folderExists(outlookMailbox("lea"))).toBe(false);
        expect(await folderExists(mailbox("lea"))).toBe(false);
        expect(await folderExists("Outlook")).toBe(true);
        expect(await mailboxGrantsOf("ben", "Outlook")).toEqual([]);
        expect(await mailboxGrantsOf("ben")).toEqual([]);
        expect(await visibleFolderPaths("ben")).not.toContain(outlookMailbox("lea"));

        // The audit trail: the removal's own entry, and one line per closed connection.
        const removals = await test.db
            .select({ detail: workspaceAuditEvents.detail })
            .from(workspaceAuditEvents)
            .where(
                and(
                    eq(workspaceAuditEvents.companyId, companyId),
                    eq(workspaceAuditEvents.action, "member.removed")
                )
            );
        expect(removals.map(row => row.detail)).toContainEqual(
            expect.objectContaining({ email: email("lea"), closedConnections: 2, deletedMail: 3 })
        );
        const disconnects = await test.db
            .select({
                targetId: workspaceAuditEvents.targetId,
                detail: workspaceAuditEvents.detail,
            })
            .from(workspaceAuditEvents)
            .where(
                and(
                    eq(workspaceAuditEvents.companyId, companyId),
                    eq(workspaceAuditEvents.action, "connector.disconnected")
                )
            );
        expect(disconnects).toContainEqual({
            targetId: "outlook",
            detail: expect.objectContaining({
                connectionId: outlookConnection,
                ownerUserId: pk.lea.toString(),
                reason: "member-departed",
            }),
        });

        // What she put in front of the team stays, and her own file passes to Ben.
        expect(await existingDocuments([filedForTeam, ownUpload])).toEqual(
            [filedForTeam, ownUpload].sort()
        );
        const { documentAccess, accessSubject } = await import("~/server/workspace/item-access");
        const ben = await ctxFor("ben");
        const access = await documentAccess(
            ben,
            { id: ownUpload, category: "Unfiled" },
            await accessSubject(ben)
        );
        expect(access.level).toBe("manage");
    });

    it("someone leaving closes their own Outlook the same way, and the Owner inherits none of it", async () => {
        const connectionId = await connectOutlook("mo");
        const mail = await addDocument("Payslip", outlookMailbox("mo"), connectionId, "outlook");

        const { leaveWorkspace } = await import("~/server/workspace/members");
        await leaveWorkspace(await ctxFor("mo"));

        expect(await connectionsOf("mo")).toEqual([]);
        expect(await existingDocuments([mail])).toEqual([]);
        expect(await folderExists(outlookMailbox("mo"))).toBe(false);
        expect(await mailboxGrantsOf("oli", "Outlook")).toEqual([]);
        expect(await visibleFolderPaths("oli")).not.toContain(outlookMailbox("mo"));
        expect(mockRevokeGoogleToken).not.toHaveBeenCalled();
    });

    it("pauses an Outlook sync for a suspended member or one whose role can't add files, touching nothing, and resumes it on reinstatement", async () => {
        const { outlookSyncState, userCompanyMemberships } = await schema();
        const { personalSyncStanding } = await import(
            "~/server/services/connectors/personal-connections"
        );
        const { runOutlookSync } = await import(
            "~/server/services/connectors/outlook/sync-service"
        );
        const connectionId = await connectOutlook("ned");
        const mail = await addDocument("Lease", outlookMailbox("ned"), connectionId, "outlook");
        mockSyncOutlook.mockImplementation(async () => outlookReport("ned"));

        const { updateMember } = await import("~/server/workspace/members");
        await updateMember(await ctxFor("ben"), pk.ned, { status: "suspended" });
        expect(await personalSyncStanding(companyId, pk.ned)).toBe("paused");

        expect(await runOutlookSync(connectionId)).toEqual({
            outcome: "skipped",
            reason: expect.stringContaining("paused"),
        });
        // Paused, not closed: Microsoft was not asked, and nothing of his moved.
        expect(mockSyncOutlook).not.toHaveBeenCalled();
        expect(await connectionsOf("ned")).toHaveLength(1);
        expect(await existingDocuments([mail])).toEqual([mail]);
        expect(await folderExists(outlookMailbox("ned"))).toBe(true);
        const [paused] = await test.db
            .select()
            .from(outlookSyncState)
            .where(eq(outlookSyncState.connectionId, connectionId));
        expect(paused?.deltaLinks).toEqual({ "mf-inbox": "https://graph.example/delta?token=1" });
        expect(paused?.syncLockedAt).toBeNull();

        // Reinstated: the next run goes through, from where the last one stopped.
        await updateMember(await ctxFor("ben"), pk.ned, { status: "active" });
        expect(await runOutlookSync(connectionId)).toMatchObject({ outcome: "synced" });
        expect(mockSyncOutlook).toHaveBeenCalledTimes(1);
        expect(mockSyncOutlook.mock.calls[0]![0]).toMatchObject({
            deltaLinks: { "mf-inbox": "https://graph.example/delta?token=1" },
            selectors: [{ kind: "folder", value: "mf-inbox", name: "Inbox" }],
        });
        const [resumed] = await test.db
            .select()
            .from(outlookSyncState)
            .where(eq(outlookSyncState.connectionId, connectionId));
        expect(resumed?.deltaLinks).toEqual({ "mf-inbox": "https://graph.example/delta?token=2" });
        expect(resumed?.lastSyncStatus).toBe("ok");
        // His folder is still his alone after the run re-asserted it.
        expect(await visibleFolderPaths("ben")).not.toContain(outlookMailbox("ned"));

        // A role that can't add files pauses it too, checked from the membership row.
        await test.db
            .update(userCompanyMemberships)
            .set({ role: "viewer" })
            .where(eq(userCompanyMemberships.userId, pk.ned));
        expect(await runOutlookSync(connectionId)).toEqual({
            outcome: "skipped",
            reason: expect.stringContaining("paused"),
        });
        expect(mockSyncOutlook).toHaveBeenCalledTimes(1);
    });

    it("an Outlook sync whose owner is already gone closes the connection itself, mail and all", async () => {
        const { userCompanyMemberships } = await schema();
        const connectionId = await connectOutlook("pia");
        const mail = await addDocument(
            "Tax return",
            outlookMailbox("pia"),
            connectionId,
            "outlook"
        );
        // Her membership went without the departure rule running.
        await test.db
            .delete(userCompanyMemberships)
            .where(eq(userCompanyMemberships.userId, pk.pia));

        const { runOutlookSync } = await import(
            "~/server/services/connectors/outlook/sync-service"
        );
        expect(await runOutlookSync(connectionId)).toEqual({
            outcome: "skipped",
            reason: expect.stringContaining("connection closed"),
        });

        expect(mockSyncOutlook).not.toHaveBeenCalled();
        expect(await connectionsOf("pia")).toEqual([]);
        expect(await existingDocuments([mail])).toEqual([]);
        expect(await folderExists(outlookMailbox("pia"))).toBe(false);
    });

    it("never hands an Outlook mailbox on, even one the departing person manages alone", async () => {
        const { folderGrants, folderSettings } = await schema();
        const { createFolder } = await import("~/server/folders");
        // Uma shared her mailbox with Sam and dropped her own grant: Sam holds
        // the only manage grant, but it isn't Sam's mailbox.
        const uma = "Outlook/uma@acme.test";
        await createFolder(companyId, uma);
        const [row] = await test.db
            .select({ id: category.id })
            .from(category)
            .where(and(eq(category.companyId, companyId), eq(category.name, uma)));
        const categoryId = BigInt(row!.id);
        await test.db
            .insert(folderSettings)
            .values({ categoryId, companyId, visibility: "restricted", updatedBy: "auth_uma" });
        await test.db.insert(folderGrants).values({
            companyId,
            categoryId,
            principalType: "user",
            principalId: pk.sam.toString(),
            level: "manage",
            grantedBy: "auth_uma",
        });
        const umaMail = await addDocument("Uma's flight", uma);

        const { removeMember } = await import("~/server/workspace/members");
        await removeMember(await ctxFor("oli"), pk.sam);

        // Not Sam's to take with him, and not Oli's to inherit: it stays, closed to everyone.
        expect(await mailboxGrantsOf("oli", "Outlook")).toEqual([]);
        expect(await visibleFolderPaths("oli")).not.toContain(uma);
        expect(await folderExists(uma)).toBe(true);
        expect(await existingDocuments([umaMail])).toEqual([umaMail]);
    });

    it("keeps an Outlook mailbox someone else has since connected, and a Gmail folder of the same address", async () => {
        const { deleteOutlookConnection } = await import(
            "~/server/services/connectors/outlook/store"
        );
        const shared = "Outlook/billing@acme.test";
        // Tia connected the billing inbox and disconnected it again: the folder
        // and her own grant on it stay, as a disconnect leaves them.
        expect(
            await deleteOutlookConnection(await connectOutlook("tia", "billing@acme.test"))
        ).toBe(true);
        expect(await folderExists(shared)).toBe(true);
        // Kim then connected the same mailbox in Outlook, and the same address in Gmail.
        const kimOutlook = await connectOutlook("kim", "billing@acme.test");
        const kimsMail = await addDocument("Invoice query", shared, kimOutlook, "outlook");

        const { removeMember } = await import("~/server/workspace/members");
        await removeMember(await ctxFor("oli"), pk.tia);

        expect((await connectionsOf("kim")).map(row => row.id)).toContain(kimOutlook);
        expect(await folderExists(shared)).toBe(true);
        expect(await existingDocuments([kimsMail])).toEqual([kimsMail]);
        expect(await visibleFolderPaths("kim")).toContain(shared);
        expect(await mailboxGrantsOf("tia", "Outlook")).toEqual([]);
        expect(await mailboxGrantsOf("oli", "Outlook")).toEqual([]);
        // Kim's Gmail mailbox from earlier is a different root and was never in question.
        expect(await folderExists("Gmail/support@acme.test")).toBe(true);
    });

    it("sweeps what an Outlook sync already running writes after its owner is removed", async () => {
        const connectionId = await connectOutlook("rex");
        const { ensurePrivateOutlookFolder } = await import(
            "~/server/services/connectors/outlook/folder"
        );
        let lateMail = 0;
        mockSyncOutlook.mockImplementationOnce(async () => {
            // Rex is removed while this run is reading his mailbox...
            const { removeMember } = await import("~/server/workspace/members");
            await removeMember(await ctxFor("oli"), pk.rex);
            // ...and the run carries on: it makes the folder again and stores a conversation.
            await ensurePrivateOutlookFolder({
                companyId,
                ownerUserPk: pk.rex,
                ownerAuthUserId: "auth_rex",
                accountEmail: email("rex"),
            });
            lateMail = await addDocument(
                "Late conversation",
                outlookMailbox("rex"),
                connectionId,
                "outlook"
            );
            return outlookReport("rex");
        });

        const { runOutlookSync } = await import(
            "~/server/services/connectors/outlook/sync-service"
        );
        await runOutlookSync(connectionId);

        expect(mockSyncOutlook).toHaveBeenCalledTimes(1);
        expect(lateMail).toBeGreaterThan(0);
        expect(await connectionsOf("rex")).toEqual([]);
        expect(await existingDocuments([lateMail])).toEqual([]);
        expect(await folderExists(outlookMailbox("rex"))).toBe(false);
    });
});
