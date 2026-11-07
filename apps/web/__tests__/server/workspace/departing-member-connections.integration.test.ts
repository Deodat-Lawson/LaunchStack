/** @jest-environment node */

/**
 * A member's own connections against a real, migrated Postgres: what happens
 * to a personal Gmail connection, and the mail it brought in, when its owner
 * is removed, leaves, is suspended, or was removed before this rule existed.
 *
 * Cast, all in Acme: Oli is the Owner, Ben an Admin. Ada, Cai, Dee and Fay
 * are Members with Gmail connected; Eve is a Viewer with Gmail connected.
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
}));

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

type Person = "oli" | "ben" | "ada" | "cai" | "dee" | "eve" | "fay";
const ROLES: Record<Person, string> = {
    oli: "owner",
    ben: "admin",
    ada: "member",
    cai: "member",
    dee: "member",
    eve: "viewer",
    fay: "member",
};

describeDb("departing members' own connections (integration)", () => {
    jest.setTimeout(120_000);

    let test: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyId: bigint;
    const pk = {} as Record<Person, bigint>;

    const email = (who: Person) => `${who}@acme.test`;
    const mailbox = (who: Person) => `Gmail/${email(who)}`;

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
    async function connectGmail(who: Person): Promise<number> {
        const { connectorConnections, gmailSyncScope, gmailSyncState } = await schema();
        const { ciphertext, keyVersion } = encryptSecret(`refresh-${who}`);
        const [row] = await test.db
            .insert(connectorConnections)
            .values({
                companyId,
                provider: "gmail",
                providerAccountId: `google-${who}`,
                providerAccountEmail: email(who),
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
            accountEmail: email(who),
        });
        return row!.id;
    }

    async function addDocument(title: string, folder: string, connectionId?: number) {
        const [row] = await test.db
            .insert(document)
            .values({
                companyId,
                url: `local://${title}`,
                category: folder,
                title,
                ocrMetadata: connectionId
                    ? { connector: "gmail", connectionId: String(connectionId), sourceId: title }
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

    /** Every grant `who` holds on a folder under `Gmail/`. */
    async function mailboxGrantsOf(who: Person) {
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
                    like(category.name, "Gmail/%")
                )
            );
    }

    async function visibleFolderPaths(who: Person) {
        const { listVisibleFolders } = await import("~/server/folders");
        const ctx = await ctxFor(who);
        return (await listVisibleFolders(companyId, await ctx.documentScope())).map(f => f.path);
    }

    beforeAll(async () => {
        configureSecretBox({ key: Buffer.alloc(32, 7).toString("base64") });
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

    beforeEach(() => mockRevokeGoogleToken.mockClear());

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
});
