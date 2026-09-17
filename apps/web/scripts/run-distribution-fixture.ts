/**
 * Run the distribution pipeline in fixture mode from the terminal.
 *
 *   DATABASE_URL=postgresql://... pnpm --filter @launchstack/web distribution:fixture -- --company 1
 *   ... --program <id>      reuse an existing program instead of creating a sample one
 *   ... --publish           also publish dossiers into Sources (needs storage + app URL)
 *
 * Proves the eight stages end to end against the database the app uses, with
 * deterministic stand-ins for every provider. Prints the run summary and the
 * researched partners. Exit code 1 on a failed run.
 */
import "dotenv/config";

import { configureDatabase, createDb } from "@launchstack/store/client";
import {
    createProgram,
    getRun,
    listPartners,
    listPrograms,
    createRun,
} from "@launchstack/pipelines/distribution/db";
import { createFixturePorts, runDistributionPipeline } from "@launchstack/pipelines/distribution";

let closeDatabase: (() => Promise<void>) | null = null;

function arg(name: string): string | undefined {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error("DATABASE_URL is required (the database the app uses).");
        process.exit(2);
    }
    const database = createDb({ url, maxConnections: 4 });
    configureDatabase(database.db);
    closeDatabase = () => database.close();

    const companyArg = arg("company");
    if (!companyArg) {
        console.error("usage: --company <id> [--program <id>] [--publish]");
        process.exit(2);
    }
    const companyId = BigInt(companyArg);
    const programArg = arg("program");
    const publish = process.argv.includes("--publish");

    let programId = programArg;
    if (!programId) {
        const existing = (await listPrograms(companyId)).find(
            p => p.name === "Sample: EU specialty coffee"
        );
        programId =
            existing?.id ??
            (
                await createProgram({
                    companyId,
                    userId: "cli",
                    input: {
                        name: "Sample: EU specialty coffee",
                        offering:
                            "Single-origin roasted specialty coffee, 250 g retail bags and 1 kg foodservice",
                        categories: ["specialty coffee"],
                        hsCodes: ["0901"],
                        targetTerritories: [
                            { country: "DE" },
                            { country: "NL" },
                            { country: "FR" },
                        ],
                        partnerKinds: ["importer", "distributor", "retailer"],
                        constraints: "MOQ 200 kg; EU organic preferred",
                        knownPartnerDomains: [],
                    },
                })
            ).id;
        console.log(`program: ${programId} (sample)`);
    }

    const publishDossier = null;
    if (publish) {
        const { runFixtureDistribution } = await import("~/server/distribution/fixture-run");
        const run = await createRun({
            companyId,
            programId,
            userId: "cli",
            options: { maxCandidates: 10, mode: "fixture" },
        });
        const summary = await runFixtureDistribution({
            runId: run.id,
            companyId,
            programId,
            userId: "cli",
            requestUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000/",
        });
        await report(run.id, companyId, summary);
        return;
    }

    const run = await createRun({
        companyId,
        programId,
        userId: "cli",
        options: { maxCandidates: 10, mode: "fixture" },
    });
    const ports = createFixturePorts({
        category: "specialty coffee",
        publishDossier,
        debitCredits: null,
    });
    const summary = await runDistributionPipeline({ runId: run.id, companyId, programId }, ports);
    await report(run.id, companyId, summary);
}

async function report(
    runId: string,
    companyId: bigint,
    summary: Awaited<ReturnType<typeof runDistributionPipeline>>
): Promise<void> {
    const run = await getRun(runId, companyId);
    console.log(`run ${runId}: ${run?.status}`);
    console.log(
        `  sources: ${summary.sources.map(s => `${s.source}=${s.status}${s.results ? `(${s.results})` : ""}`).join(" ")}\n` +
            `  mentions ${summary.mentions} → resolved ${summary.resolved} (excluded ${summary.excluded}) → shortlisted ${summary.shortlisted} → enriched ${summary.enriched}` +
            `${summary.gateRejections ? ` · gate rejections ${summary.gateRejections}` : ""}${summary.budgetExhausted ? ` · budget exhausted ${summary.budgetExhausted}` : ""}\n` +
            `  screened ${summary.screened} (flagged ${summary.flagged}) · published ${summary.published} · ${summary.wallMs ?? 0} ms`
    );
    const partners = await listPartners(companyId, { programId: run?.programId, limit: 50 });
    console.log("  partners:");
    for (const p of partners) {
        console.log(
            `    ${String(p.relationship.fitScore ?? "—").padStart(3)}  ${p.relationship.stage.padEnd(11)} ${p.relationship.kind.padEnd(11)} ${(p.org.country ?? "??").padEnd(3)} ${p.org.name}  [${p.evidenceCount} evidence${p.relationship.screening?.status === "flagged" ? ", screening flag" : ""}]`
        );
    }
    if (run?.status !== "completed") process.exitCode = 1;
}

main()
    .then(async () => {
        await closeDatabase?.();
        process.exit(process.exitCode ?? 0);
    })
    .catch(async error => {
        console.error(error);
        await closeDatabase?.();
        process.exit(1);
    });
