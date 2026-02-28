/**
 * Inngest Function — Company Metadata Extraction
 *
 * Background job that runs after document ingestion completes.
 * Extracts structured company metadata from a document's chunks
 * and merges it into the company's canonical metadata JSON.
 *
 * Currently operates in memory-only mode (no DB persistence).
 * Once the `companyMetadata` table is created (db:push), the
 * TODO sections below should be filled in to load/save state.
 */

import { inngest } from "../client";
import { runCompanyMetadataTool } from "~/lib/tools/company-metadata";

// ============================================================================
// Inngest Function
// ============================================================================

export const extractCompanyMetadataJob = inngest.createFunction(
    {
        id: "extract-company-metadata",
        name: "Company Metadata Extraction",
        retries: 3,
        onFailure: async ({ error, event }) => {
            console.error(
                `[CompanyMetadata] Pipeline failed: ${JSON.stringify(event.data)}`,
                error,
            );
        },
    },
    { event: "company-metadata/extract.requested" },
    async ({ event, step }) => {
        const { documentId, companyId } = event.data;

        // Step 1: Extract facts and merge into canonical metadata
        const result = await step.run("extract-and-merge", async () => {
            // TODO: Once DB tables are created, load existing metadata here:
            //
            // const row = await db
            //     .select({ metadata: companyMetadata.metadata })
            //     .from(companyMetadata)
            //     .where(eq(companyMetadata.companyId, BigInt(companyId)))
            //     .limit(1);
            // const existingMetadata = row[0]?.metadata ?? undefined;

            return runCompanyMetadataTool({
                documentId,
                companyId,
                // existingMetadata,  // uncomment when DB is ready
            });
        });

        if (!result.success) {
            throw new Error(
                result.error ?? "Company metadata extraction failed",
            );
        }

        if (!result.result) {
            console.log(
                `[CompanyMetadata] No extractable facts in document ${documentId}`,
            );
            return { success: true, factsFound: false };
        }

        // Step 2: Persist results (TODO — pending DB table creation)
        //
        // await step.run("persist-metadata", async () => {
        //     await db
        //         .insert(companyMetadata)
        //         .values({
        //             companyId: BigInt(companyId),
        //             metadata: result.result.updatedMetadata,
        //             updatedAt: new Date(),
        //         })
        //         .onConflictDoUpdate({
        //             target: companyMetadata.companyId,
        //             set: {
        //                 metadata: result.result.updatedMetadata,
        //                 updatedAt: new Date(),
        //             },
        //         });
        //
        //     await db.insert(companyMetadataHistory).values({
        //         companyId: BigInt(companyId),
        //         documentId,
        //         diff: result.result.diff,
        //         changeType: "extraction",
        //         changedBy: "system",
        //     });
        // });

        const { diff } = result.result;

        console.log(
            `[CompanyMetadata] Document ${documentId}: ` +
                `${diff.added.length} added, ${diff.updated.length} updated, ` +
                `${diff.deprecated.length} deprecated facts`,
        );

        return {
            success: true,
            factsFound: true,
            diff: {
                added: diff.added.length,
                updated: diff.updated.length,
                deprecated: diff.deprecated.length,
            },
        };
    },
);
