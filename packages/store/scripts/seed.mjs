#!/usr/bin/env node
/**
 * Minimal development seed: one company, one user, one document with a v1
 * version row.
 *
 * The new workflow asks people to drop their database, so dropping it has to
 * be cheap. Without this, "just rebuild it" costs a morning of clicking
 * through signup and uploads, and the team quietly avoids the workflow.
 *
 * Idempotent: re-running updates the same fixed-id rows rather than piling up
 * duplicates. Refuses to touch a database that already has real data.
 *
 *   pnpm --filter @launchstack/core db:seed
 *   pnpm --filter @launchstack/core db:seed --force   # seed anyway
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import postgres from "postgres";

const HERE = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(HERE, "..", "..", "..", ".env") });

const force = process.argv.includes("--force");
const log = (m) => console.log(`[seed] ${m}`);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[seed] DATABASE_URL is required");
  process.exit(1);
}

const SEED_COMPANY = "Seed Co";
const SEED_USER_ID = "seed-user";

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const [ledger] = await sql`SELECT to_regclass('_launchstack_migrations') IS NOT NULL AS ok`;
  if (!ledger?.ok) {
    console.error(
      "[seed] this database has no migration ledger.\n" +
        "       Run: pnpm --filter @launchstack/core db:migrate",
    );
    process.exit(1);
  }

  const [counts] = await sql`
    SELECT (SELECT count(*) FROM pdr_ai_v2_company WHERE name <> ${SEED_COMPANY}) AS companies`;
  if (Number(counts.companies) > 0 && !force) {
    console.error(
      `[seed] refusing: this database already has ${counts.companies} non-seed company row(s).\n` +
        `       Seeding is for a freshly migrated database. Use --force to override.`,
    );
    process.exit(1);
  }

  await sql.begin(async (tx) => {
    // There is no unique constraint on company.name, so ON CONFLICT would not
    // help here — look the row up explicitly and only insert when absent.
    const [found] = await tx`
      SELECT id FROM pdr_ai_v2_company WHERE name = ${SEED_COMPANY} LIMIT 1`;
    const companyId =
      found?.id ??
      (
        await tx`
          INSERT INTO pdr_ai_v2_company (name, slug, industry, "numberOfEmployees")
          VALUES (${SEED_COMPANY}, 'seed-co', 'Software', '1-10')
          RETURNING id`
      )[0].id;
    log(`company ${companyId} (${SEED_COMPANY})${found ? " [existing]" : " [created]"}`);

    await tx`
      INSERT INTO pdr_ai_v2_users (name, email, "userId", company_id, role, status)
      VALUES ('Seed User', 'seed@example.com', ${SEED_USER_ID}, ${companyId}, 'employer', 'active')
      ON CONFLICT ("userId") DO UPDATE SET company_id = EXCLUDED.company_id`;
    log(`user ${SEED_USER_ID}`);

    await tx`
      INSERT INTO pdr_ai_v2_user_company_memberships (user_id, company_id, role)
      SELECT id, ${companyId}, 'owner' FROM pdr_ai_v2_users WHERE "userId" = ${SEED_USER_ID}
      ON CONFLICT DO NOTHING`;

    const [existingDoc] = await tx`
      SELECT id FROM pdr_ai_v2_document WHERE company_id = ${companyId} LIMIT 1`;
    if (existingDoc) {
      log(`document ${existingDoc.id} already present`);
      return;
    }

    const [doc] = await tx`
      INSERT INTO pdr_ai_v2_document (url, category, title, company_id, mime_type, file_type)
      VALUES ('https://example.invalid/seed.pdf', 'General', 'Seed Document',
              ${companyId}, 'application/pdf', 'application/pdf')
      RETURNING id`;

    // Mirrors what document-upload.ts does on a real upload, so seeded data
    // and uploaded data have the same shape.
    const [version] = await tx`
      INSERT INTO pdr_ai_v2_document_versions
        (document_id, version_number, url, mime_type, uploaded_by)
      VALUES (${doc.id}, 1, 'https://example.invalid/seed.pdf', 'application/pdf', ${SEED_USER_ID})
      RETURNING id`;

    await tx`
      UPDATE pdr_ai_v2_document SET current_version_id = ${version.id} WHERE id = ${doc.id}`;
    log(`document ${doc.id} with version ${version.id}`);
  });

  log("done");
} catch (e) {
  console.error(`[seed] failed: ${e.message}`);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
