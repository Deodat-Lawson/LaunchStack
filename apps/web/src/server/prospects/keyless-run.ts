/**
 * Run the discovery pipeline in keyless mode for one program, in this
 * process. Keyless mode needs no search key: OpenStreetMap finds real
 * places (shops, cafés, workshops, offices) in the segment's area.
 * Persistence, scoring and stages are the real code. The search stops at
 * the shortlist; a company's website is read when someone opens it
 * (`research.ts`). The workspace's embedding model matches companies to
 * the segment by meaning, and its chat model (when there is one) checks
 * the shortlist.
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
import { prospectEmbedder, prospectFitJudge } from "~/server/prospects/matching";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";
import { processDocumentUpload } from "~/server/services/document-upload";

/**
 * Where a keyless run executes. `inline` (the default) works with nothing else
 * running; a deployment with the worker attached sets PROSPECTS_EXECUTOR=worker
 * and it runs as the Inngest job live runs use, durable step by step.
 */
export function readProspectsExecutor(
    env: Record<string, string | undefined> = process.env
): "inline" | "worker" {
    return env.PROSPECTS_EXECUTOR?.trim().toLowerCase() === "worker" ? "worker" : "inline";
}

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

/** A dossier markdown file, through the same ingestion path a search uses. */
export async function publishProspectDossier(args: {
    userId: string;
    companyId: bigint;
    programName: string;
    requestUrl: string;
    input: PublishDossierInput;
}): Promise<{ documentId: number }> {
    const stored = await uploadFile({
        filename: args.input.filename,
        data: Buffer.from(args.input.markdown, "utf8"),
        contentType: "text/markdown",
        userId: args.userId,
        companyId: args.companyId,
    });
    const upload = await processDocumentUpload({
        user: { userId: args.userId, companyId: args.companyId },
        documentName: args.input.title,
        rawDocumentUrl: stored.url,
        creationKey: args.input.creationKey,
        category: `Prospects / ${args.programName}`,
        explicitStorageType: stored.provider,
        mimeType: "text/markdown",
        originalFilename: args.input.filename,
        requestUrl: args.requestUrl,
    });
    return { documentId: upload.document.id };
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
            : (input: PublishDossierInput) =>
                  publishProspectDossier({
                      userId: args.userId,
                      companyId: args.companyId,
                      programName: program.name,
                      requestUrl: args.requestUrl,
                      input,
                  });

    const ports = createKeylessPorts({
        publishDossier,
        debitCredits: null,
        embed: await prospectEmbedder(args.companyId),
        judgeFit: await prospectFitJudge(args.companyId),
    });
    // The fit check resolves the workspace's models when it runs.
    const aiUse = { feature: "prospects", userId: args.userId, enforce: false } as const;
    return withWorkspaceChatModels(args.companyId, aiUse, () =>
        runDistributionPipeline(
            { runId: args.runId, companyId: args.companyId, programId: args.programId },
            ports,
            { enrich: false }
        )
    );
}
