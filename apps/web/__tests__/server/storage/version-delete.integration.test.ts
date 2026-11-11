/** @jest-environment node */

import { eq } from "drizzle-orm";
import type { DbClient } from "@launchstack/store/client";
import type * as DatabaseAdapter from "~/server/storage/adapters/database";
import { company, document, documentVersions, fileUploads } from "@launchstack/store/schema";
import type { ObjectRef } from "~/server/storage/object-ref";
import {
    createFounderWeeklyReviewTestDatabase,
    type FounderWeeklyReviewTestDatabase,
} from "../../founderWeeklyReview/testDb";

const mockPermission = jest.fn();
let mockDatabase: DbClient;

jest.mock("~/server/db", () => ({
    get db() {
        return mockDatabase;
    },
}));
jest.mock("~/server/engine", () => ({ getEngine: () => ({ db: mockDatabase }) }));
jest.mock("~/env", () => ({ env: { server: {} } }));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspacePermission: () => mockPermission(),
}));
jest.mock("~/lib/authz/scope", () => ({ scopedDocumentWhere: () => undefined }));
jest.mock("~/server/workspace/item-access", () => ({ canEditDocument: async () => true }));
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _preset: unknown, handler: () => Promise<Response>) =>
        handler(),
}));
jest.mock("~/lib/rate-limiter", () => ({ RateLimitPresets: { strict: {} } }));
// Exercise the real database adapter without loading unrelated provider SDKs.
jest.mock("~/server/storage/delete-objects", () => ({
    deleteStoredObjects: (refs: readonly ObjectRef[]) =>
        jest
            .requireActual<typeof DatabaseAdapter>("~/server/storage/adapters/database")
            .deleteObjects(refs),
}));

import { DELETE } from "~/app/api/documents/[id]/versions/[versionId]/route";

const describeDb = process.env.LAUNCHSTACK_TEST_DATABASE_URL ? describe : describe.skip;

describeDb("version deletion byte ownership and references (database)", () => {
    jest.setTimeout(120_000);
    let test: FounderWeeklyReviewTestDatabase;
    let companyId: bigint;
    let foreignCompanyId: bigint;
    let documentId: number;
    let versionId: number;
    let fileId: number;
    let fileUrl: string;

    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        mockDatabase = test.db;
    });
    afterAll(async () => {
        await test?.close();
    });
    beforeEach(async () => {
        const companies = await mockDatabase
            .insert(company)
            .values([
                { name: "Version owner", numberOfEmployees: "1" },
                { name: "Other workspace", numberOfEmployees: "1" },
            ])
            .returning({ id: company.id });
        companyId = BigInt(companies[0]!.id);
        foreignCompanyId = BigInt(companies[1]!.id);
        const [file] = await mockDatabase
            .insert(fileUploads)
            .values({
                userId: "user1",
                companyId,
                filename: "original.txt",
                mimeType: "text/plain",
                fileData: "aGVsbG8=",
                fileSize: 5,
            })
            .returning({ id: fileUploads.id });
        fileId = file!.id;
        fileUrl = `/api/files/${fileId}`;
        const [doc] = await mockDatabase
            .insert(document)
            .values({
                companyId,
                url: "https://example.com/current",
                category: "document",
                title: "Versions",
            })
            .returning({ id: document.id });
        documentId = doc!.id;
        const versions = await mockDatabase
            .insert(documentVersions)
            .values([
                {
                    documentId: BigInt(documentId),
                    versionNumber: 1,
                    url: fileUrl,
                    mimeType: "text/plain",
                },
                {
                    documentId: BigInt(documentId),
                    versionNumber: 2,
                    url: "https://example.com/current",
                    mimeType: "text/plain",
                },
            ])
            .returning({ id: documentVersions.id });
        versionId = versions[0]!.id;
        await mockDatabase
            .update(document)
            .set({ currentVersionId: BigInt(versions[1]!.id) })
            .where(eq(document.id, documentId));
        mockPermission.mockResolvedValue({
            success: true,
            data: { companyId, authUserId: "user1", documentScope: async () => ({}) },
        });
    });

    async function removeVersion() {
        const response = await DELETE(
            new Request(`http://app.test/api/documents/${documentId}/versions/${versionId}`),
            {
                params: Promise.resolve({ id: String(documentId), versionId: String(versionId) }),
            }
        );
        expect(response.status).toBe(200);
        expect(
            await mockDatabase
                .select()
                .from(documentVersions)
                .where(eq(documentVersions.id, versionId))
        ).toHaveLength(0);
    }
    async function fileExists() {
        return (
            (
                await mockDatabase
                    .select({ id: fileUploads.id })
                    .from(fileUploads)
                    .where(eq(fileUploads.id, fileId))
            ).length > 0
        );
    }

    it("deletes unshared bytes owned by the caller's company", async () => {
        await removeVersion();
        expect(await fileExists()).toBe(false);
    });

    it.each(["foreign", "unstamped"])(
        "keeps a %s database file while removing the version",
        async ownership => {
            await mockDatabase
                .update(fileUploads)
                .set({ companyId: ownership === "foreign" ? foreignCompanyId : null })
                .where(eq(fileUploads.id, fileId));
            await removeVersion();
            expect(await fileExists()).toBe(true);
        }
    );

    it("keeps bytes reused by a re-embedded version", async () => {
        await mockDatabase.insert(documentVersions).values({
            documentId: BigInt(documentId),
            versionNumber: 3,
            url: fileUrl,
            mimeType: "text/plain",
        });
        await removeVersion();
        expect(await fileExists()).toBe(true);
    });

    it.each(["document URL", "document preview", "version URL", "version preview"])(
        "keeps bytes referenced by another workspace's %s",
        async reference => {
            const [other] = await mockDatabase
                .insert(document)
                .values({
                    companyId: foreignCompanyId,
                    url: reference === "document URL" ? fileUrl : "https://example.com/other",
                    category: "document",
                    title: "Shared reference",
                    ocrMetadata:
                        reference === "document preview"
                            ? { websitePreview: { url: fileUrl } }
                            : null,
                })
                .returning({ id: document.id });
            if (reference.startsWith("version")) {
                await mockDatabase.insert(documentVersions).values({
                    documentId: BigInt(other!.id),
                    versionNumber: 1,
                    mimeType: "text/plain",
                    url:
                        reference === "version URL" ? fileUrl : "https://example.com/other-version",
                    ocrMetadata:
                        reference === "version preview"
                            ? { websitePreview: { url: fileUrl } }
                            : null,
                });
            }
            await removeVersion();
            expect(await fileExists()).toBe(true);
        }
    );

    it.each(["document", "version"])(
        "keeps bytes while a %s still has a legacy absolute internal-file URL",
        async reference => {
            const legacyUrl = `http://localhost:3000${fileUrl}`;
            if (reference === "document") {
                await mockDatabase
                    .update(document)
                    .set({ url: legacyUrl })
                    .where(eq(document.id, documentId));
            } else {
                await mockDatabase.insert(documentVersions).values({
                    documentId: BigInt(documentId),
                    versionNumber: 3,
                    url: legacyUrl,
                    mimeType: "text/plain",
                });
            }
            await removeVersion();
            expect(await fileExists()).toBe(true);
        }
    );

    it("retains a legacy-origin version's bytes when another row has the canonical relative URL", async () => {
        await mockDatabase
            .update(documentVersions)
            .set({ url: `http://localhost:3000${fileUrl}` })
            .where(eq(documentVersions.id, versionId));
        await mockDatabase
            .update(document)
            .set({ url: fileUrl })
            .where(eq(document.id, documentId));
        await removeVersion();
        expect(await fileExists()).toBe(true);
    });
});
