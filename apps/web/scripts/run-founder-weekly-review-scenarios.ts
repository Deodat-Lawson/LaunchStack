import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
    FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION,
    FounderWeeklyReviewEvidenceService,
    FounderWeeklyReviewRepository,
    FounderWeeklyReviewWorkerService,
    generateFounderWeeklyReview,
    type FounderWeeklyReviewStructuredGenerator,
} from "@launchstack/features/founder-weekly-review";
import { createFounderWeeklyReviewDispatchService } from "~/server/founder-weekly-review/dispatch-service";
import { generateFounderWeeklyReviewStructured } from "~/server/founder-weekly-review/generation-adapter";
import { renderFounderWeeklyReviewMarkdown } from "~/server/founder-weekly-review/markdown";

import { assertLocalDatabaseUrl } from "./collect-founder-weekly-review-evidence.lib";
import { loadScenario } from "./founder-weekly-review-scenario-loader";
import { seedScenario } from "./founder-weekly-review-scenario-seeder";

const require = createRequire(import.meta.url);
const { createFounderWeeklyReviewTestDatabase } = require(
    "../__tests__/founderWeeklyReview/testDb"
) as typeof import("../__tests__/founderWeeklyReview/testDb");

interface RunnerArgs {
    scenarioPath: string;
    outDir?: string;
    print: boolean;
    fakeGeneration: boolean;
}

function parseRunnerArgs(argv: string[]): RunnerArgs {
    const { values } = parseArgs({
        // drop a stray "--" that pnpm forwards when args are passed as `pnpm <script> -- <args>`
        args: argv.filter((arg) => arg !== "--"),
        options: {
            scenario: { type: "string" },
            out: { type: "string" },
            print: { type: "boolean", default: false },
            "fake-generation": { type: "boolean", default: false },
        },
    });
    if (!values.scenario) {
        throw new Error("Missing required --scenario <path> to a scenario.json file.");
    }
    return {
        scenarioPath: values.scenario,
        outDir: values.out,
        print: values.print ?? false,
        fakeGeneration: values["fake-generation"] ?? false,
    };
}

// filler data for generating a fake, placeholder review without calling the model
const stubNoEvidenceSection = {
    state: "no_evidence" as const,
    noEvidence: {
        code: "stub_generation",
        message: "Stub generation: no review content was produced.",
        cta: "Re-run without --fake-generation to generate a real review.",
    },
};
const STUB_REVIEW = {
    schemaVersion: FOUNDER_WEEKLY_REVIEW_V2_SCHEMA_VERSION,
    sections: {
        whatChanged: stubNoEvidenceSection,
        whatShipped: stubNoEvidenceSection,
        whatCustomersSaid: stubNoEvidenceSection,
        currentBlockers: stubNoEvidenceSection,
        nextPriorities: stubNoEvidenceSection,
    },
};

// stand-in for generateFounderWeeklyReviewStructured that does not actually call the model to generate review
const fakeGenerate: FounderWeeklyReviewStructuredGenerator = async ({ schema }) => ({
    object: schema.parse(STUB_REVIEW),
    metadata: { provider: "stub", model: "stub", capability: "founderWeeklyReview", temperature: 0 },
});

async function main(): Promise<void> {
    if (process.env.SYNTHETIC_FWR_LOCAL !== "1") {
        throw new Error("Refusing to run scenarios outside explicit local mode (set SYNTHETIC_FWR_LOCAL=1).");
    }
    const databaseUrl = process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
    assertLocalDatabaseUrl(databaseUrl);

    const args = parseRunnerArgs(process.argv.slice(2));
    const scenario = await loadScenario(resolve(process.cwd(), args.scenarioPath));

    const testDb = await createFounderWeeklyReviewTestDatabase();
    try {
        const { underReviewCompanyId } = await seedScenario(testDb.db, scenario);

        // fake user that "triggers" the review — the pipeline records who ran it and for which company
        const actor = {
            externalUserId: "scenario-runner",
            internalUserId: 1n,
            companyId: underReviewCompanyId,
            role: "owner",
        };

        // everything below is the existing founder-weekly-review job pipeline — the runner just drives it in order

        // create the run (the job record) + dispatch (its claim tokens); the run starts out queued
        const dispatchService = createFounderWeeklyReviewDispatchService(testDb.db);
        const created = await dispatchService.createRunWithDispatch({
            actor,
            requestKey: `scenario-${scenario.name}-${randomUUID()}`,
            reportingPeriod: scenario.reportingPeriod,
            collectionInput: {
                workspaceTimezone: scenario.workspaceTimezone,
                founderContext: scenario.founderContext,
                actorExternalUserId: actor.externalUserId,
            },
        });

        const worker = new FounderWeeklyReviewWorkerService(
            new FounderWeeklyReviewRepository(testDb.db)
        );
        const collectionContext = {
            companyId: actor.companyId,
            runId: created.run.id,
            collectionClaimId: created.dispatch.generationClaimId,
        };
        // claim the run for the collection step so nothing else works the same job
        await worker.claimEvidenceCollection(collectionContext);
        // our collector reads the seeded db into an evidence snapshot
        const snapshot = await new FounderWeeklyReviewEvidenceService(
            testDb.db
        ).collectFounderWeeklyReviewEvidence({
            companyId: actor.companyId,
            reportingPeriod: scenario.reportingPeriod,
            workspaceTimezone: scenario.workspaceTimezone,
            founderContext: scenario.founderContext,
            actor: { externalUserId: actor.externalUserId },
            requestKey: created.run.requestKey,
        });
        // save the snapshot onto the run (only if not already attached)
        const attached = await worker.attachEvidenceSnapshotIfAbsent(collectionContext, snapshot);
        if (!attached.evidenceSnapshot) {
            throw new Error("Evidence snapshot was not attached to the run.");
        }

        const generationContext = {
            companyId: actor.companyId,
            runId: attached.id,
            generationJobId: created.dispatch.generationJobId,
            generationClaimId: created.dispatch.generationClaimId,
        };
        // claim the run again, now for the generation step
        const generating = await worker.claimQueuedRun(generationContext);
        if (!generating.evidenceSnapshot) {
            throw new Error("Generation began without a snapshot.");
        }
        // write the review — real model, or the stub review when --fake-generation is set
        const generated = await generateFounderWeeklyReview({
            evidenceSnapshot: generating.evidenceSnapshot,
            generate: args.fakeGeneration ? fakeGenerate : generateFounderWeeklyReviewStructured,
        });
        // validate + persist the review as a draft on the run
        const saved = await worker.saveGeneratedDraft(
            generationContext,
            generated.reviewPayload,
            generated.modelMetadata
        );
        // read the run back from the db so we export what was actually stored, not the in-memory copy
        const readBack = await new FounderWeeklyReviewRepository(testDb.db).getByCompanyAndRunId(
            actor.companyId,
            saved.id
        );
        if (!readBack?.reviewPayload || !readBack.evidenceSnapshot) {
            throw new Error("Read-back of the persisted draft failed.");
        }

        // evaluation seam: once Peace's evaluator exists, call it here with
        // { evidenceSnapshot: readBack.evidenceSnapshot, reviewPayload: readBack.reviewPayload }
        // and write evaluation.json alongside the other artifacts

        const rendered = renderFounderWeeklyReviewMarkdown(readBack);

        const counts = Object.fromEntries(
            ["document_change", "customer_feedback", "founder_context"].map((type) => [
                type,
                attached.evidenceSnapshot!.items.filter((item) => item.sourceType === type).length,
            ])
        );
        const runSummary = {
            scenario: scenario.name,
            runId: readBack.id,
            status: readBack.status,
            evidenceCounts: counts,
            warningCodes: attached.evidenceSnapshot.sourceWarnings.map((warning) => warning.code),
            provider: generated.modelMetadata.provider,
            model: generated.modelMetadata.model,
        };

        const outDir = resolve(
            process.cwd(),
            args.outDir ?? `.artifacts/founder-weekly-review/scenarios/${scenario.name}`
        );
        await mkdir(outDir, { recursive: true });
        const evidencePath = resolve(outDir, "evidence.json");
        const reportJsonPath = resolve(outDir, "report.json");
        const reportMdPath = resolve(outDir, "report.md");
        const runSummaryPath = resolve(outDir, "run-summary.json");

        await writeFile(evidencePath, JSON.stringify(attached.evidenceSnapshot, null, 2), "utf8");
        await writeFile(
            reportJsonPath,
            JSON.stringify(
                {
                    runId: readBack.id,
                    status: readBack.status,
                    provider: readBack.modelMetadata?.provider,
                    model: readBack.modelMetadata?.model,
                    reportingPeriod: readBack.reportingPeriod,
                    review: readBack.reviewPayload,
                },
                null,
                2
            ),
            "utf8"
        );
        await writeFile(reportMdPath, rendered, "utf8");
        await writeFile(runSummaryPath, JSON.stringify(runSummary, null, 2), "utf8");

        if (args.print) {
            console.log("===== FOUNDER WEEKLY REVIEW =====");
            console.log(rendered);
            console.log("===== END FOUNDER WEEKLY REVIEW =====");
        }
        console.log(
            JSON.stringify(
                { ...runSummary, artifacts: { evidencePath, reportJsonPath, reportMdPath, runSummaryPath } },
                null,
                2
            )
        );
    } finally {
        await testDb.close();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
