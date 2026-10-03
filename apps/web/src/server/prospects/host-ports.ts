/**
 * What the host owes the distribution pipeline: publishing dossiers into
 * Sources (needs the app's storage and ingestion) and metering (needs the
 * ledger). The pipeline's own ports come from the pipelines package; these
 * are the same for every mode, and the mode picks which pipeline ports wrap
 * them.
 *
 * Every mode runs on the worker (ADR-003): the request returns the queued
 * run and the UI polls the row. Sample mode is the one exception, run
 * inline from the request for CI and manual testing, and it uses these
 * ports too.
 */
import {
    createDefaultPorts,
    createFixturePorts,
    createKeylessPorts,
    type DistributionPorts,
    type PublishDossierInput,
} from "@launchstack/pipelines/distribution";
import type { ProgramRecord, RunOptions } from "@launchstack/pipelines/distribution/types";

import { debitTokens } from "~/lib/credits";
import { uploadFile } from "~/lib/storage";
import { processDocumentUpload } from "~/server/services/document-upload";

export interface HostPortArgs {
    companyId: bigint;
    userId: string;
    /** Base URL for storage resolution when publishing profiles. */
    requestUrl: string;
    program: ProgramRecord;
    /** Skip publishing dossiers into Sources (CI and unit contexts). */
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

export function publishDossierPort(
    args: HostPortArgs,
    options: { titlePrefix?: string; category?: string } = {}
): DistributionPorts["publishDossier"] {
    if (args.skipPublish || !canPublishToSources()) return null;
    return async (input: PublishDossierInput) => {
        const stored = await uploadFile({
            filename: input.filename,
            data: Buffer.from(input.markdown, "utf8"),
            contentType: "text/markdown",
            userId: args.userId,
            companyId: args.companyId,
        });
        const upload = await processDocumentUpload({
            user: { userId: args.userId, companyId: args.companyId },
            documentName: `${options.titlePrefix ?? ""}${input.title}`,
            rawDocumentUrl: stored.url,
            creationKey: input.creationKey,
            category: options.category ?? input.category,
            explicitStorageType: stored.provider,
            mimeType: "text/markdown",
            originalFilename: input.filename,
            requestUrl: args.requestUrl,
        });
        return { documentId: upload.document.id };
    };
}

export const FIXTURE_SOURCES_FOLDER = "Distribution / Sample";

/** The pipeline ports for a run's mode, over this host's publish and metering. */
export function portsForMode(mode: RunOptions["mode"], args: HostPortArgs): DistributionPorts {
    switch (mode) {
        case "fixture":
            return createFixturePorts({
                category: args.program.categories[0] ?? args.program.offering.slice(0, 40),
                publishDossier: publishDossierPort(args, {
                    titlePrefix: "[Sample] ",
                    category: FIXTURE_SOURCES_FOLDER,
                }),
                debitCredits: null,
            });
        case "keyless":
            return createKeylessPorts({
                publishDossier: publishDossierPort(args, {
                    category: `Prospects / ${args.program.name}`,
                }),
                debitCredits: null,
            });
        case "live":
            return createDefaultPorts({
                publishDossier: publishDossierPort(args),
                debitCredits: async ({ amount, description, referenceId }) => {
                    await debitTokens({
                        companyId: args.companyId,
                        amount,
                        service: "distribution_research",
                        description,
                        referenceId,
                    });
                },
            });
    }
}
