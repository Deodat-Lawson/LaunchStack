/**
 * Inngest Document Modification Function
 * Background job handler for Adeu-powered DOCX redlining.
 *
 * Fetches a DOCX from Vercel Blob, sends it through the Adeu service
 * for batch edits/review actions, stores the modified DOCX back to Blob,
 * and updates the document record in the database.
 *
 * Key design decisions:
 * - Modified DOCX is stored in blob storage (not returned as base64) to stay
 *   under Inngest's 4 MB step output limit (Fix 1.1)
 * - Concurrency is scoped per-document so different documents process in
 *   parallel (Fix 1.2)
 * - Failure metadata is written to the document record so failed edits are
 *   distinguishable from successes (Fix 1.4)
 * - The DB update lives in its own step.run so Inngest memoizes it separately,
 *   preventing duplicate writes on replay (Fix 1.15)
 */

import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "~/server/db";
import { document } from "~/server/db/schema";
import { putFile, fetchBlob } from "~/server/storage/vercel-blob";
import { processDocumentBatch, AdeuServiceError } from "~/lib/adeu/client";

export const modifyDocument = inngest.createFunction(
  {
    id: "modify-document",
    // Fix 1.2: scope concurrency by documentId so different documents
    // process in parallel while edits to the same document are serialized
    concurrency: [{ limit: 1, key: "event.data.documentId" }],
    retries: 3,
    onFailure: async ({ event, error }) => {
      const documentId = event.data.event.data.documentId;
      console.error(
        `[modifyDocument] All retries exhausted for document ${documentId}:`,
        error.message,
      );
      try {
        // Fix 1.4: write failure metadata so failed documents are distinguishable
        await db
          .update(document)
          .set({
            updatedAt: new Date(),
            ocrMetadata: {
              error: "editing_failed",
              errorMessage: error instanceof Error ? error.message : String(error),
              failedAt: new Date().toISOString(),
            },
          })
          .where(eq(document.id, documentId));
      } catch (dbErr) {
        console.error("[modifyDocument] Failed to mark document as failed:", dbErr);
      }
    },
  },
  { event: "document/modify.requested" },
  async ({ event, step }) => {
    const { documentId, documentUrl, authorName, edits, actions } = event.data;

    // Step 1: Fetch the DOCX from Vercel Blob
    const docBuffer = await step.run("fetch-document", async () => {
      const res = await fetchBlob(documentUrl);
      if (!res.ok) {
        throw new Error(`Failed to fetch document: HTTP ${res.status}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer).toString("base64");
    });

    // Step 2: Send to Adeu for modification, store result in blob storage
    const result = await step.run("modify-document", async () => {
      const buffer = Buffer.from(docBuffer, "base64");

      try {
        const { summary, file } = await processDocumentBatch(buffer, {
          author_name: authorName,
          edits,
          actions,
        });

        const modifiedBuffer = Buffer.from(await file.arrayBuffer());

        // Fix 1.1: store modified DOCX in blob storage instead of returning
        // raw base64, keeping step output well under Inngest's 4 MB limit
        const stored = await putFile({
          filename: `adeu-modified-${documentId}.docx`,
          data: modifiedBuffer,
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });

        return {
          summary,
          blobUrl: stored.url,
        };
      } catch (err) {
        // 422 = validation error — don't retry
        if (err instanceof AdeuServiceError && err.statusCode === 422) {
          console.error(
            `[modifyDocument] Validation error for document ${documentId}: ${err.detail}`,
          );
          return { summary: null, blobUrl: null, validationError: err.detail };
        }
        // 5xx or network error — throw to let Inngest retry
        throw err;
      }
    });

    // If validation failed, record the failure and stop (no retry)
    if ("validationError" in result && result.validationError) {
      // Fix 1.4: write failure metadata for 422 validation errors
      // Fix 1.15: DB update in its own step for memoization
      await step.run("record-validation-failure", async () => {
        await db
          .update(document)
          .set({
            updatedAt: new Date(),
            ocrMetadata: {
              error: "editing_failed",
              errorMessage: result.validationError!,
              failedAt: new Date().toISOString(),
            },
          })
          .where(eq(document.id, documentId));
      });
      return { success: false, error: result.validationError };
    }

    // Step 3: Store the final URL on the document record
    // Fix 1.15: DB update is in its own step.run so Inngest memoizes it
    // separately — replays won't re-execute the write
    const storedUrl = await step.run("update-document-record", async () => {
      await db
        .update(document)
        .set({
          url: result.blobUrl!,
          updatedAt: new Date(),
        })
        .where(eq(document.id, documentId));

      return result.blobUrl!;
    });

    return {
      success: true,
      documentId,
      url: storedUrl,
      summary: result.summary,
    };
  },
);
