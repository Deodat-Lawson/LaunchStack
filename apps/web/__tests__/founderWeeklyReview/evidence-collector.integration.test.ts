import { sql } from "drizzle-orm";

import { FounderWeeklyReviewEvidenceService } from "@launchstack/features/founder-weekly-review";

import { createFounderWeeklyReviewTestDatabase } from "./testDb";

const describeIfDatabase =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL
        ? describe
        : describe.skip;

type TestDatabase = Awaited<
    ReturnType<typeof createFounderWeeklyReviewTestDatabase>
>;
type TestDb = TestDatabase["db"];

function firstInsertedId(rows: unknown): bigint {
    const [row] = rows as Array<{ id: number | string | bigint }>;
    if (!row) {
        throw new Error("Expected an inserted row with an id");
    }
    return BigInt(row.id);
}

async function insertCompany(db: TestDb, name: string): Promise<bigint> {
    const rows = await db.execute(sql`
        INSERT INTO "pdr_ai_v2_company" ("name", "numberOfEmployees")
        VALUES (${name}, '5')
        RETURNING "id"
    `);
    return firstInsertedId(rows);
}

async function insertDocument(
    db: TestDb,
    companyId: bigint,
    category: string,
    title: string
): Promise<bigint> {
    const rows = await db.execute(sql`
        INSERT INTO "pdr_ai_v2_document" ("company_id", "url", "category", "title")
        VALUES (${companyId}, ${"/api/files/1"}, ${category}, ${title})
        RETURNING "id"
    `);
    return firstInsertedId(rows);
}

async function insertVersion(
    db: TestDb,
    documentId: bigint,
    versionNumber: number,
    createdAtIso: string,
    changelog: string | null = null
): Promise<bigint> {
    const rows = await db.execute(sql`
        INSERT INTO "pdr_ai_v2_document_versions"
            ("document_id", "version_number", "url", "mime_type", "changelog", "created_at")
        VALUES (${documentId}, ${versionNumber}, ${"/api/files/1"}, ${"application/pdf"}, ${changelog}, ${createdAtIso})
        RETURNING "id"
    `);
    return firstInsertedId(rows);
}

/**
 * Customer-feedback evidence cites a processed section, not a whole version, so
 * a feedback document only produces evidence once its context chunks exist.
 */
async function insertContextChunk(
    db: TestDb,
    documentId: bigint,
    versionId: bigint,
    content: string
): Promise<bigint> {
    const rows = await db.execute(sql`
        INSERT INTO "pdr_ai_v2_document_context_chunks"
            ("document_id", "version_id", "content", "token_count", "char_count")
        VALUES (${documentId}, ${versionId}, ${content}, ${8}, ${content.length})
        RETURNING "id"
    `);
    return firstInsertedId(rows);
}

const REPORTING_PERIOD = { start: "2026-02-16", end: "2026-02-22" } as const;
const START_BOUND = new Date("2026-02-16T00:00:00.000Z");
const END_BOUND = new Date("2026-02-23T00:00:00.000Z");

describeIfDatabase("FounderWeeklyReviewEvidenceService (integration)", () => {
    let testDb: TestDatabase;
    let service: FounderWeeklyReviewEvidenceService;
    let companyA: bigint;
    let companyB: bigint;
    let emptyCompany: bigint;
    let docA: bigint;
    let docB: bigint;
    let companyC: bigint;
    let docAVersion1: bigint;
    let docAVersion2: bigint;
    let docBVersion1: bigint;
    let docCProduct: bigint;
    let docCProductVersion: bigint;
    let docCFeedback: bigint;
    let docCFeedbackVersion: bigint;
    let docCFeedbackChunk: bigint;

    beforeAll(async () => {
        testDb = await createFounderWeeklyReviewTestDatabase();
        // The document-change source must be named explicitly — an
        // unconfigured service fails closed rather than guessing. `legacy` is
        // the version-row collector these cases cover; computed diffs have
        // their own unit coverage in document-change.test.ts.
        service = new FounderWeeklyReviewEvidenceService(testDb.db, undefined, {
            kind: "legacy",
        });

        companyA = await insertCompany(testDb.db, "Alpha");
        companyB = await insertCompany(testDb.db, "Beta");
        emptyCompany = await insertCompany(testDb.db, "Empty");

        docA = await insertDocument(testDb.db, companyA, "Product", "Alpha Doc");
        docB = await insertDocument(testDb.db, companyB, "Product", "Beta Doc");

        // Company A: two versions inside the window, two outside it.
        docAVersion1 = await insertVersion(testDb.db, docA, 1, "2026-02-17T10:00:00.000Z");
        docAVersion2 = await insertVersion(testDb.db, docA, 2, "2026-02-20T10:00:00.000Z", "Updated pricing");
        await insertVersion(testDb.db, docA, 3, "2026-02-25T10:00:00.000Z"); // after end
        await insertVersion(testDb.db, docA, 4, "2026-02-10T10:00:00.000Z"); // before start

        // Company B: one version inside the window — must never leak into Company A.
        docBVersion1 = await insertVersion(testDb.db, docB, 1, "2026-02-18T10:00:00.000Z");

        // Company C: one normal doc and one customer feedback doc, used to prove document_change / customer_feedback split
        companyC = await insertCompany(testDb.db, "Gamma");
        docCProduct = await insertDocument(testDb.db, companyC, "Product", "Gamma Product");
        // Exactly CUSTOMER_FEEDBACK_CATEGORY — the collector matches the
        // category verbatim, so casing is part of the contract.
        docCFeedback = await insertDocument(
            testDb.db,
            companyC,
            "Customer Feedback",
            "Gamma Feedback"
        );
        docCProductVersion = await insertVersion(testDb.db, docCProduct, 1, "2026-02-17T12:00:00.000Z");
        docCFeedbackVersion = await insertVersion(
            testDb.db,
            docCFeedback,
            1,
            "2026-02-18T12:00:00.000Z"
        );
        docCFeedbackChunk = await insertContextChunk(
            testDb.db,
            docCFeedback,
            docCFeedbackVersion,
            "Export is too slow for our weekly reporting."
        );
    });

    afterAll(async () => {
        await testDb?.close();
    });

    it("collects only in-window versions for the company, ordered by time", async () => {
        const items = await service.collectDocumentChangeEvidence(
            companyA,
            START_BOUND,
            END_BOUND
        );

        expect(items.map((i) => i.sourceId)).toEqual([
            `document_change:doc:${docA}:version:${docAVersion1}`,
            `document_change:doc:${docA}:version:${docAVersion2}`,
        ]);
    });

    it("builds a valid snapshot end-to-end with timezone-resolved bounds", async () => {
        const snapshot = await service.buildEvidenceSnapshot({
            companyId: companyA,
            reportingPeriod: REPORTING_PERIOD,
            workspaceTimezone: "UTC",
        });

        expect(snapshot.schemaVersion).toBe("founder-weekly-review-evidence/v1");
        expect(snapshot.workspaceTimezone).toBe("UTC");
        expect(snapshot.items.map((i) => i.sourceId)).toEqual([
            `document_change:doc:${docA}:version:${docAVersion1}`,
            `document_change:doc:${docA}:version:${docAVersion2}`,
        ]);
    });

    it("returns a valid empty pack for a company with no evidence (never throws)", async () => {
        const snapshot = await service.buildEvidenceSnapshot({
            companyId: emptyCompany,
            reportingPeriod: REPORTING_PERIOD,
            workspaceTimezone: "UTC",
        });

        expect(snapshot.items).toEqual([]);
    });

    it("never includes another company's evidence", async () => {
        const snapshot = await service.buildEvidenceSnapshot({
            companyId: companyB,
            reportingPeriod: REPORTING_PERIOD,
            workspaceTimezone: "UTC",
        });

        expect(snapshot.items).toHaveLength(1);
        expect(snapshot.items[0]?.sourceId).toBe(
            `document_change:doc:${docB}:version:${docBVersion1}`
        );
        // Nothing from any other company, by document rather than by exact id.
        for (const item of snapshot.items) {
            expect(item.metadata.documentId).toBe(docB.toString());
        }
    });

    it("reports every changed document as document_change, feedback documents included", async () => {
        const items = await service.collectDocumentChangeEvidence(
            companyC,
            START_BOUND,
            END_BOUND
        );

        // A Customer Feedback document still *changes*, and that change is a
        // document change. Classification into customer_feedback happens in the
        // dedicated collector, at section granularity — the two are not
        // mutually exclusive views of the same version.
        expect(items.map((i) => i.sourceId).sort()).toEqual(
            [
                `document_change:doc:${docCProduct}:version:${docCProductVersion}`,
                `document_change:doc:${docCFeedback}:version:${docCFeedbackVersion}`,
            ].sort()
        );
        expect(items.every((i) => i.sourceType === "document_change")).toBe(true);
    });

    it("classifies a customer-feedback document as customer_feedback and excludes normal docs", async () => {
        // This collector reports warnings alongside its items, so it returns a
        // result object rather than a bare array.
        const { items } = await service.collectCustomerFeedbackEvidence(
            companyC,
            START_BOUND,
            END_BOUND
        );

        expect(items).toHaveLength(1);
        // Feedback is cited at section granularity so a quote can be traced to
        // the exact processed chunk it came from.
        expect(items[0]?.sourceId).toBe(
            `customer_feedback:doc:${docCFeedback}:version:${docCFeedbackVersion}:section:${docCFeedbackChunk}`
        );
        expect(items[0]?.sourceType).toBe("customer_feedback");
        // the normal doc must not show up here
        expect(
            items.some((i) => i.sourceId.includes(`doc:${docCProduct}:`))
        ).toBe(false);
    });

    it("includes both source types in the snapshot without double-counting", async () => {
        const snapshot = await service.buildEvidenceSnapshot({
            companyId: companyC,
            reportingPeriod: REPORTING_PERIOD,
            workspaceTimezone: "UTC",
        });

        // Both changed documents plus the one cited feedback section. Deduping
        // is by source id, and a version-level change and a section-level quote
        // are genuinely different citations, so nothing collapses here.
        expect(snapshot.items.map((i) => i.sourceId).sort()).toEqual(
            [
                `document_change:doc:${docCProduct}:version:${docCProductVersion}`,
                `document_change:doc:${docCFeedback}:version:${docCFeedbackVersion}`,
                `customer_feedback:doc:${docCFeedback}:version:${docCFeedbackVersion}:section:${docCFeedbackChunk}`,
            ].sort()
        );
        // No source id appears twice.
        expect(new Set(snapshot.items.map((i) => i.sourceId)).size).toBe(
            snapshot.items.length
        );
    });
});
