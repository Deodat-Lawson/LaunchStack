import {
    company,
    document,
    documentContextChunks,
    documentVersions,
} from "@launchstack/core/db/schema";
import { FounderWeeklyReviewDocumentVersionStore } from "~/server/founder-weekly-review/document-version-chunks";
import { createFounderWeeklyReviewTestDatabase } from "./testDb";

const describeDb =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL || process.env.DATABASE_URL
        ? describe
        : describe.skip;

describeDb("explicit document version chunks", () => {
    it("loads only owned explicit-version chunks in deterministic order", async () => {
        const test = await createFounderWeeklyReviewTestDatabase();
        try {
            const [firstCompany] = await test.db
                .insert(company)
                .values({ name: "First", numberOfEmployees: "1" })
                .returning();
            const [secondCompany] = await test.db
                .insert(company)
                .values({ name: "Second", numberOfEmployees: "1" })
                .returning();
            const [doc] = await test.db
                .insert(document)
                .values({
                    companyId: BigInt(firstCompany!.id),
                    url: "local://doc",
                    category: "Product",
                    title: "Plan",
                })
                .returning();
            const [otherDoc] = await test.db
                .insert(document)
                .values({
                    companyId: BigInt(secondCompany!.id),
                    url: "local://other",
                    category: "Product",
                    title: "Other",
                })
                .returning();
            const [v1] = await test.db
                .insert(documentVersions)
                .values({
                    documentId: BigInt(doc!.id),
                    versionNumber: 1,
                    url: "local://v1",
                    mimeType: "text/plain",
                })
                .returning();
            const [v2] = await test.db
                .insert(documentVersions)
                .values({
                    documentId: BigInt(doc!.id),
                    versionNumber: 2,
                    url: "local://v2",
                    mimeType: "text/plain",
                })
                .returning();
            const [v3] = await test.db
                .insert(documentVersions)
                .values({
                    documentId: BigInt(doc!.id),
                    versionNumber: 3,
                    url: "local://v3",
                    mimeType: "text/plain",
                })
                .returning();
            const [otherVersion] = await test.db
                .insert(documentVersions)
                .values({
                    documentId: BigInt(otherDoc!.id),
                    versionNumber: 1,
                    url: "local://other-v1",
                    mimeType: "text/plain",
                })
                .returning();
            await test.db.insert(documentContextChunks).values([
                {
                    documentId: BigInt(doc!.id),
                    versionId: BigInt(v2!.id),
                    content: "page two",
                    contentHash: "b",
                    tokenCount: 1,
                    charCount: 8,
                    pageNumber: 2,
                },
                {
                    documentId: BigInt(doc!.id),
                    versionId: BigInt(v2!.id),
                    content: "page one",
                    contentHash: "a",
                    tokenCount: 1,
                    charCount: 8,
                    pageNumber: 1,
                },
                {
                    documentId: BigInt(doc!.id),
                    versionId: BigInt(v1!.id),
                    content: "old",
                    contentHash: "old",
                    tokenCount: 1,
                    charCount: 3,
                    pageNumber: 1,
                },
                {
                    documentId: BigInt(doc!.id),
                    versionId: null,
                    content: "legacy",
                    contentHash: "legacy",
                    tokenCount: 1,
                    charCount: 6,
                    pageNumber: 0,
                },
            ]);
            const store = new FounderWeeklyReviewDocumentVersionStore(test.db);
            const docId = BigInt(doc!.id);
            const key = (versionId: number) => `${docId.toString()}:${versionId}`;

            // One batch covering every case: owned versions with and without
            // chunks, another company's view of an owned version, a version
            // belonging to a different document, and one that does not exist.
            const loaded = await store.getDocumentChunksForVersions({
                companyId: BigInt(firstCompany!.id),
                versions: [
                    { documentId: docId, versionId: v1!.id },
                    { documentId: docId, versionId: v2!.id },
                    { documentId: docId, versionId: v3!.id },
                    { documentId: docId, versionId: otherVersion!.id },
                    { documentId: docId, versionId: 999_999 },
                ],
            });

            expect(loaded.get(key(v2!.id))).toMatchObject({
                state: "partial",
                chunks: [{ content: "page one" }, { content: "page two" }],
            });
            expect(loaded.get(key(v1!.id))).toMatchObject({
                state: "partial",
                chunks: [{ content: "old" }],
            });
            expect(loaded.get(key(v3!.id))).toEqual({
                state: "missing",
                chunks: [],
                warnings: ["version_chunks_missing"],
            });
            expect(loaded.get(key(otherVersion!.id))).toEqual({
                state: "missing",
                chunks: [],
                warnings: ["document_version_not_accessible"],
            });
            expect(loaded.get(key(999_999))).toEqual({
                state: "missing",
                chunks: [],
                warnings: ["document_version_not_accessible"],
            });

            // Cross-company: the same version id, asked for by the company that
            // does not own it, must not leak chunks.
            const otherCompanyView = await store.getDocumentChunksForVersions({
                companyId: BigInt(secondCompany!.id),
                versions: [{ documentId: docId, versionId: v2!.id }],
            });
            expect(otherCompanyView.get(key(v2!.id))).toEqual({
                state: "missing",
                chunks: [],
                warnings: ["document_version_not_accessible"],
            });
        } finally {
            await test.close();
        }
    });

    it("loads in-period versions plus exactly one predecessor per document", async () => {
        const test = await createFounderWeeklyReviewTestDatabase();
        try {
            const [owner] = await test.db
                .insert(company)
                .values({ name: "Owner", numberOfEmployees: "1" })
                .returning();
            const [other] = await test.db
                .insert(company)
                .values({ name: "Other", numberOfEmployees: "1" })
                .returning();
            const [doc] = await test.db
                .insert(document)
                .values({
                    companyId: BigInt(owner!.id),
                    url: "local://doc",
                    category: "Product",
                    title: "Plan",
                })
                .returning();
            const [untouched] = await test.db
                .insert(document)
                .values({
                    companyId: BigInt(owner!.id),
                    url: "local://quiet",
                    category: "Product",
                    title: "Quiet",
                })
                .returning();
            const [foreign] = await test.db
                .insert(document)
                .values({
                    companyId: BigInt(other!.id),
                    url: "local://foreign",
                    category: "Product",
                    title: "Foreign",
                })
                .returning();

            const at = (iso: string) => new Date(iso);
            const insertVersion = (documentId: bigint, versionNumber: number, iso: string) =>
                test.db
                    .insert(documentVersions)
                    .values({
                        documentId,
                        versionNumber,
                        url: `local://v${versionNumber}`,
                        mimeType: "text/plain",
                        createdAt: at(iso),
                    })
                    .returning();

            // Deep history before the window: only the newest may be loaded.
            await insertVersion(BigInt(doc!.id), 1, "2026-01-01T00:00:00.000Z");
            const [predecessor] = await insertVersion(
                BigInt(doc!.id),
                2,
                "2026-01-20T00:00:00.000Z"
            );
            const [inPeriod] = await insertVersion(BigInt(doc!.id), 3, "2026-02-02T00:00:00.000Z");
            await insertVersion(BigInt(doc!.id), 4, "2026-03-01T00:00:00.000Z"); // after the window
            // A document with no in-period change contributes nothing at all.
            await insertVersion(BigInt(untouched!.id), 1, "2026-01-05T00:00:00.000Z");
            // Another company's in-period change must never appear.
            await insertVersion(BigInt(foreign!.id), 1, "2026-02-02T00:00:00.000Z");

            const store = new FounderWeeklyReviewDocumentVersionStore(test.db);
            const versions = await store.listVersionsForReportingPeriod(
                BigInt(owner!.id),
                at("2026-02-01T00:00:00.000Z"),
                at("2026-02-28T00:00:00.000Z")
            );

            expect(versions.map(v => v.versionId).sort()).toEqual(
                [predecessor!.id, inPeriod!.id].sort()
            );
        } finally {
            await test.close();
        }
    });
});
