/**
 * ADR-014 against a real Postgres: moving, deleting and creating folders and
 * files never widens who can see something by accident, and the team feed
 * never names a private folder to someone who can't see it.
 *
 * Gated like the other integration suites: runs only when
 * LAUNCHSTACK_TEST_DATABASE_URL (or DATABASE_URL) points at a local server.
 */
import { eq } from "drizzle-orm";

import { category, company, document } from "@launchstack/store/schema";
import type { DbClient } from "@launchstack/store/client";

import { createFounderWeeklyReviewTestDatabase } from "../../founderWeeklyReview/testDb";

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

describeDb("folder moves, deletes and creates (integration)", () => {
    jest.setTimeout(120_000);

    let test: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyId: bigint;
    const pk: Record<string, bigint> = {};

    async function ctxFor(name: "ada" | "ben" | "cy", role = "member") {
        const { buildWorkspaceContext } = await import("~/lib/require-workspace-context");
        const { builtinRolePermissions } = await import("~/lib/authz/permissions");
        return buildWorkspaceContext({
            authUserId: `auth_${name}`,
            userPk: pk[name]!,
            companyId,
            role,
            status: "active",
            permissions: builtinRolePermissions(role)!,
        });
    }

    async function titlesFor(name: "ada" | "ben" | "cy", role = "member") {
        const { scopedDocumentWhere } = await import("~/lib/authz/scope");
        const ctx = await ctxFor(name, role);
        const rows = await test.db
            .select({ title: document.title })
            .from(document)
            .where(scopedDocumentWhere(companyId, await ctx.documentScope()));
        return rows.map(r => r.title).sort();
    }

    /** Set a folder's audience directly (restricted with these grants, or open). */
    async function setAudience(
        path: string,
        restricted: boolean,
        grants: { who: "ada" | "ben" | "cy"; level: string }[]
    ) {
        const { folderSettings, folderGrants } = await import("~/server/db/schema");
        const [row] = await test.db
            .select({ id: category.id })
            .from(category)
            .where(eq(category.name, path));
        const categoryId = BigInt(row!.id);
        await test.db.delete(folderSettings).where(eq(folderSettings.categoryId, categoryId));
        await test.db.delete(folderGrants).where(eq(folderGrants.categoryId, categoryId));
        if (restricted) {
            await test.db
                .insert(folderSettings)
                .values({ categoryId, companyId, visibility: "restricted", updatedBy: "auth_ada" });
        }
        for (const g of grants) {
            await test.db.insert(folderGrants).values({
                companyId,
                categoryId,
                principalType: "user",
                principalId: pk[g.who]!.toString(),
                level: g.level,
                grantedBy: "auth_ada",
            });
        }
    }

    async function addDoc(title: string, cat: string) {
        const [d] = await test.db
            .insert(document)
            .values({ companyId, url: `local://${title}`, category: cat, title })
            .returning();
        return d!.id;
    }

    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        mockActiveDb = test.db;
        const { users, userCompanyMemberships } = await import("~/server/db/schema");
        const [co] = await test.db
            .insert(company)
            .values({ name: "Acme", numberOfEmployees: "5" })
            .returning();
        companyId = BigInt(co!.id);
        for (const name of ["ada", "ben", "cy"] as const) {
            const [u] = await test.db
                .insert(users)
                .values({ name, email: `${name}@acme.test`, userId: `auth_${name}`, companyId })
                .returning();
            pk[name] = BigInt(u!.id);
            await test.db
                .insert(userCompanyMemberships)
                .values({ userId: pk[name], companyId, role: "member", status: "active" });
        }
    });

    afterAll(async () => {
        mockActiveDb = null;
        await test?.close();
    });

    it("keeps a private subfolder private when it is moved to the top level", async () => {
        const { createFolderAs, renameFolderAs } = await import(
            "~/server/workspace/folder-actions"
        );
        const ada = await ctxFor("ada");
        await createFolderAs(ada, "Plans");
        await createFolderAs(ada, "Plans/Comp");
        await addDoc("Salaries", "Plans/Comp");
        expect(await titlesFor("ben")).not.toContain("Salaries");

        const moved = await renameFolderAs(ada, "Plans/Comp", "Comp");

        expect(moved.access).toBe("kept_audience");
        expect(await titlesFor("ben")).not.toContain("Salaries");
        expect(await titlesFor("ada")).toContain("Salaries");
    });

    it("stops an editor publishing the owner's files by moving a subfolder out", async () => {
        const { createFolderAs, renameFolderAs } = await import(
            "~/server/workspace/folder-actions"
        );
        const ada = await ctxFor("ada");
        const ben = await ctxFor("ben");
        await createFolderAs(ada, "Board");
        await setAudience("Board", true, [
            { who: "ada", level: "manage" },
            { who: "ben", level: "edit" },
        ]);
        await createFolderAs(ben, "Board/Drop");
        await addDoc("Board minutes", "Board/Drop");

        await renameFolderAs(ben, "Board/Drop", "Drop");

        expect(await titlesFor("cy")).not.toContain("Board minutes");
        expect(await titlesFor("ada")).toContain("Board minutes");
        expect(await titlesFor("ben")).toContain("Board minutes");
    });

    it("lets you file your own private folder into a team folder, where the team sees it", async () => {
        const { createFolderAs, renameFolderAs } = await import(
            "~/server/workspace/folder-actions"
        );
        const ada = await ctxFor("ada");
        await createFolderAs(ada, "Team");
        // Publish Team to everyone; keep Ada's manage grant.
        await setAudience("Team", false, [{ who: "ada", level: "manage" }]);
        await createFolderAs(ada, "Drafts");
        await createFolderAs(ada, "Drafts/Launch");
        await addDoc("Launch draft", "Drafts/Launch");
        expect(await titlesFor("cy")).not.toContain("Launch draft");

        const moved = await renameFolderAs(ada, "Drafts/Launch", "Team/Launch");

        expect(moved.access).toBe("inherits_folder");
        expect(await titlesFor("cy")).toContain("Launch draft");
    });

    it("keeps a file's audience when someone moves it out of a private folder", async () => {
        const { applyDocumentMoveDefaults } = await import("~/server/workspace/ownership");
        // Board is Ada (manage) + Ben (edit); Team is workspace-wide.
        const id = await addDoc("Board budget", "Board");
        await test.db.update(document).set({ category: "Team" }).where(eq(document.id, id));
        const result = await applyDocumentMoveDefaults(
            test.db,
            { companyId, userPk: pk.ben!, authUserId: "auth_ben" },
            { id, fromCategory: "Board", toCategory: "Team" }
        );
        expect(result).toBe("kept_audience");
        expect(await titlesFor("cy")).not.toContain("Board budget");
        expect(await titlesFor("ben")).toContain("Board budget");
    });

    it("makes a folder that springs into being with an upload private to the uploader", async () => {
        const { applyDocumentCreationDefaults } = await import("~/server/workspace/ownership");
        const id = await addDoc("Offer letter", "Hiring/Offers");
        await applyDocumentCreationDefaults(
            test.db,
            { companyId, userPk: pk.ada!, authUserId: "auth_ada" },
            [{ id, category: "Hiring/Offers" }]
        );
        expect(await titlesFor("cy")).not.toContain("Offer letter");
        expect(await titlesFor("ada")).toContain("Offer letter");
    });

    it("never publishes a restricted folder's files when the folder is deleted", async () => {
        const { createFolderAs, deleteFolderAs } = await import(
            "~/server/workspace/folder-actions"
        );
        const ada = await ctxFor("ada");
        await createFolderAs(ada, "Secret");
        await addDoc("Secret plan", "Secret");
        await deleteFolderAs(ada, "Secret");
        expect(await titlesFor("cy")).not.toContain("Secret plan");
        expect(await titlesFor("ada")).toContain("Secret plan");
    });

    it("gives a second person's folder its own name instead of silently doing nothing", async () => {
        const { createFolderAs } = await import("~/server/workspace/folder-actions");
        const ada = await ctxFor("ada");
        const cy = await ctxFor("cy");
        await createFolderAs(ada, "Notes");
        const made = await createFolderAs(cy, "Notes");
        expect(made.renamedTo).toBe("Notes (2)");
        const rows = await test.db.select({ name: category.name }).from(category);
        expect(rows.map(r => r.name)).toEqual(expect.arrayContaining(["Notes", "Notes (2)"]));
    });

    it("never names a renamed or deleted private folder in someone else's feed", async () => {
        const { createFolderAs, renameFolderAs, deleteFolderAs } = await import(
            "~/server/workspace/folder-actions"
        );
        const { listActivity } = await import("~/server/workspace/activity");
        const { workspaceActivity } = await import("~/server/db/schema");
        const ada = await ctxFor("ada");
        await createFolderAs(ada, "Layoffs");
        await renameFolderAs(ada, "Layoffs", "Reorg");
        await createFolderAs(ada, "Acquisition");
        await deleteFolderAs(ada, "Acquisition");
        // An older row written before folder ids were recorded: path only.
        await test.db.insert(workspaceActivity).values({
            companyId,
            actorUserId: "auth_ada",
            verb: "created_folder",
            targetType: "folder",
            targetLabel: "Old secret",
            targetPath: "Old secret",
        });

        const cyFeed = JSON.stringify((await listActivity(await ctxFor("cy"))).entries);
        for (const name of ["Layoffs", "Reorg", "Acquisition", "Old secret"]) {
            expect(cyFeed).not.toContain(name);
        }
        const adaFeed = JSON.stringify((await listActivity(ada)).entries);
        expect(adaFeed).toContain("Reorg");
    });
});
