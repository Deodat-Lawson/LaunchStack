/**
 * Micro-benchmark for the email campaign dispatch path.
 *
 * Measures wall time of `dispatchEmailCampaign` (dry_run and send mode with a
 * no-op adapter) against a throwaway Postgres database, so before/after
 * comparisons of the per-recipient persistence work are apples-to-apples.
 *
 *   LAUNCHSTACK_TEST_DATABASE_URL=postgres://… pnpm exec tsx scripts/bench-email-dispatch.ts [recipients]
 */

process.env.EMAIL_UNSUBSCRIBE_SECRET ??= "bench-secret-0123456789abcdef";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as coreSchema from "@launchstack/core/db/schema";
import { configureDatabase, type DbClient } from "@launchstack/core/db";
import {
  addSuppression,
  appendTemplateVersion,
  approveEmailCampaign,
  createCampaign,
  dispatchEmailCampaign,
  upsertRecipients,
  type SendAdapter,
} from "@launchstack/features/email-pipeline";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(HERE, "..", "drizzle", "20260814050513_email_pipeline.sql");

interface Harness {
  createCompany(): Promise<number>;
  close(): Promise<void>;
}

async function createEmailPipelineTestDatabase(): Promise<Harness> {
  const connectionString =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("LAUNCHSTACK_TEST_DATABASE_URL or DATABASE_URL is required.");
  }
  const databaseName = `bench_${randomUUID().replace(/-/g, "")}`;
  const maintenance = postgres(connectionString, { max: 1 });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  const admin = postgres(url.toString(), { max: 1 });
  await admin.begin(async (tx) => {
    await tx.unsafe(await readFile(MIGRATION, "utf8"));
  });
  const client = postgres(url.toString(), { max: 5 });
  configureDatabase(
    drizzle(client, {
      schema: coreSchema,
      logger: { logQuery: () => { queryCount++; } },
    }) as unknown as DbClient,
  );
  let companySeq = 1000;
  return {
    createCompany: () => Promise.resolve(++companySeq),
    async close() {
      await client.end({ timeout: 5 });
      await admin.end({ timeout: 5 });
      await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await maintenance.end({ timeout: 5 });
    },
  };
}

const N = Number(process.argv[2] ?? 500);
const SUPPRESSED = Math.floor(N / 10);

let queryCount = 0;

const TEMPLATE = {
  subject: "Hello {{firstName}}",
  body: "Hi {{firstName}} at {{recipientCompany}} — {{senderIdentity}} {{unsubscribeUrl}}",
  variables: ["firstName", "recipientCompany", "senderIdentity", "unsubscribeUrl"],
};

const PASSING_REVIEW = {
  scores: [],
  issues: [],
  verdict: "pass" as const,
  summary: "ok",
};

const noopAdapter: SendAdapter = {
  name: "noop",
  async send() {
    return { messageId: `noop-${Math.random().toString(36).slice(2, 10)}` };
  },
};

function recipients(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    email: `person${i}@example.com`,
    name: `Person ${i} Lastname`,
    company: `Company ${i}`,
    contextNotes: null,
    vars: {},
  }));
}

async function seedCampaign(harness: Harness) {
  const companyId = await harness.createCompany();
  const campaign = await createCampaign({ companyId, name: `Bench ${Date.now()}` });
  const version = await appendTemplateVersion({
    campaignId: campaign.id,
    template: TEMPLATE,
    source: "ai_generated",
    review: PASSING_REVIEW,
  });
  await upsertRecipients(campaign.id, recipients(N));
  await approveEmailCampaign({
    companyId,
    campaignId: campaign.id,
    templateVersionId: version.id,
    approvedByEmail: "bench@example.com",
  });
  for (let i = 0; i < SUPPRESSED; i++) {
    await addSuppression(companyId, `person${i * 7 % N}@example.com`);
  }
  return { companyId, campaignId: campaign.id };
}

async function timed(label: string, fn: () => Promise<unknown>) {
  const q0 = queryCount;
  const t0 = performance.now();
  await fn();
  const ms = performance.now() - t0;
  const queries = queryCount - q0;
  console.log(
    `${label}: ${ms.toFixed(0)} ms, ${queries} queries  ` +
      `(${(ms / N).toFixed(2)} ms and ${(queries / N).toFixed(2)} queries per recipient)`,
  );
  return ms;
}

async function main() {
  const harness = await createEmailPipelineTestDatabase();
  try {
    // Warm-up round so connection setup / JIT doesn't pollute the numbers.
    {
      const { companyId, campaignId } = await seedCampaign(harness);
      await dispatchEmailCampaign({
        companyId,
        campaignId,
        senderIdentity: "bench@example.com",
        unsubscribeBaseUrl: "https://example.com/api/email-pipeline/unsubscribe",
        idempotencyKey: "warmup",
        mode: "dry_run",
      });
    }

    console.log(`\n=== email dispatch benchmark (N=${N}, suppressed≈${SUPPRESSED}) ===`);

    const dry = await seedCampaign(harness);
    await timed("dry_run dispatch", () =>
      dispatchEmailCampaign({
        companyId: dry.companyId,
        campaignId: dry.campaignId,
        senderIdentity: "bench@example.com",
        unsubscribeBaseUrl: "https://example.com/api/email-pipeline/unsubscribe",
        idempotencyKey: "bench-dry",
        mode: "dry_run",
      }),
    );

    const real = await seedCampaign(harness);
    await timed("send dispatch (noop adapter)", () =>
      dispatchEmailCampaign({
        companyId: real.companyId,
        campaignId: real.campaignId,
        senderIdentity: "bench@example.com",
        unsubscribeBaseUrl: "https://example.com/api/email-pipeline/unsubscribe",
        idempotencyKey: "bench-send",
        mode: "send",
        adapter: noopAdapter,
        ratePerMinute: 6_000_000,
      }),
    );
  } finally {
    await harness.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
