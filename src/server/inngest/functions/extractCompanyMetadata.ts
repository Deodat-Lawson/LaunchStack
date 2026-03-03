/**
 * Inngest Function — Company Metadata Extraction
 *
 * Background job that runs after document ingestion completes.
 * Extracts structured company metadata from a document's chunks,
 * merges it into the company's canonical metadata JSON, and
 * persists both the updated canonical row and an audit history entry.
 *
 * Flow:
 *   1. Load any existing canonical metadata for the company.
 *   2. Run extract-then-merge pipeline (extractor → merger).
 *   3. Upsert the canonical row in `company_metadata`.
 *   4. Append a row to `company_metadata_history`.
 */

import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "~/server/db";
import {
    companyMetadata,
    companyMetadataHistory,
} from "~/server/db/schema/company-metadata";
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
        const { documentId, companyId } = event.data as {
            documentId: number;
            companyId: string;
        };

        // ------------------------------------------------------------------
        // Step 1: Load existing canonical metadata (if any)
        // ------------------------------------------------------------------
        const existingMetadata = await step.run(
            "load-existing-metadata",
            async () => {
                const rows = await db
                    .select({ metadata: companyMetadata.metadata })
                    .from(companyMetadata)
                    .where(eq(companyMetadata.companyId, BigInt(companyId)))
                    .limit(1);

                return rows[0]?.metadata ?? null;
            },
        );

        // ------------------------------------------------------------------
        // Step 2: Extract facts from document chunks and merge
        // ------------------------------------------------------------------
        const result = await step.run("extract-and-merge", async () => {
            return runCompanyMetadataTool({
                documentId,
                companyId,
                existingMetadata: existingMetadata ?? undefined,
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

        const { updatedMetadata, diff } = result.result;

        // ------------------------------------------------------------------
        // Step 3: Upsert canonical metadata row
        // ------------------------------------------------------------------
        await step.run("persist-metadata", async () => {
            await db
                .insert(companyMetadata)
                .values({
                    companyId: BigInt(companyId),
                    schemaVersion: updatedMetadata.schema_version,
                    metadata: updatedMetadata,
                    lastExtractionDocumentId: BigInt(documentId),
                })
                .onConflictDoUpdate({
                    target: companyMetadata.companyId,
                    set: {
                        schemaVersion: updatedMetadata.schema_version,
                        metadata: updatedMetadata,
                        lastExtractionDocumentId: BigInt(documentId),
                        updatedAt: new Date(),
                    },
                });
        });

        // ------------------------------------------------------------------
        // Step 4: Append audit history entry
        // ------------------------------------------------------------------
        await step.run("persist-history", async () => {
            await db.insert(companyMetadataHistory).values({
                companyId: BigInt(companyId),
                documentId: BigInt(documentId),
                changeType: "extraction",
                diff,
                changedBy: "system",
            });
        });

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
