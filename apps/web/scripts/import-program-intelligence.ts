/**
 * Trusted operator import for public program intelligence.
 * Import the Program catalogue first. This command does not score fit or edit tracking.
 *
 * pnpm --filter @launchstack/web accelerators:import-intelligence -- --validate
 * DATABASE_URL=... pnpm --filter @launchstack/web accelerators:import-intelligence -- --installation <name>
 */
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import { loadPublishedCatalogue } from "@launchstack/pipelines/accelerators/catalogue";
import { hashValue } from "@launchstack/pipelines/accelerators";
import { importProgramIntelligence } from "@launchstack/pipelines/accelerators/db";
import { configureDatabase, createDb } from "@launchstack/store/client";

dotenv.config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

async function main(): Promise<void> {
    const args = process.argv.slice(2).filter(arg => arg !== "--");
    let validateOnly = false;
    let installation: string | null = null;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index]!;
        if (arg === "--validate") {
            validateOnly = true;
            continue;
        }
        if (arg === "--installation") {
            const value = args[++index];
            if (!value || value.startsWith("--")) throw new Error("--installation needs a name");
            installation = value;
            continue;
        }
        if (arg === "--help") {
            console.log(
                "Usage: accelerators:import-intelligence [--validate | --installation <name>]"
            );
            return;
        }
        throw new Error(`Unknown option: ${arg}`);
    }
    if (!validateOnly && !installation) {
        throw new Error(
            "Usage: accelerators:import-intelligence [--validate | --installation <name>]"
        );
    }
    const root = fileURLToPath(new URL("../../../fixtures/accelerators/", import.meta.url));
    const { dossiers } = loadPublishedCatalogue(root);
    console.log(
        JSON.stringify(
            {
                validated: dossiers.map(dossier => ({
                    programId: dossier.programId,
                    contentHash: hashValue(dossier),
                    cycleIds: dossier.batches.cycles.map(cycle => cycle.id),
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
        const result = await importProgramIntelligence(dossiers);
        console.log(JSON.stringify({ installation, ...result }, null, 2));
    } finally {
        await database.close();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
