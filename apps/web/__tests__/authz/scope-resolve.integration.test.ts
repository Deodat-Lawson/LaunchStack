/**
 * `resolveDocumentScope` and `scopedDocumentWhere` against a real Postgres,
 * migrated with both ledgers — the migration that created the access tables
 * is exercised on the way in.
 *
 * Gated like the founder-weekly-review suites: runs only when
 * LAUNCHSTACK_TEST_DATABASE_URL (or DATABASE_URL) points at a local server.
 */
import { eq } from "drizzle-orm";

import { category, company, document } from "@launchstack/store/schema";
import type { DbClient } from "@launchstack/store/client";

import { createFounderWeeklyReviewTestDatabase } from "../founderWeeklyReview/testDb";

// The resolver reads the app's shared client; point it at the throwaway
// database for the duration of the suite.
let mockActiveDb: DbClient | null = null;
jest.mock("~/server/db", () => ({
    get db() {
        if (!mockActiveDb) throw new Error("test database not ready");
        return mockActiveDb;
    },
}));

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

describeDb("resolveDocumentScope (integration)", () => {
    jest.setTimeout(120_000);

    let test: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let ids: {
        companyId: bigint;
        owner: bigint;
        member: bigint;
        financeMember: bigint;
        groupMember: bigint;
        guest: bigint;
        viewer: bigint;
        finance: bigint;
        general: bigint;
        docGeneral: number;
        docFinance: number;
        docBoardDeck: number;
        financeGroup: bigint;
    };

    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        mockActiveDb = test.db;

        const {
            users,
            userCompanyMemberships,
            workspaceGroups,
            workspaceGroupMembers,
            folderSettings,
            folderGrants,
            documentSettings,
            documentGrants,
        } = await import("~/server/db/schema");

        const [co] = await test.db
            .insert(company)
            .values({ name: "Acme", numberOfEmployees: "20" })
            .returning();
        const companyId = BigInt(co!.id);

        const mkUser = async (name: string) => {
            const [u] = await test.db
                .insert(users)
                .values({
                    name,
                    email: `${name}@acme.test`,
                    userId: `auth_${name}`,
                    companyId,
                })
                .returning();
            return BigInt(u!.id);
        };
        const owner = await mkUser("owner");
        const member = await mkUser("member");
        const financeMember = await mkUser("finance");
        const groupMember = await mkUser("grouped");
        const guest = await mkUser("guest");
        const viewer = await mkUser("viewer");

        await test.db.insert(userCompanyMemberships).values([
            { userId: owner, companyId, role: "owner", status: "active" },
            { userId: member, companyId, role: "member", status: "active" },
            { userId: financeMember, companyId, role: "member", status: "active" },
            { userId: groupMember, companyId, role: "member", status: "active" },
            { userId: guest, companyId, role: "guest", status: "active" },
            { userId: viewer, companyId, role: "viewer", status: "active" },
        ]);

        const [finance] = await test.db
            .insert(category)
            .values({ name: "Finance", companyId })
            .returning();
        const [general] = await test.db
            .insert(category)
            .values({ name: "General", companyId })
            .returning();

        const mkDoc = async (title: string, cat: string) => {
            const [d] = await test.db
                .insert(document)
                .values({ companyId, url: `local://${title}`, category: cat, title })
                .returning();
            return d!.id;
        };
        const docGeneral = await mkDoc("Handbook", "General");
        const docFinance = await mkDoc("Ledger", "Finance");
        const docBoardDeck = await mkDoc("Board deck", "General");

        const [grp] = await test.db
            .insert(workspaceGroups)
            .values({
                companyId,
                name: "Finance team",
                slug: "finance-team",
                createdBy: "auth_owner",
            })
            .returning();
        const financeGroup = BigInt(grp!.id);
        await test.db
            .insert(workspaceGroupMembers)
            .values({ groupId: financeGroup, userId: groupMember, addedBy: "auth_owner" });

        await test.db.insert(folderSettings).values({
            categoryId: BigInt(finance!.id),
            companyId,
            visibility: "restricted",
            updatedBy: "auth_owner",
        });
        await test.db.insert(folderGrants).values([
            {
                companyId,
                categoryId: BigInt(finance!.id),
                principalType: "user",
                principalId: financeMember.toString(),
                level: "view",
                grantedBy: "auth_owner",
            },
            {
                companyId,
                categoryId: BigInt(finance!.id),
                principalType: "group",
                principalId: financeGroup.toString(),
                level: "edit",
                grantedBy: "auth_owner",
            },
            {
                companyId,
                categoryId: BigInt(finance!.id),
                principalType: "role",
                principalId: "guest",
                level: "view",
                grantedBy: "auth_owner",
            },
        ]);

        // The board deck sits in the shared General folder but is restricted to
        // the viewer alone.
        await test.db.insert(documentSettings).values({
            documentId: BigInt(docBoardDeck),
            companyId,
            restricted: true,
            updatedBy: "auth_owner",
        });
        await test.db.insert(documentGrants).values({
            companyId,
            documentId: BigInt(docBoardDeck),
            principalType: "user",
            principalId: viewer.toString(),
            level: "view",
            grantedBy: "auth_owner",
        });

        ids = {
            companyId,
            owner,
            member,
            financeMember,
            groupMember,
            guest,
            viewer,
            finance: BigInt(finance!.id),
            general: BigInt(general!.id),
            docGeneral,
            docFinance,
            docBoardDeck,
            financeGroup,
        };
    });

    afterAll(async () => {
        mockActiveDb = null;
        await test?.close();
    });

    async function scopeFor(userPk: bigint, role: string) {
        const { resolveDocumentScope } = await import("~/lib/authz/scope");
        const { builtinRolePermissions } = await import("~/lib/authz/permissions");
        return resolveDocumentScope({
            companyId: ids.companyId,
            userPk,
            role,
            permissions: builtinRolePermissions(role)!,
        });
    }

    async function visibleTitles(userPk: bigint, role: string) {
        const { scopedDocumentWhere } = await import("~/lib/authz/scope");
        const scope = await scopeFor(userPk, role);
        const rows = await test.db
            .select({ title: document.title })
            .from(document)
            .where(scopedDocumentWhere(ids.companyId, scope));
        return rows.map(r => r.title).sort();
    }

    it("gives an owner everything without touching the grant tables", async () => {
        const scope = await scopeFor(ids.owner, "owner");
        expect(scope.kind).toBe("everything");
        expect(await visibleTitles(ids.owner, "owner")).toEqual([
            "Board deck",
            "Handbook",
            "Ledger",
        ]);
    });

    it("hides the restricted folder and the restricted document from a plain member", async () => {
        const scope = await scopeFor(ids.member, "member");
        expect(scope).toEqual({
            kind: "except",
            deniedCategories: ["Finance"],
            deniedDocumentIds: [ids.docBoardDeck],
            allowedDocumentIds: [],
        });
        expect(await visibleTitles(ids.member, "member")).toEqual(["Handbook"]);
    });

    it("opens the folder through a user grant", async () => {
        expect(await visibleTitles(ids.financeMember, "member")).toEqual(["Handbook", "Ledger"]);
    });

    it("opens the folder through a group grant", async () => {
        expect(await visibleTitles(ids.groupMember, "member")).toEqual(["Handbook", "Ledger"]);
    });

    it("re-allows a restricted document through an explicit document grant", async () => {
        const scope = await scopeFor(ids.viewer, "viewer");
        expect(scope).toEqual({
            kind: "except",
            deniedCategories: ["Finance"],
            deniedDocumentIds: [],
            allowedDocumentIds: [ids.docBoardDeck],
        });
        expect(await visibleTitles(ids.viewer, "viewer")).toEqual(["Board deck", "Handbook"]);
    });

    it("confines a guest to the folders granted to their role", async () => {
        const scope = await scopeFor(ids.guest, "guest");
        expect(scope).toEqual({
            kind: "only",
            allowedCategories: ["Finance"],
            deniedDocumentIds: [ids.docBoardDeck],
            allowedDocumentIds: [],
        });
        expect(await visibleTitles(ids.guest, "guest")).toEqual(["Ledger"]);
    });

    it("gives a person without documents.read nothing at all", async () => {
        const { resolveDocumentScope } = await import("~/lib/authz/scope");
        const { scopedDocumentWhere } = await import("~/lib/authz/scope");
        const scope = await resolveDocumentScope({
            companyId: ids.companyId,
            userPk: ids.member,
            role: "custom-no-read",
            permissions: new Set(),
        });
        expect(scope.kind).toBe("only");
        const rows = await test.db
            .select({ id: document.id })
            .from(document)
            .where(scopedDocumentWhere(ids.companyId, scope));
        expect(rows).toEqual([]);
    });

    it("collapses to everything once the workspace has nothing restricted", async () => {
        const { folderSettings, documentSettings } = await import("~/server/db/schema");
        await test.db.delete(folderSettings).where(eq(folderSettings.companyId, ids.companyId));
        await test.db
            .delete(documentSettings)
            .where(eq(documentSettings.companyId, ids.companyId));

        const scope = await scopeFor(ids.member, "member");
        expect(scope.kind).toBe("everything");
        expect(await visibleTitles(ids.member, "member")).toEqual([
            "Board deck",
            "Handbook",
            "Ledger",
        ]);
    });
});
