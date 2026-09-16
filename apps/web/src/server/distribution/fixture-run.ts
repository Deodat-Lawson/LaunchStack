/**
 * Run the distribution pipeline in fixture mode, inline, for one program.
 *
 * Fixture mode replaces every outside dependency (model, search, pages,
 * trade data, screening) with deterministic stand-ins from
 * `@launchstack/pipelines/distribution`, while persistence, exclusions,
 * scoring, stages and publishing are the real code. It needs no API key and
 * debits no credits, finishes in seconds, and produces realistic partners,
 * evidence and dossiers to test the rest of the product against.
 *
 * It runs in the request rather than on the worker so a manual tester (or a
 * CI job) gets a completed run back from one POST, independent of whether an
 * Inngest worker is attached. Live runs still go through the worker.
 *
 * Kept in its own module so route tests can mock it: the vertical's barrel
 * re-exports the playbook loader, whose `import.meta.url` babel-jest cannot
 * parse.
 */
import {
    createFixturePorts,
    runDistributionPipeline,
    type PublishDossierInput,
    type RunSummary,
} from "@launchstack/pipelines/distribution";
import { getProgram } from "@launchstack/pipelines/distribution/db";

import { uploadFile } from "~/lib/storage";
import { processDocumentUpload } from "~/server/services/document-upload";

export const FIXTURE_SOURCES_FOLDER = "Distribution / Sample";

export interface FixtureRunArgs {
    runId: string;
    companyId: bigint;
    programId: string;
    userId: string;
    /** Base URL for storage resolution when publishing dossiers. */
    requestUrl: string;
    /** Skip publishing dossiers into Sources (CI and unit contexts). Default false. */
    skipPublish?: boolean;
}

export async function runFixtureDistribution(args: FixtureRunArgs): Promise<RunSummary> {
    const program = await getProgram(args.programId, args.companyId);
    if (!program) throw new Error("Program not found");

    const publishDossier = args.skipPublish
        ? null
        : async (input: PublishDossierInput) => {
              const stored = await uploadFile({
                  filename: input.filename,
                  data: Buffer.from(input.markdown, "utf8"),
                  contentType: "text/markdown",
                  userId: args.userId,
                  companyId: args.companyId,
              });
              const upload = await processDocumentUpload({
                  user: { userId: args.userId, companyId: args.companyId },
                  documentName: `[Sample] ${input.title}`,
                  rawDocumentUrl: stored.url,
                  creationKey: input.creationKey,
                  category: FIXTURE_SOURCES_FOLDER,
                  explicitStorageType: stored.provider,
                  mimeType: "text/markdown",
                  originalFilename: input.filename,
                  requestUrl: args.requestUrl,
              });
              return { documentId: upload.document.id };
          };

    const ports = createFixturePorts({
        category: program.categories[0] ?? program.offering.slice(0, 40),
        publishDossier,
        debitCredits: null,
    });
    return runDistributionPipeline(
        { runId: args.runId, companyId: args.companyId, programId: args.programId },
        ports
    );
}
