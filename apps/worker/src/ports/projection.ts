/**
 * CompanyProjectionPort — the company-state projection (ADR-005 §5).
 *
 * Same body as the retired `extract-company-metadata` Inngest function:
 * load canonical metadata → extract-then-merge from the indexed source's
 * chunks → upsert canonical row → append audit history. It now runs as the
 * `evidence.version.indexed` outbox handler, so every projection is
 * traceable to the evidence version that triggered it.
 */
import { eq } from "drizzle-orm";

import type {
  CompanyProjectionPort,
  LoggerPort,
} from "@launchstack/application";
import { runCompanyMetadataTool } from "@launchstack/features/company-metadata";

import { db } from "~/server/db";
import { companyMetadata, companyMetadataHistory } from "~/server/db/schema";
import { generateStructured } from "~/lib/llm";

export function createCompanyProjectionPort(
  logger: LoggerPort,
): CompanyProjectionPort {
  return {
    async projectCompanyState({ companyId, sourceId, traceId }) {
      const rows = await db
        .select({ metadata: companyMetadata.metadata })
        .from(companyMetadata)
        .where(eq(companyMetadata.companyId, BigInt(companyId)))
        .limit(1);
      const existingMetadata = rows[0]?.metadata ?? null;

      const result = await runCompanyMetadataTool({
        documentId: sourceId,
        companyId: String(companyId),
        existingMetadata: existingMetadata ?? undefined,
        generate: (input) =>
          generateStructured({
            ...input,
            capability: "smallExtraction",
          }),
      });

      if (!result.success) {
        throw new Error(result.error ?? "Company metadata extraction failed");
      }

      if (!result.result) {
        logger.info(
          { traceId, companyId, sourceId },
          "no extractable company facts in source",
        );
        return { projected: false };
      }

      const { updatedMetadata, diff } = result.result;

      await db
        .insert(companyMetadata)
        .values({
          companyId: BigInt(companyId),
          schemaVersion: updatedMetadata.schema_version,
          metadata: updatedMetadata,
          lastExtractionDocumentId: BigInt(sourceId),
        })
        .onConflictDoUpdate({
          target: companyMetadata.companyId,
          set: {
            schemaVersion: updatedMetadata.schema_version,
            metadata: updatedMetadata,
            lastExtractionDocumentId: BigInt(sourceId),
            updatedAt: new Date(),
          },
        });

      await db.insert(companyMetadataHistory).values({
        companyId: BigInt(companyId),
        documentId: BigInt(sourceId),
        changeType: "extraction",
        diff,
        changedBy: "system",
      });

      logger.info(
        {
          traceId,
          companyId,
          sourceId,
          added: diff.added.length,
          updated: diff.updated.length,
          deprecated: diff.deprecated.length,
        },
        "company state projected from indexed evidence",
      );

      return { projected: true };
    },
  };
}
