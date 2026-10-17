/**
 * Where an imported Google Drive folder lands, against a real Postgres
 * (ADR-014): a picked folder becomes a top-level LaunchStack folder private
 * to whoever picked it, its subfolders are rebuilt beneath it with a manage
 * grant for them, a sync storing four files at once never makes a folder
 * twice, the folder is remembered by id so a rename in LaunchStack is
 * followed, and a name someone else already uses gets " (2)".
 *
 * Gated like the other integration suites: runs only when
 * LAUNCHSTACK_TEST_DATABASE_URL (or DATABASE_URL) points at a local server.
 */
import { and, eq } from "drizzle-orm";

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

describeDb("Drive folder destinations (integration)", () => {
    jest.setTimeout(120_000);

    let test: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyId: bigint;
    let connectionId: number;
    const pk: Record<string, bigint> = {};

    async function ctxFor(name: "ada" | "ben") {
        const { buildWorkspaceContext } = await import("~/lib/require-workspace-context");
        const { builtinRolePermissions } = await import("~/lib/authz/permissions");
        return buildWorkspaceContext({
            authUserId: `auth_${name}`,
            userPk: pk[name]!,
            companyId,
            role: name === "ada" ? "admin" : "member",
            status: "active",
            permissions: builtinRolePermissions(name === "ada" ? "admin" : "member")!,
        });
    }

    async function visibleFolders(name: "ada" | "ben"): Promise<string[]> {
        const { listVisibleFolders } = await import("~/server/folders");
        const ctx = await ctxFor(name);
        return (await listVisibleFolders(companyId, await ctx.documentScope()))
            .map(f => f.path)
            .sort();
    }

    async function pickRow(fileId: string, kind: "file" | "folder", name: string) {
        const { googleDrivePickedItem } = await import("~/server/db/schema/connectors");
        const [row] = await test.db
            .insert(googleDrivePickedItem)
            .values({ connectionId, fileId, kind, name, addedByUserPk: Number(pk.ada) })
            .returning();
        return row!;
    }

    function owner() {
        return { companyId, userPk: pk.ada!, authUserId: "auth_ada" };
    }

    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        mockActiveDb = test.db;
        const { users, userCompanyMemberships, connectorConnections } = await import(
            "~/server/db/schema"
        );
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
                role: name === "ada" ? "admin" : "member",
                status: "active",
            });
        }
        const [conn] = await test.db
            .insert(connectorConnections)
            .values({
                companyId,
                provider: "google-drive",
                providerAccountId: "google-sub-1",
                scopes: "https://www.googleapis.com/auth/drive.readonly",
                grantedByUserId: pk.ada,
            })
            .returning();
        connectionId = Number(conn!.id);
    });

    afterAll(async () => {
        mockActiveDb = null;
        await test?.close();
    });

    it("rebuilds a picked folder as a private top-level folder with its subfolders, once", async () => {
        const { createDriveDestinations } = await import(
            "~/server/services/connectors/google-drive/destinations"
        );
        const { folderGrants, folderSettings } = await import("~/server/db/schema");
        const { googleDrivePickedItem } = await import("~/server/db/schema/connectors");
        const room = await pickRow("room", "folder", "Acme Seed Data Room");
        const solo = await pickRow("solo", "file", "Pitch notes");

        const destinations = createDriveDestinations({
            companyId,
            connectionId,
            roots: [
                { ...room, folderCategoryId: null, owner: owner() },
                { ...solo, folderCategoryId: null, owner: owner() },
            ],
        });
        // Four files stored at once, two of them reaching the same new subfolder.
        const placements = await Promise.all(
            [[], ["Financials"], ["Financials", "Archive"], ["Financials"]].map(folderPath =>
                destinations.placeFor({ metadata: { pickedRootId: "room", folderPath } })
            )
        );
        expect(placements.map(p => p.category)).toEqual([
            "Acme Seed Data Room",
            "Acme Seed Data Room/Financials",
            "Acme Seed Data Room/Financials/Archive",
            "Acme Seed Data Room/Financials",
        ]);
        expect(placements.every(p => p.owner?.authUserId === "auth_ada")).toBe(true);

        const single = await destinations.placeFor({
            metadata: { pickedRootId: "solo", folderPath: [] },
        });
        expect(single).toEqual({ category: "Google Drive", owner: null });

        const rows = await test.db
            .select({ id: category.id, name: category.name })
            .from(category)
            .where(eq(category.companyId, companyId));
        const names = rows.map(r => r.name).sort();
        expect(names).toEqual([
            "Acme Seed Data Room",
            "Acme Seed Data Room/Financials",
            "Acme Seed Data Room/Financials/Archive",
        ]);

        const rootId = rows.find(r => r.name === "Acme Seed Data Room")!.id;
        const [settings] = await test.db
            .select()
            .from(folderSettings)
            .where(eq(folderSettings.categoryId, BigInt(rootId)));
        expect(settings?.visibility).toBe("restricted");
        const grants = await test.db
            .select({ categoryId: folderGrants.categoryId, level: folderGrants.level })
            .from(folderGrants)
            .where(
                and(
                    eq(folderGrants.companyId, companyId),
                    eq(folderGrants.principalId, pk.ada!.toString())
                )
            );
        expect(grants).toHaveLength(3);
        expect(new Set(grants.map(g => g.level))).toEqual(new Set(["manage"]));

        const [picked] = await test.db
            .select({ folderCategoryId: googleDrivePickedItem.folderCategoryId })
            .from(googleDrivePickedItem)
            .where(eq(googleDrivePickedItem.id, room.id));
        expect(picked?.folderCategoryId).toBe(Number(rootId));

        expect(await visibleFolders("ada")).toContain("Acme Seed Data Room/Financials/Archive");
        expect(await visibleFolders("ben")).not.toContain("Acme Seed Data Room");
    });

    it("gives a file in the imported folder to its importer, still hidden from everyone else", async () => {
        const { applyDocumentCreationDefaults } = await import("~/server/workspace/ownership");
        const { scopedDocumentWhere } = await import("~/lib/authz/scope");
        const [doc] = await test.db
            .insert(document)
            .values({
                companyId,
                url: "local://plan",
                category: "Acme Seed Data Room/Financials",
                title: "FY2027 operating plan",
            })
            .returning();
        await applyDocumentCreationDefaults(test.db, owner(), [
            { id: doc!.id, category: "Acme Seed Data Room/Financials" },
        ]);

        async function titles(name: "ada" | "ben") {
            const ctx = await ctxFor(name);
            const rows = await test.db
                .select({ title: document.title })
                .from(document)
                .where(scopedDocumentWhere(companyId, await ctx.documentScope()));
            return rows.map(r => r.title);
        }
        expect(await titles("ada")).toContain("FY2027 operating plan");
        expect(await titles("ben")).not.toContain("FY2027 operating plan");
    });

    it("follows a rename in LaunchStack on the next sync, and never mixes two imports", async () => {
        const { createDriveDestinations } = await import(
            "~/server/services/connectors/google-drive/destinations"
        );
        const { renameFolder } = await import("~/server/folders");
        const { googleDrivePickedItem } = await import("~/server/db/schema/connectors");
        await renameFolder(companyId, "Acme Seed Data Room", "Acme deal room");

        const [room] = await test.db
            .select()
            .from(googleDrivePickedItem)
            .where(eq(googleDrivePickedItem.fileId, "room"));
        const next = createDriveDestinations({
            companyId,
            connectionId,
            roots: [{ ...room!, owner: owner() }],
        });
        const placed = await next.placeFor({
            metadata: { pickedRootId: "room", folderPath: ["Legal"] },
        });
        expect(placed.category).toBe("Acme deal room/Legal");

        // Someone picks a different Drive folder that happens to share the name.
        const twin = await pickRow("twin", "folder", "Acme deal room");
        const withTwin = createDriveDestinations({
            companyId,
            connectionId,
            roots: [{ ...twin, folderCategoryId: null, owner: owner() }],
        });
        const twinPlaced = await withTwin.placeFor({
            metadata: { pickedRootId: "twin", folderPath: [] },
        });
        expect(twinPlaced.category).toBe("Acme deal room (2)");
    });

    it("finds the old folder again when a removed pick is picked again", async () => {
        const { createDriveDestinations } = await import(
            "~/server/services/connectors/google-drive/destinations"
        );
        const { googleDrivePickedItem } = await import("~/server/db/schema/connectors");
        // A file the earlier pick brought in, one subfolder down.
        await test.db.insert(document).values({
            companyId,
            url: "local://legal-memo",
            category: "Acme deal room/Legal",
            title: "Legal memo",
            ocrMetadata: {
                connector: "google-drive",
                connectionId: String(connectionId),
                pickedRootId: "room",
                folderPath: ["Legal"],
            },
        });
        // "Stop syncing" deletes the row; picking it again inserts a fresh one.
        await test.db.delete(googleDrivePickedItem).where(eq(googleDrivePickedItem.fileId, "room"));
        const again = await pickRow("room", "folder", "Acme Seed Data Room");

        const destinations = createDriveDestinations({
            companyId,
            connectionId,
            roots: [{ ...again, folderCategoryId: null, owner: owner() }],
        });
        const placed = await destinations.placeFor({
            metadata: { pickedRootId: "room", folderPath: ["Financials"] },
        });

        expect(placed.category).toBe("Acme deal room/Financials");
        const [row] = await test.db
            .select({ folderCategoryId: googleDrivePickedItem.folderCategoryId })
            .from(googleDrivePickedItem)
            .where(eq(googleDrivePickedItem.id, again.id));
        const [folder] = await test.db
            .select({ id: category.id })
            .from(category)
            .where(and(eq(category.companyId, companyId), eq(category.name, "Acme deal room")));
        expect(row?.folderCategoryId).toBe(Number(folder!.id));
    });
});
