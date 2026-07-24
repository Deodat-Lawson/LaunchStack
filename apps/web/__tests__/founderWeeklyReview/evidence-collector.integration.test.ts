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
): Promise<void> {
    await db.execute(sql`
        INSERT INTO "pdr_ai_v2_document_versions"
            ("document_id", "version_number", "url", "mime_type", "changelog", "created_at")
        VALUES (${documentId}, ${versionNumber}, ${"/api/files/1"}, ${"application/pdf"}, ${changelog}, ${createdAtIso})
    `);
}

// Reporting week (UTC keeps the assertions simple): 2026-02-16 .. 2026-02-22 inclusive.
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

    beforeAll(async () => {
        testDb = await createFounderWeeklyReviewTestDatabase();
        service = new FounderWeeklyReviewEvidenceService(testDb.db);

        companyA = await insertCompany(testDb.db, "Alpha");
        companyB = await insertCompany(testDb.db, "Beta");
        emptyCompany = await insertCompany(testDb.db, "Empty");

        docA = await insertDocument(testDb.db, companyA, "Product", "Alpha Doc");
        docB = await insertDocument(testDb.db, companyB, "Product", "Beta Doc");

        // Company A: two versions inside the window, two outside it.
        await insertVersion(testDb.db, docA, 1, "2026-02-17T10:00:00.000Z");
        await insertVersion(testDb.db, docA, 2, "2026-02-20T10:00:00.000Z", "Updated pricing");
        await insertVersion(testDb.db, docA, 3, "2026-02-25T10:00:00.000Z"); // after end
        await insertVersion(testDb.db, docA, 4, "2026-02-10T10:00:00.000Z"); // before start

        // Company B: one version inside the window — must never leak into Company A.
        await insertVersion(testDb.db, docB, 1, "2026-02-18T10:00:00.000Z");
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
            `document-version:${docA}:1`,
            `document-version:${docA}:2`,
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
            `document-version:${docA}:1`,
            `document-version:${docA}:2`,
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
        expect(snapshot.items[0]?.sourceId).toBe(`document-version:${docB}:1`);
    });
});
