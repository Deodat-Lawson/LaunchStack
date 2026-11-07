/**
 * Synced files deleted in LaunchStack stay deleted, against a real Postgres.
 * Deleting a Drive or Notion document records it in the same transaction
 * (with its title and who deleted it); an upload records nothing. Settings
 * names a file only to whoever deleted it. Picking a Drive folder again
 * forgets the deletes that came in through it; "Sync again" forgets named
 * ones; a Drive file picked on its own is never listed, since picking it
 * again is how it comes back.
 *
 * Gated like the other integration suites: runs only when
 * LAUNCHSTACK_TEST_DATABASE_URL (or DATABASE_URL) points at a local server.
 */
import { eq } from "drizzle-orm";

import { company, document } from "@launchstack/store/schema";
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

describeDb("connector deleted items (integration)", () => {
    jest.setTimeout(120_000);

    let test: Awaited<ReturnType<typeof createFounderWeeklyReviewTestDatabase>>;
    let companyId: bigint;
    let driveId: number;
    let notionId: number;
    const pk: Record<string, number> = {};

    function driveMeta(fileId: string, pickedRootId: string) {
        return {
            connector: "google-drive",
            connectionId: String(driveId),
            sourceId: fileId,
            driveFileId: fileId,
            pickedRootId,
            folderPath: [],
        };
    }

    function notionMeta(pageId: string) {
        return {
            connector: "notion",
            connectionId: String(notionId),
            sourceId: pageId,
            notionPageId: pageId,
        };
    }

    async function insertDoc(title: string, ocrMetadata: Record<string, unknown> | null) {
        const [row] = await test.db
            .insert(document)
            .values({
                companyId,
                url: `local://${title}`,
                category: "Docs",
                title,
                ocrMetadata,
            })
            .returning();
        return row!.id;
    }

    async function deleteAs(name: "ada" | "ben", ...ids: number[]) {
        const { deleteDocumentCore } = await import("~/server/services/document-delete");
        await test.db.transaction(async tx => {
            for (const id of ids) {
                await deleteDocumentCore(tx, id, { deletedByUserPk: pk[name] });
            }
        });
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
            pk[name] = Number(u!.id);
            await test.db.insert(userCompanyMemberships).values({
                userId: BigInt(u!.id),
                companyId,
                role: "admin",
                status: "active",
            });
        }
        const [drive, notion] = await test.db
            .insert(connectorConnections)
            .values([
                {
                    companyId,
                    provider: "google-drive",
                    providerAccountId: "google-sub-1",
                    scopes: "https://www.googleapis.com/auth/drive.readonly",
                    grantedByUserId: BigInt(pk.ada!),
                },
                {
                    companyId,
                    provider: "notion",
                    providerAccountId: "notion-ws-1",
                    scopes: "",
                    grantedByUserId: BigInt(pk.ada!),
                },
            ])
            .returning();
        driveId = Number(drive!.id);
        notionId = Number(notion!.id);
    });

    afterAll(async () => {
        mockActiveDb = null;
        await test?.close();
    });

    it("records a deleted Drive or Notion document, and nothing for an upload", async () => {
        const { listDeletedItems, listDeletedSourceIds } = await import(
            "~/server/services/connectors/deleted-items"
        );
        const { googleDrivePickedItem } = await import("~/server/db/schema/connectors");
        await test.db.insert(googleDrivePickedItem).values([
            { connectionId: driveId, fileId: "templates", kind: "folder", name: "Templates" },
            { connectionId: driveId, fileId: "deck", kind: "file", name: "Board deck" },
        ]);

        const template = await insertDoc("Design template", driveMeta("tpl-1", "templates"));
        const deck = await insertDoc("Board deck", driveMeta("deck", "deck"));
        const page = await insertDoc("Roadmap", notionMeta("page-1"));
        const upload = await insertDoc("Upload", null);
        await deleteAs("ada", template, deck, page, upload);

        expect((await listDeletedSourceIds(driveId)).sort()).toEqual(["deck", "tpl-1"]);
        expect(await listDeletedSourceIds(notionId)).toEqual(["page-1"]);

        const rows = await listDeletedItems([driveId, notionId]);
        expect(rows).toHaveLength(3);
        expect(rows.find(row => row.sourceId === "tpl-1")).toMatchObject({
            connectionId: driveId,
            pickedRootId: "templates",
            title: "Design template",
            deletedByUserPk: pk.ada,
        });

        // The documents are gone; the folder's pick stays, the file's own pick went.
        const docs = await test.db.select({ id: document.id }).from(document);
        expect(docs.map(row => row.id)).not.toEqual(
            expect.arrayContaining([template, deck, page, upload])
        );
        const picks = await test.db
            .select({ fileId: googleDrivePickedItem.fileId })
            .from(googleDrivePickedItem)
            .where(eq(googleDrivePickedItem.connectionId, driveId));
        expect(picks.map(row => row.fileId)).toEqual(["templates"]);
    });

    it("names a deleted file only to whoever deleted it, and never lists a file's own pick", async () => {
        const { isListableDriveRow, listDeletedItems, summarizeDeletedItems } = await import(
            "~/server/services/connectors/deleted-items"
        );
        const brief = await insertDoc("Brief", driveMeta("tpl-2", "templates"));
        await deleteAs("ben", brief);

        const rows = await listDeletedItems([driveId]);
        const forAda = summarizeDeletedItems(rows, pk.ada!, { listable: isListableDriveRow });
        const forBen = summarizeDeletedItems(rows, pk.ben!, { listable: isListableDriveRow });

        // "deck" was its own pick: it comes back by being picked again, so it is not listed.
        expect(forAda.items.map(item => item.title)).toEqual(["Design template"]);
        expect(forAda.others).toBe(1);
        expect(forBen.items.map(item => item.title)).toEqual(["Brief"]);
        expect(forBen.others).toBe(1);
    });

    it("forgets the deletes under a folder picked again, and the file itself", async () => {
        const { forgetDeletedUnderPicks, listDeletedSourceIds } = await import(
            "~/server/services/connectors/deleted-items"
        );
        await forgetDeletedUnderPicks(driveId, ["templates"]);
        expect(await listDeletedSourceIds(driveId)).toEqual(["deck"]);

        await forgetDeletedUnderPicks(driveId, ["deck"]);
        expect(await listDeletedSourceIds(driveId)).toEqual([]);
    });

    it("forgets named files for Sync again, and only on that connection", async () => {
        const { forgetDeletedItems, isSourceDeleted, listDeletedSourceIds } = await import(
            "~/server/services/connectors/deleted-items"
        );
        expect(await isSourceDeleted(notionId, "page-1")).toBe(true);
        expect(await forgetDeletedItems(driveId, { sourceIds: ["page-1"] })).toBe(0);
        expect(await forgetDeletedItems(notionId, { sourceIds: ["page-1"] })).toBe(1);
        expect(await isSourceDeleted(notionId, "page-1")).toBe(false);
        expect(await listDeletedSourceIds(notionId)).toEqual([]);
    });

    it("updates the record when the same file is synced and deleted again", async () => {
        const { listDeletedItems } = await import("~/server/services/connectors/deleted-items");
        const first = await insertDoc("Roadmap v1", notionMeta("page-2"));
        await deleteAs("ada", first);
        const second = await insertDoc("Roadmap v2", notionMeta("page-2"));
        await deleteAs("ben", second);

        const rows = (await listDeletedItems([notionId])).filter(row => row.sourceId === "page-2");
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ title: "Roadmap v2", deletedByUserPk: pk.ben });
    });

    it("goes with the connection when it is disconnected", async () => {
        const { connectorConnections } = await import("~/server/db/schema");
        const { listDeletedSourceIds } = await import("~/server/services/connectors/deleted-items");
        expect(await listDeletedSourceIds(notionId)).toEqual(["page-2"]);
        await test.db.delete(connectorConnections).where(eq(connectorConnections.id, notionId));
        expect(await listDeletedSourceIds(notionId)).toEqual([]);
    });
});
