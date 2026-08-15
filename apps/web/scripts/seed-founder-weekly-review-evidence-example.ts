// seeds local-only Founder Weekly Review data for producing example
// evidence snapshot. Re-running removes previous data first
// founder context must be manually entered through --founder-context flag
//
// pnpm --filter @launchstack/web tsx scripts/seed-founder-weekly-review-evidence-example.ts

import "dotenv/config";

import { sql } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import type { DbClient } from "@launchstack/core/db";
import * as coreSchema from "@launchstack/core/db/schema";

import { assertLocalDatabaseUrl } from "./collect-founder-weekly-review-evidence.lib";

const FIXTURE_COMPANY_NAME = "Founder Weekly Review Example Co";

// example snapshot is generated for (America/New_York) timezone.
export const EXAMPLE_REPORTING_PERIOD = { start: "2026-07-20", end: "2026-07-26" } as const;
export const EXAMPLE_WORKSPACE_TIMEZONE = "America/New_York";

function firstInsertedId(rows: unknown): bigint {
    const [row] = rows as Array<{ id: number | string | bigint }>;
    if (!row) {
        throw new Error("Expected an inserted row with an id");
    }
    return BigInt(row.id);
}

async function insertDocument(db: DbClient, companyId: bigint, category: string, title: string): Promise<bigint> {
    const rows = await db.execute(sql`
        INSERT INTO "pdr_ai_v2_document" ("company_id", "url", "category", "title")
        VALUES (${companyId}, ${"/api/files/example"}, ${category}, ${title})
        RETURNING "id"
    `);
    return firstInsertedId(rows);
}

async function insertVersion(
    db: DbClient,
    documentId: bigint,
    versionNumber: number,
    createdAtIso: string,
    changelog: string | null,
    uploadedBy: string | null
): Promise<bigint> {
    const rows = await db.execute(sql`
        INSERT INTO "pdr_ai_v2_document_versions"
            ("document_id", "version_number", "url", "mime_type", "changelog", "uploaded_by", "created_at")
        VALUES (${documentId}, ${versionNumber}, ${"/api/files/example"}, ${"application/pdf"}, ${changelog}, ${uploadedBy}, ${createdAtIso})
        RETURNING "id"
    `);
    return firstInsertedId(rows);
}

async function insertChunk(db: DbClient, documentId: bigint, versionId: bigint, content: string, pageNumber: number): Promise<void> {
    await db.execute(sql`
        INSERT INTO "pdr_ai_v2_document_context_chunks" ("document_id", "version_id", "content", "page_number")
        VALUES (${documentId}, ${versionId}, ${content}, ${pageNumber})
    `);
}

async function removeExistingFixture(db: DbClient): Promise<void> {
    await db.execute(sql`DELETE FROM "pdr_ai_v2_document_context_chunks" WHERE "document_id" IN (SELECT id FROM "pdr_ai_v2_document" WHERE "company_id" IN (SELECT id FROM "pdr_ai_v2_company" WHERE "name" = ${FIXTURE_COMPANY_NAME}))`);
    await db.execute(sql`DELETE FROM "pdr_ai_v2_document_versions" WHERE "document_id" IN (SELECT id FROM "pdr_ai_v2_document" WHERE "company_id" IN (SELECT id FROM "pdr_ai_v2_company" WHERE "name" = ${FIXTURE_COMPANY_NAME}))`);
    await db.execute(sql`DELETE FROM "pdr_ai_v2_document" WHERE "company_id" IN (SELECT id FROM "pdr_ai_v2_company" WHERE "name" = ${FIXTURE_COMPANY_NAME})`);
    await db.execute(sql`DELETE FROM "pdr_ai_v2_company" WHERE "name" = ${FIXTURE_COMPANY_NAME}`);
}

async function main(): Promise<void> {
    const url = process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
    assertLocalDatabaseUrl(url);

    const client = postgres(url, { max: 1 });
    try {
        const db = drizzle(client, { schema: coreSchema });

        await removeExistingFixture(db);

        const companyRows = await db.execute(sql`
            INSERT INTO "pdr_ai_v2_company" ("name", "numberOfEmployees")
            VALUES (${FIXTURE_COMPANY_NAME}, ${"12"})
            RETURNING "id"
        `);
        const companyId = firstInsertedId(companyRows);

        // product doc with two in-window versions and one out-of-window version.
        const pricing = await insertDocument(db, companyId, "Product", "Pricing Page");
        await insertVersion(db, pricing, 1, "2026-07-21T14:00:00.000Z", "Reworked pricing tiers; added an annual billing option.", "demo-user");
        await insertVersion(db, pricing, 2, "2026-07-23T15:30:00.000Z", "Clarified enterprise tier copy after customer confusion.", "demo-user");
        await insertVersion(db, pricing, 3, "2026-07-28T14:00:00.000Z", "Post-window tweak (should NOT appear in the 07-20..07-26 pack).", "demo-user");

        // second product doc with no extra versions
        const onboarding = await insertDocument(db, companyId, "Product", "Onboarding Guide");
        await insertVersion(db, onboarding, 1, "2026-07-22T09:15:00.000Z", "Added an SSO / SAML setup walkthrough.", "demo-user");

        // customer-feedback doc with three citeable chunks.
        const feedback = await insertDocument(db, companyId, "Customer Feedback", "Customer Feedback - July");
        const feedbackV1 = await insertVersion(db, feedback, 1, "2026-07-22T11:00:00.000Z", null, "demo-user");
        await insertChunk(db, feedback, feedbackV1, "Several customers asked for annual billing instead of monthly-only.", 1);
        await insertChunk(db, feedback, feedbackV1, "A user said the enterprise tier pricing felt confusing to compare.", 1);
        await insertChunk(db, feedback, feedbackV1, "Multiple requests for SSO / SAML so larger teams can roll out access.", 2);

        console.log(`Seeded fixture "${FIXTURE_COMPANY_NAME}" with companyId=${companyId}`);
        console.log(`Reporting period: ${EXAMPLE_REPORTING_PERIOD.start} .. ${EXAMPLE_REPORTING_PERIOD.end} (${EXAMPLE_WORKSPACE_TIMEZONE})`);
        console.log(`Next: run the collector with --company ${companyId} to produce the example snapshot.`);
    } finally {
        await client.end({ timeout: 5 });
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
