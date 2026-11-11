jest.mock("~/server/notes/embed-note", () => ({ embedNote: jest.fn() }));

import type { Backfill } from "@launchstack/store/backfills";
import { company, document, documentVersions } from "@launchstack/store/schema";
import { asc, eq } from "drizzle-orm";

import { BACKFILLS } from "~/server/backfills";
import {
    createFounderWeeklyReviewTestDatabase,
    type FounderWeeklyReviewTestDatabase,
} from "../founderWeeklyReview/testDb";

// Never opt in merely because the application's DATABASE_URL is present.
const describeDb = process.env.LAUNCHSTACK_TEST_DATABASE_URL ? describe : describe.skip;

const URLS = [
    ["https://old-app.example/api/files/1", "/api/files/1"],
    ["http://localhost:3000/api/files/42", "/api/files/42"],
    ["https://another-origin.example/api/files/0007", "/api/files/0007"],
    ["https://old-app.example/api/files/9007199254740993", "/api/files/9007199254740993"],
    ["/api/files/5", "/api/files/5"],
    ["https://old-app.example/api/files/6/", "https://old-app.example/api/files/6/"],
    [
        "https://old-app.example/api/files/7?token=secret",
        "https://old-app.example/api/files/7?token=secret",
    ],
    ["https://old-app.example/api/files/8#preview", "https://old-app.example/api/files/8#preview"],
    ["https://old-app.example/api/files/9/extra", "https://old-app.example/api/files/9/extra"],
    ["https://old-app.example/api/files/10-suffix", "https://old-app.example/api/files/10-suffix"],
    ["https://old-app.example/prefix/api/files/11", "https://old-app.example/prefix/api/files/11"],
    ["//old-app.example/api/files/12", "//old-app.example/api/files/12"],
    ["ftp://old-app.example/api/files/13", "ftp://old-app.example/api/files/13"],
    [
        "https://storage.example/documents/report.pdf",
        "https://storage.example/documents/report.pdf",
    ],
    ["HTTP://old-app.example/api/files/14", "HTTP://old-app.example/api/files/14"],
] as const;

describeDb("2026-11-document-file-urls backfill (integration)", () => {
    jest.setTimeout(120_000);

    let test: FounderWeeklyReviewTestDatabase;
    let entry: Backfill;

    beforeAll(async () => {
        test = await createFounderWeeklyReviewTestDatabase();
        entry = BACKFILLS.find(backfill => backfill.id === "2026-11-document-file-urls")!;
        const [workspace] = await test.db
            .insert(company)
            .values({ name: "Canonical file URLs", numberOfEmployees: "1" })
            .returning({ id: company.id });

        for (const [url] of URLS) {
            const [doc] = await test.db
                .insert(document)
                .values({ companyId: BigInt(workspace!.id), title: url, category: "", url })
                .returning({ id: document.id });
            const [version] = await test.db
                .insert(documentVersions)
                .values({
                    documentId: BigInt(doc!.id),
                    versionNumber: 1,
                    url,
                    mimeType: "application/pdf",
                    uploadedBy: "url-backfill-test",
                })
                .returning({ id: documentVersions.id });
            await test.db
                .update(document)
                .set({ currentVersionId: BigInt(version!.id) })
                .where(eq(document.id, doc!.id));
        }
    });

    afterAll(async () => {
        await test?.close();
    });

    async function storedRows() {
        return {
            documents: await test.db.select().from(document).orderBy(asc(document.id)),
            versions: await test.db
                .select()
                .from(documentVersions)
                .orderBy(asc(documentVersions.id)),
        };
    }

    it("is registered without an engine and normalizes only exact URLs in resumable bounded batches", async () => {
        expect(entry).toBeDefined();
        expect(entry.requiresEngine).toBe(false);
        const before = await storedRows();
        const context = { db: test.db, cursor: null, batchSize: 3 };
        expect(await entry.estimate?.(context)).toBe(8);
        expect(await storedRows()).toEqual(before); // Estimating must not write.

        // Stop after the first batch, then resume using the ledger's persisted cursor shape.
        let result = await entry.step(context);
        expect(result.processed).toBe(3);
        expect(result.cursor).not.toBeNull();
        expect(await entry.estimate?.({ db: test.db, cursor: result.cursor })).toBe(5);
        let processed = result.processed;
        while (result.cursor !== null) {
            result = await entry.step({ ...context, cursor: result.cursor });
            expect(result.processed).toBeLessThanOrEqual(context.batchSize);
            processed += result.processed;
        }
        expect(processed).toBe(8);

        const normalized = await storedRows();
        expect(normalized.documents).toEqual(
            before.documents.map((row, index) => ({ ...row, url: URLS[index]![1] }))
        );
        expect(normalized.versions).toEqual(
            before.versions.map((row, index) => ({ ...row, url: URLS[index]![1] }))
        );
        expect(await entry.estimate?.(context)).toBe(0);

        // Replaying from the beginning is safe even if a process died before saving its cursor.
        expect(await entry.step(context)).toEqual({ cursor: null, processed: 0 });
        expect(await storedRows()).toEqual(normalized);
    });
});
