/**
 * Website Ingestion API Route
 *
 * Accepts a URL to crawl and embed. For single-page fetches, processes
 * inline. For multi-page crawls, dispatches an Inngest background job.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { users, document, ocrJobs } from "~/server/db/schema";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { crawlWebsite } from "~/lib/ingestion/services/web-crawler";
import { putFile } from "~/server/storage/vercel-blob";
import { triggerDocumentProcessing } from "~/lib/ocr/trigger";
import { inngest } from "~/server/inngest/client";

const IngestUrlSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  url: z.string().url("Must be a valid URL").refine(
    (u) => u.startsWith("https://") || u.startsWith("http://"),
    "URL must start with http:// or https://",
  ),
  category: z.string().optional(),
  title: z.string().optional(),
  crawlDepth: z.number().int().min(0).max(3).optional().default(0),
  maxPages: z.number().int().min(1).max(50).optional().default(10),
});

export async function POST(request: Request) {
  return withRateLimit(request, RateLimitPresets.strict, async () => {
    try {
      const validation = await validateRequestBody(request, IngestUrlSchema);
      if (!validation.success) {
        return validation.response;
      }

      const data = validation.data;
      const userId = data.userId;
      const url = data.url;
      const category = data.category;
      const title = data.title;
      const crawlDepth = data.crawlDepth ?? 0;
      const maxPages = data.maxPages ?? 10;

      console.log(
        `[IngestUrl] Incoming: url="${url}", depth=${crawlDepth}, maxPages=${maxPages}, user=${userId}`,
      );

      const [userInfo] = await db
        .select()
        .from(users)
        .where(eq(users.userId, userId));

      if (!userInfo) {
        return NextResponse.json(
          { error: "Invalid user" },
          { status: 400 },
        );
      }

      const companyId = userInfo.companyId;
      const companyIdString = companyId.toString();
      const documentCategory = category ?? "Websites";

      if (crawlDepth > 0) {
        const eventIds = await inngest.send({
          name: "website/crawl.requested",
          data: {
            rootUrl: url,
            crawlDepth,
            maxPages,
            companyId: companyIdString,
            userId,
            category: documentCategory,
            title,
          },
        });

        console.log(
          `[IngestUrl] Multi-page crawl dispatched to Inngest: url=${url}`,
        );

        return NextResponse.json(
          {
            success: true,
            mode: "crawl",
            message: `Website crawl started (depth=${crawlDepth}, maxPages=${maxPages})`,
            eventIds: Array.isArray(eventIds) ? eventIds : [eventIds],
          },
          { status: 202 },
        );
      }

      const crawlResult = await crawlWebsite(url, {
        maxDepth: 0,
        maxPages: 1,
      });

      if (crawlResult.pages.length === 0) {
        const detail = crawlResult.errors.length > 0
          ? crawlResult.errors.join("; ")
          : "No content returned";
        console.warn(`[IngestUrl] Crawl returned 0 pages: ${detail}`);
        return NextResponse.json(
          { error: `Failed to fetch the page: ${detail}` },
          { status: 422 },
        );
      }

      const page = crawlResult.pages[0]!;
      const pageTitle = title || page.title || new URL(url).hostname;

      const htmlBuffer = Buffer.from(page.html, "utf-8");
      const blob = await putFile({
        filename: `website-${encodeURIComponent(url)}.html`,
        data: htmlBuffer,
        contentType: "text/html",
      });

      const [newDocument] = await db
        .insert(document)
        .values({
          url: blob.url,
          title: pageTitle,
          mimeType: "text/x-website",
          category: documentCategory,
          companyId,
          ocrEnabled: true,
          ocrProcessed: false,
          sourceArchiveName: url,
          ocrMetadata: { sourceUrl: url },
        } as typeof document.$inferInsert)
        .returning({
          id: document.id,
          url: document.url,
          title: document.title,
          category: document.category,
        });

      if (!newDocument) {
        throw new Error("Failed to create document record");
      }

      const { jobId, eventIds } = await triggerDocumentProcessing(
        blob.url,
        pageTitle,
        companyIdString,
        userId,
        newDocument.id,
        documentCategory,
        {
          mimeType: "text/x-website",
          originalFilename: `${pageTitle}.html`,
        },
      );

      await db.insert(ocrJobs).values({
        id: jobId,
        companyId,
        userId,
        status: "queued",
        documentUrl: blob.url,
        documentName: pageTitle,
      });

      console.log(
        `[IngestUrl] Single-page ingested: docId=${newDocument.id}, jobId=${jobId}`,
      );

      return NextResponse.json(
        {
          success: true,
          mode: "single",
          jobId,
          eventIds,
          message: "Website page processing started",
          document: newDocument,
        },
        { status: 202 },
      );
    } catch (error) {
      console.error("[IngestUrl] Error:", error);
      return NextResponse.json(
        {
          error: "Failed to ingest website",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 },
      );
    }
  });
}
