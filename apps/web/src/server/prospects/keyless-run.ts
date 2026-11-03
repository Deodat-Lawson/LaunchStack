/**
 * Run the discovery pipeline in keyless mode for one program, in this
 * process. Keyless mode needs no API key: OpenStreetMap and the YC
 * directory find organisations, each one's own website is read by the page
 * profiler, and persistence, scoring, stages and publishing are the real
 * code. It is the path Find companies takes whenever the environment has
 * no model or search provider configured, which is every fresh dev setup.
 *
 * The route calls this through Next's `after()`, so the request returns the
 * queued run at once and the stages update the run row as they go; the UI
 * polls the run like a worker-executed one. Public sources are slow (tens
 * of seconds), which is why this never runs inline in the request.
 */
import {
    createKeylessPorts,
    runDistributionPipeline,
    type PublishDossierInput,
    type RunSummary,
} from "@launchstack/pipelines/distribution";
import { getProgram } from "@launchstack/pipelines/distribution/db";

import { uploadFile } from "~/lib/storage";
import { processDocumentUpload } from "~/server/services/document-upload";

export interface KeylessRunArgs {
    runId: string;
    companyId: bigint;
    programId: string;
    userId: string;
    /** Base URL for storage resolution when publishing profiles. */
    requestUrl: string;
    skipPublish?: boolean;
}

/**
 * Profiles are published into Sources through the ingestion pipeline, which
 * needs FILE_ACCESS_TOKEN_SECRET to read database-backed uploads. A dev
 * environment without it keeps every row and skips only the document.
 */
export function canPublishToSources(): boolean {
    return Boolean(process.env.FILE_ACCESS_TOKEN_SECRET);
}

export async function runKeylessProspects(args: KeylessRunArgs): Promise<RunSummary> {
    const program = await getProgram(args.programId, args.companyId);
    if (!program) throw new Error("Segment not found");

    if (!args.skipPublish && !canPublishToSources())
        console.warn(
            "[prospects] FILE_ACCESS_TOKEN_SECRET is not set; profiles stay in the database and are not published into Sources."
        );
    const publishDossier =
        args.skipPublish || !canPublishToSources()
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
                      documentName: input.title,
                      rawDocumentUrl: stored.url,
                      creationKey: input.creationKey,
                      category: `Prospects / ${program.name}`,
                      explicitStorageType: stored.provider,
                      mimeType: "text/markdown",
                      originalFilename: input.filename,
                      requestUrl: args.requestUrl,
                  });
                  return { documentId: upload.document.id };
              };

    const ports = createKeylessPorts({ publishDossier, debitCredits: null });
    return runDistributionPipeline(
        { runId: args.runId, companyId: args.companyId, programId: args.programId },
        ports
    );
}
