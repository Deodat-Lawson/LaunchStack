/**
 * Trusted installation operator only; never expose this command through a company API.
 *
 * pnpm --filter @launchstack/web accelerators:import -- --validate <record.json> [...]
 * DATABASE_URL=... pnpm --filter @launchstack/web accelerators:import -- --installation <name> <record.json> [...]
 *
 * DATABASE_URL selects the installation. --installation names that target in the output.
 * Validation needs no database; imports validate all files before one idempotent transaction.
 * Files contain a single schemaVersion:2 Program or an array of Programs, with committed logo assets.
 */
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import {
    CatalogueProgramSchema,
    hashValue,
    type CatalogueProgram,
} from "@launchstack/pipelines/accelerators";
import { importCatalogue } from "@launchstack/pipelines/accelerators/db";
import { configureDatabase, createDb } from "@launchstack/store/client";

dotenv.config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

async function main(): Promise<void> {
    const args = process.argv.slice(2).filter(arg => arg !== "--");
    const files: string[] = [];
    let validateOnly = false;
    let installation: string | null = null;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index]!;
        if (arg === "--help") {
            console.log(
                "Usage: accelerators:import [--validate | --installation <name>] <record.json> [...]"
            );
            return;
        }
        if (arg === "--validate") {
            validateOnly = true;
            continue;
        }
        if (arg === "--installation") {
            const value = args[++index];
            if (!value || value.startsWith("--") || !value.trim())
                throw new Error("--installation needs the target installation name");
            installation = value;
            continue;
        }
        if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
        files.push(arg);
    }
    if (files.length === 0 || (!validateOnly && !installation)) {
        throw new Error(
            "Usage: accelerators:import [--validate | --installation <name>] <record.json> [...]"
        );
    }
    const records: CatalogueProgram[] = [];
    for (const file of files) {
        let raw: unknown;
        try {
            raw = JSON.parse(await readFile(file, "utf8"));
        } catch (error) {
            throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
        }
        for (const [index, value] of (Array.isArray(raw) ? raw : [raw]).entries()) {
            const parsed = CatalogueProgramSchema.safeParse(value);
            if (!parsed.success) throw new Error(`${file}[${index}]: ${parsed.error.message}`);
            const logo = await stat(
                new URL(`../public${parsed.data.logo.path}`, import.meta.url)
            ).catch(() => null);
            if (!logo?.isFile() || logo.size === 0) {
                throw new Error(
                    `${file}[${index}].logo.path: add the logo asset at apps/web/public${parsed.data.logo.path}`
                );
            }
            records.push(parsed.data);
        }
    }
    if (records.length === 0) throw new Error("No Programs supplied");
    if (new Set(records.map(program => program.id)).size !== records.length) {
        throw new Error("Program IDs must be unique across all input files");
    }
    console.log(
        JSON.stringify(
            {
                validated: records.map(program => ({
                    id: program.id,
                    contentHash: hashValue(program),
                })),
            },
            null,
            2
        )
    );
    if (validateOnly) return;
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL must name the intended installation database");
    const database = createDb({ url, maxConnections: 1 });
    try {
        configureDatabase(database.db);
        const result = await importCatalogue(records);
        console.log(JSON.stringify({ installation, ...result }, null, 2));
    } finally {
        await database.close();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
