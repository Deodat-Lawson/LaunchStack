import { company, document, documentContextChunks, documentVersions } from "@launchstack/core/db/schema";
import { FounderWeeklyReviewDocumentVersionStore } from "~/server/founder-weekly-review/document-version-chunks";
import { createFounderWeeklyReviewTestDatabase } from "./testDb";

const describeDb = process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL ? describe : describe.skip;

describeDb("explicit document version chunks", () => {
    it("loads only owned explicit-version chunks in deterministic order", async () => {
        const test = await createFounderWeeklyReviewTestDatabase();
        try {
            const [firstCompany] = await test.db.insert(company).values({ name: "First", numberOfEmployees: "1" }).returning();
            const [secondCompany] = await test.db.insert(company).values({ name: "Second", numberOfEmployees: "1" }).returning();
            const [doc] = await test.db.insert(document).values({ companyId: BigInt(firstCompany!.id), url: "local://doc", category: "Product", title: "Plan" }).returning();
            const [otherDoc] = await test.db.insert(document).values({ companyId: BigInt(secondCompany!.id), url: "local://other", category: "Product", title: "Other" }).returning();
            const [v1] = await test.db.insert(documentVersions).values({ documentId: BigInt(doc!.id), versionNumber: 1, url: "local://v1", mimeType: "text/plain" }).returning();
            const [v2] = await test.db.insert(documentVersions).values({ documentId: BigInt(doc!.id), versionNumber: 2, url: "local://v2", mimeType: "text/plain" }).returning();
            const [v3] = await test.db.insert(documentVersions).values({ documentId: BigInt(doc!.id), versionNumber: 3, url: "local://v3", mimeType: "text/plain" }).returning();
            const [otherVersion] = await test.db.insert(documentVersions).values({ documentId: BigInt(otherDoc!.id), versionNumber: 1, url: "local://other-v1", mimeType: "text/plain" }).returning();
            await test.db.insert(documentContextChunks).values([
                { documentId: BigInt(doc!.id), versionId: BigInt(v2!.id), content: "page two", contentHash: "b", tokenCount: 1, charCount: 8, pageNumber: 2 },
                { documentId: BigInt(doc!.id), versionId: BigInt(v2!.id), content: "page one", contentHash: "a", tokenCount: 1, charCount: 8, pageNumber: 1 },
                { documentId: BigInt(doc!.id), versionId: BigInt(v1!.id), content: "old", contentHash: "old", tokenCount: 1, charCount: 3, pageNumber: 1 },
                { documentId: BigInt(doc!.id), versionId: null, content: "legacy", contentHash: "legacy", tokenCount: 1, charCount: 6, pageNumber: 0 },
            ]);
            const store = new FounderWeeklyReviewDocumentVersionStore(test.db);
            await expect(store.getDocumentChunksForVersion({ companyId: BigInt(firstCompany!.id), documentId: BigInt(doc!.id), versionId: v2!.id })).resolves.toMatchObject({ state: "partial", chunks: [{ content: "page one" }, { content: "page two" }] });
            await expect(store.getDocumentChunksForVersion({ companyId: BigInt(firstCompany!.id), documentId: BigInt(doc!.id), versionId: v1!.id })).resolves.toMatchObject({ state: "partial", chunks: [{ content: "old" }] });
            await expect(store.getDocumentChunksForVersion({ companyId: BigInt(firstCompany!.id), documentId: BigInt(doc!.id), versionId: v3!.id })).resolves.toEqual({ state: "missing", chunks: [], warnings: ["version_chunks_missing"] });
            await expect(store.getDocumentChunksForVersion({ companyId: BigInt(secondCompany!.id), documentId: BigInt(doc!.id), versionId: v2!.id })).resolves.toEqual({ state: "missing", chunks: [], warnings: ["document_version_not_accessible"] });
            await expect(store.getDocumentChunksForVersion({ companyId: BigInt(firstCompany!.id), documentId: BigInt(doc!.id), versionId: otherVersion!.id })).resolves.toEqual({ state: "missing", chunks: [], warnings: ["document_version_not_accessible"] });
            await expect(store.getDocumentChunksForVersion({ companyId: BigInt(firstCompany!.id), documentId: BigInt(doc!.id), versionId: 999_999 })).resolves.toEqual({ state: "missing", chunks: [], warnings: ["document_version_not_accessible"] });
        } finally { await test.close(); }
    });
});
