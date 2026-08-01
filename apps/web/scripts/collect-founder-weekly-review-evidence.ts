// Loads .env into process.env before anything reads DATABASE_URL. Must be first.
import "dotenv/config";

import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as coreSchema from "@launchstack/core/db/schema";
import { FounderWeeklyReviewEvidenceService } from "@launchstack/features/founder-weekly-review";

export interface CollectEvidenceInput {
    companyId: bigint;
    reportingPeriod: { start: string; end: string };
    workspaceTimezone: string;
    // optional founder-entered context, if included then actor is required
    founderContext?: string;
    actor?: { externalUserId: string };
    contextEntryId?: string;
    // optional path to write the snapshot to
    out?: string;
}

// only accepts local db url
const LOCAL_DATABASE_URL_PATTERN =
    /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost)(?::\d+)?\//i;


// exclude the invalid url from error message as it contains credentials
export function assertLocalDatabaseUrl(url: string): void {
    if (process.env.NODE_ENV === "production") {
        throw new Error("Refusing to run the evidence collector command with NODE_ENV=production.");
    }
    if (!LOCAL_DATABASE_URL_PATTERN.test(url)) {
        throw new Error("Refusing non-local database. Use local instance to run this read-only command.");
    }
}

function requireFlag(value: string | undefined, name: string): string {
    if (value === undefined || value === "") {
        throw new Error(`Missing required flag --${name}.`);
    }
    return value;
}

function assertIsoDate(value: string, name: string): void {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
        throw new Error(`--${name} must be a YYYY-MM-DD date, received "${value}".`);
    }

    // check shape of inputted date and whether or not is actually valid date
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        throw new Error(`--${name} must be a real calendar date, received "${value}".`);
    }
}

export function parseCollectEvidenceArgs(argv: string[]): CollectEvidenceInput {
    const { values } = parseArgs({
        args: argv,
        allowPositionals: false,
        options: {
            company: { type: "string" },
            start: { type: "string" },
            end: { type: "string" },
            tz: { type: "string" },
            "founder-context": { type: "string" },
            actor: { type: "string" },
            out: { type: "string" },
        },
    });

    const company = requireFlag(values.company, "company");
    const start = requireFlag(values.start, "start");
    const end = requireFlag(values.end, "end");
    const tz = requireFlag(values.tz, "tz");

    let companyId: bigint;
    try {
        companyId = BigInt(company);
    } catch {
        throw new Error(`--company must be an integer company id, received "${company}".`);
    }
    if (companyId <= 0n) {
        throw new Error(`--company must be a positive company id, received "${company}".`);
    }

    assertIsoDate(start, "start");
    assertIsoDate(end, "end");

    if (start > end) {
        throw new Error(`--start (${start}) must be before or the same as --end (${end}).`);
    }

    const founderContext = values["founder-context"];
    const actorId = values.actor;
    if (founderContext !== undefined && actorId === undefined) {
        throw new Error("--founder-context requires --actor <externalUserId>.");
    }

    const input: CollectEvidenceInput = {
        companyId,
        reportingPeriod: { start, end },
        workspaceTimezone: tz,
    };

    if (values.out !== undefined) {
        input.out = values.out;
    }
    
    if (founderContext !== undefined && actorId !== undefined) {
        input.founderContext = founderContext;
        input.actor = { externalUserId: actorId };
        input.contextEntryId = `cli:${companyId}:${start}:${end}`;
    }

    return input;
}

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

            // write to stderror to isolate from stdout json output
            console.error(`Wrote snapshot to ${input.out}`);
        }
    } finally {
        await client.end({ timeout: 5 });
    }
}

// only execute main when running directly through command, avoid running if just being imported
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
