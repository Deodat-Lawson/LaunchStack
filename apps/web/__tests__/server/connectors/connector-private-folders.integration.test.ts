/**
 * Connector folders against a real Postgres: where Notion pages and Obsidian
 * notes land, and who can see them.
 *
 * - A claimed folder is restricted with a manage grant for its owner, so the
 *   owner sees it and other members do not.
 * - Two Notion connections whose workspace names clean to the same path get
 *   separate folders; neither sees the other's pages.
 * - A Notion connection re-authorized by another admin keeps its folder, and
 *   the new admin is granted access to it.
 * - An Obsidian vault re-imported by its importer finds its folder again; a
 *   second person's vault of the same name gets "(2)".
 * - A root folder that already existed keeps the audience it had.
 *
 * Gated like the other integration suites: runs only when
 * LAUNCHSTACK_TEST_DATABASE_URL (or DATABASE_URL) points at a local server.
 */
import { and, eq } from "drizzle-orm";

import { category, company } from "@launchstack/store/schema";
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

describeDb("connector private folders (integration)", () => {
    jest.setTimeout(120_000);

    let test: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyId: bigint;
    const pk: Record<string, bigint> = {};

    type Person = "ada" | "ben";

    function owner(name: Person) {
        return { companyId, userPk: pk[name]!, authUserId: `auth_${name}` };
    }

    async function visibleFolders(name: Person): Promise<string[]> {
        const { buildWorkspaceContext } = await import("~/lib/require-workspace-context");
        const { builtinRolePermissions } = await import("~/lib/authz/permissions");
        const { listVisibleFolders } = await import("~/server/folders");
        // Members, not admins: folder admins see every restricted folder by design.
        const ctx = buildWorkspaceContext({
            authUserId: `auth_${name}`,
            userPk: pk[name]!,
            companyId,
            role: "member",
            status: "active",
            permissions: builtinRolePermissions("member")!,
        });
        return (await listVisibleFolders(companyId, await ctx.documentScope()))
            .map(folder => folder.path)
            .sort();
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
        for (const name of ["ada", "ben"] as const) {
            const [u] = await test.db
                .insert(users)
                .values({ name, email: `${name}@acme.test`, userId: `auth_${name}`, companyId })
                .returning();
            pk[name] = BigInt(u!.id);
            await test.db.insert(userCompanyMemberships).values({
                userId: pk[name],
                companyId,
                role: "member",
                status: "active",
            });
        }
    });

    afterAll(async () => {
        mockActiveDb = null;
        await test?.close();
    });

    it("gives same-named Notion workspaces separate folders, each private to its connector", async () => {
        const { ensureNotionFolder } = await import("~/server/services/connectors/notion/folder");

        const adas = await ensureNotionFolder({
            owner: owner("ada"),
            workspaceName: "Acme",
            rememberedCategoryId: null,
        });
        const bens = await ensureNotionFolder({
            owner: owner("ben"),
            workspaceName: "Acme",
            rememberedCategoryId: null,
        });

        expect(adas.path).toBe("Notion/Acme");
        expect(bens.path).toBe("Notion/Acme (2)");
        expect(await visibleFolders("ada")).toContain("Notion/Acme");
        expect(await visibleFolders("ada")).not.toContain("Notion/Acme (2)");
        expect(await visibleFolders("ben")).toContain("Notion/Acme (2)");
        expect(await visibleFolders("ben")).not.toContain("Notion/Acme");
    });

    it("keeps a re-authorized connection's folder and lets the new admin open it", async () => {
        const { ensureNotionFolder } = await import("~/server/services/connectors/notion/folder");
        const first = await ensureNotionFolder({
            owner: owner("ada"),
            workspaceName: "Globex",
            rememberedCategoryId: null,
        });
        expect(await visibleFolders("ben")).not.toContain(first.path);

        const after = await ensureNotionFolder({
            owner: owner("ben"),
            workspaceName: "Globex",
            rememberedCategoryId: first.categoryId,
        });

        expect(after).toEqual(first);
        expect(await visibleFolders("ben")).toContain(first.path);
    });

    it("finds an importer's own vault again, and numbers someone else's of the same name", async () => {
        const { ensureVaultFolder } = await import("~/server/services/connectors/obsidian/folder");

        const adas = await ensureVaultFolder(owner("ada"), "Notes");
        const adasAgain = await ensureVaultFolder(owner("ada"), "Notes");
        const bens = await ensureVaultFolder(owner("ben"), "Notes");

        expect(adas).toBe("Obsidian/Notes");
        expect(adasAgain).toBe("Obsidian/Notes");
        expect(bens).toBe("Obsidian/Notes (2)");
        expect(await visibleFolders("ben")).not.toContain("Obsidian/Notes");
    });

    it("leaves a root folder that already existed with the audience it had", async () => {
        const { createFolder } = await import("~/server/folders");
        const { folderSettings } = await import("~/server/db/schema");
        const { claimPrivateFolder } = await import("~/server/services/connectors/private-folder");
        await createFolder(companyId, "Shared");

        const claimed = await claimPrivateFolder({
            owner: owner("ada"),
            root: "Shared",
            name: "Ada's",
            fallback: "Folder",
        });

        const [root] = await test.db
            .select({ id: category.id })
            .from(category)
            .where(and(eq(category.companyId, companyId), eq(category.name, "Shared")))
            .limit(1);
        const rootSettings = await test.db
            .select()
            .from(folderSettings)
            .where(eq(folderSettings.categoryId, BigInt(root!.id)));
        expect(rootSettings).toEqual([]);
        expect(await visibleFolders("ben")).toContain("Shared");
        expect(await visibleFolders("ben")).not.toContain(claimed.path);
    });
});
