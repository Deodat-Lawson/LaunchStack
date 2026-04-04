/**
 * Inngest Document Modification Function
 * Background job handler for Adeu-powered DOCX redlining.
 *
 * Fetches a DOCX from Vercel Blob, sends it through the Adeu service
 * for batch edits/review actions, stores the modified DOCX back to Blob,
 * and updates the document record in the database.
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
    concurrency: [{ limit: 1 }],
    retries: 3,
    onFailure: async ({ event, error }) => {
      const documentId = event.data.event.data.documentId;
      console.error(
        `[modifyDocument] All retries exhausted for document ${documentId}:`,
        error.message,
      );
      try {
        await db
          .update(document)
          .set({ updatedAt: new Date() })
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

    // Step 2: Send to Adeu for modification
    const result = await step.run("modify-document", async () => {
      const buffer = Buffer.from(docBuffer, "base64");

      try {
        const { summary, file } = await processDocumentBatch(buffer, {
          author_name: authorName,
          edits,
          actions,
        });

        const modifiedBuffer = Buffer.from(await file.arrayBuffer());
        return {
          summary,
          fileBase64: modifiedBuffer.toString("base64"),
        };
      } catch (err) {
        // 422 = validation error — mark as failed, don't retry
        if (err instanceof AdeuServiceError && err.statusCode === 422) {
          await db
            .update(document)
            .set({ updatedAt: new Date() })
            .where(eq(document.id, documentId));
          console.error(
            `[modifyDocument] Validation error for document ${documentId}: ${err.detail}`,
          );
          return { summary: null, fileBase64: null, validationError: err.detail };
        }
        // 5xx or network error — throw to let Inngest retry
        throw err;
      }
    });

    // If validation failed, stop here (no retry)
    if (result.validationError) {
      return { success: false, error: result.validationError };
    }

    // Step 3: Store the modified DOCX and update the DB
    const storedUrl = await step.run("store-result", async () => {
      const modifiedBuffer = Buffer.from(result.fileBase64!, "base64");

      const stored = await putFile({
        filename: `modified-${documentId}.docx`,
        data: modifiedBuffer,
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      await db
        .update(document)
        .set({
          url: stored.url,
          updatedAt: new Date(),
        })
        .where(eq(document.id, documentId));

      return stored.url;
    });

    return {
      success: true,
      documentId,
      url: storedUrl,
      summary: result.summary,
    };
  },
);
