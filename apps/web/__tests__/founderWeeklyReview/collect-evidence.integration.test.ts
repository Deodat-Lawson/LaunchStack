import { sql } from "drizzle-orm";

import { FounderWeeklyReviewEvidenceService } from "@launchstack/features/founder-weekly-review";

import { createFounderWeeklyReviewTestDatabase } from "./testDb";

// skip if no test db url provided
const describeIfDatabase =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL
        ? describe
        : describe.skip;

type TestDatabase = Awaited<
    ReturnType<typeof createFounderWeeklyReviewTestDatabase>
>;
type TestDb = TestDatabase["db"];

const REPORTING_PERIOD = { start: "2026-02-16", end: "2026-02-22" } as const;

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

async function insertChunk(
    db: TestDb,
    documentId: bigint,
    versionId: bigint,
    content: string
): Promise<void> {
    await db.execute(sql`
        INSERT INTO "pdr_ai_v2_document_context_chunks"
            ("document_id", "version_id", "content")
        VALUES (${documentId}, ${versionId}, ${content})
    `);
}

describeIfDatabase("FounderWeeklyReviewEvidenceService", () => {
    let testDb: TestDatabase;
    let service: FounderWeeklyReviewEvidenceService;

    let companyA: bigint;
    let companyB: bigint;
    let emptyCompany: bigint;
    let productDocA: bigint;
    let feedbackDocA: bigint;
    let docB: bigint;

    let productV1: bigint;
    let productV2: bigint;
    let productV3: bigint;

    let feedbackV1: bigint;
    // company B's in-window doc version to check for company evidence isolation
    let docBV1: bigint;

    beforeAll(async () => {
        testDb = await createFounderWeeklyReviewTestDatabase();
        service = new FounderWeeklyReviewEvidenceService(testDb.db);

        companyA = await insertCompany(testDb.db, "Alpha");
        companyB = await insertCompany(testDb.db, "Beta");
        emptyCompany = await insertCompany(testDb.db, "Empty");

        productDocA = await insertDocument(testDb.db, companyA, "Product", "Alpha Product");
        feedbackDocA = await insertDocument(testDb.db, companyA, "Customer Feedback", "Alpha Feedback");
        docB = await insertDocument(testDb.db, companyB, "Product", "Beta Product");

        productV1 = await insertVersion(testDb.db, productDocA, 1, "2026-02-17T10:00:00.000Z");
        productV2 = await insertVersion(testDb.db, productDocA, 2, "2026-02-20T10:00:00.000Z", "Updated pricing");
        productV3 = await insertVersion(testDb.db, productDocA, 3, "2026-02-25T10:00:00.000Z"); // outside of review window

        // Company A customer-feedback doc: one in-window version with two citeable chunks.
        feedbackV1 = await insertVersion(testDb.db, feedbackDocA, 1, "2026-02-18T10:00:00.000Z");
        await insertChunk(testDb.db, feedbackDocA, feedbackV1, "Customers love the new pricing.");
        await insertChunk(testDb.db, feedbackDocA, feedbackV1, "They want SSO next.");

        // Company B: one in-window version that must never appear in Company A's snapshot.
        docBV1 = await insertVersion(testDb.db, docB, 1, "2026-02-18T12:00:00.000Z");
    });

    afterAll(async () => {
        await testDb?.close();
    });

    it("collects in-window evidence for the company and excludes out-of-window versions", async () => {
        const snapshot = await service.collectFounderWeeklyReviewEvidence({
            companyId: companyA,
            reportingPeriod: REPORTING_PERIOD,
            workspaceTimezone: "UTC",
        });

        const ids = snapshot.items.map((item) => item.sourceId);

        // in-window product versions are present as document_change
        expect(ids).toContain(`document_change:doc:${productDocA}:version:${productV1}`);
        expect(ids).toContain(`document_change:doc:${productDocA}:version:${productV2}`);
        expect(ids).not.toContain(`document_change:doc:${productDocA}:version:${productV3}`);
    });

    it("creates customer_feedback evidence from document-context chunks", async () => {
        const snapshot = await service.collectFounderWeeklyReviewEvidence({
            companyId: companyA,
            reportingPeriod: REPORTING_PERIOD,
            workspaceTimezone: "UTC",
        });

        const feedback = snapshot.items.filter((item) => item.sourceType === "customer_feedback");
        expect(feedback).toHaveLength(2);
        expect(feedback.every((item) =>
            item.sourceId.startsWith(`customer_feedback:doc:${feedbackDocA}:version:${feedbackV1}:section:`)
        )).toBe(true);
        expect(feedback.map((item) => item.excerpt).sort()).toEqual([
            "Customers love the new pricing.",
            "They want SSO next.",
        ]);
    });

    it("never leaks another company's evidence", async () => {
        const snapshot = await service.collectFounderWeeklyReviewEvidence({
            companyId: companyA,
            reportingPeriod: REPORTING_PERIOD,
            workspaceTimezone: "UTC",
        });

        const ids = snapshot.items.map((item) => item.sourceId);
        expect(ids.some((id) => id.includes(`doc:${docB}:`))).toBe(false);
        expect(ids.some((id) => id.includes(`version:${docBV1}`))).toBe(false);
    });

    it("returns a valid empty snapshot for a company with no evidence", async () => {
        const snapshot = await service.collectFounderWeeklyReviewEvidence({
            companyId: emptyCompany,
            reportingPeriod: REPORTING_PERIOD,
            workspaceTimezone: "UTC",
        });

        expect(snapshot.items).toEqual([]);
        expect(snapshot.schemaVersion).toBeTruthy();
    });

    it("never mislabels founder_context as customer_feedback", async () => {
        const snapshot = await service.collectFounderWeeklyReviewEvidence({
            companyId: emptyCompany,
            reportingPeriod: REPORTING_PERIOD,
            workspaceTimezone: "UTC",
            founderContext: "We are blocked on the payments migration.",
            actor: { externalUserId: "user_founder" },
            contextEntryId: "cli:test:2026-02-16:2026-02-22",
        });

        const founder = snapshot.items.filter((item) => item.sourceType === "founder_context");
        expect(founder).toHaveLength(1);
        expect(founder[0]?.excerpt).toBe("We are blocked on the payments migration.");

        expect(snapshot.items.some((item) => item.sourceType === "customer_feedback")).toBe(false);
    });
});
