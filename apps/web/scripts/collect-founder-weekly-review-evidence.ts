// Loads .env into process.env before anything reads DATABASE_URL. Must be first.
import "dotenv/config";

import { writeFile } from "node:fs/promises";

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as coreSchema from "@launchstack/core/db/schema";
import { FounderWeeklyReviewEvidenceService } from "@launchstack/features/founder-weekly-review";

import { assertLocalDatabaseUrl, parseCollectEvidenceArgs } from "./collect-founder-weekly-review-evidence.lib";

async function main(): Promise<void> {
    const input = parseCollectEvidenceArgs(process.argv.slice(2));

    const url = process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
    assertLocalDatabaseUrl(url);

    const client = postgres(url, { max: 1 });

    try {
        const db = drizzle(client, { schema: coreSchema });
        const service = new FounderWeeklyReviewEvidenceService(db);

        const snapshot = await service.collectFounderWeeklyReviewEvidence({
            companyId: input.companyId,
            reportingPeriod: input.reportingPeriod,
            workspaceTimezone: input.workspaceTimezone,
            founderContext: input.founderContext,
            actor: input.actor,
            contextEntryId: input.contextEntryId,
        });

        const json = JSON.stringify(snapshot, null, 2);
        console.log(json);

        if (input.out) {
            await writeFile(input.out, json, "utf8");

            // write to stderr to isolate from stdout json output
            console.error(`Wrote snapshot to ${input.out}`);
        }
    } finally {
        await client.end({ timeout: 5 });
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
