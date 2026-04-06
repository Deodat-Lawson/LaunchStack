/**
 * Inngest Website Crawl Function
 *
 * Crawls a website (single or multi-page), creates document rows for each page,
 * stores the HTML content in Vercel Blob, and dispatches document processing
 * events to the existing ingestion pipeline.
 */

import { inngest } from "../client";
import { db } from "~/server/db";
import { document, ocrJobs } from "~/server/db/schema";
import { putFile } from "~/server/storage/vercel-blob";
import { crawlWebsite } from "~/lib/ingestion/services/web-crawler";
import { triggerDocumentProcessing } from "~/lib/ocr/trigger";

export const crawlWebsiteJob = inngest.createFunction(
  {
    id: "crawl-website",
    name: "Crawl Website",
    concurrency: { limit: 5 },
    retries: 1,
  },
  { event: "website/crawl.requested" },
  async ({ event, step }) => {
    const {
      rootUrl,
      crawlDepth,
      maxPages,
      companyId,
      userId,
      category,
      title: customTitle,
    } = event.data;

    console.log(
      `[CrawlWebsite] Starting: url=${rootUrl}, depth=${crawlDepth}, maxPages=${maxPages}`,
    );

    const crawlResult = await step.run("crawl-pages", async () => {
      const result = await crawlWebsite(rootUrl, {
        maxDepth: crawlDepth,
        maxPages,
      });
      return {
        pageCount: result.pages.length,
        rootTitle: result.rootTitle,
        elapsedMs: result.elapsedMs,
        errors: result.errors,
        pages: result.pages.map((p) => ({
          url: p.url,
          title: p.title,
          htmlLength: p.html.length,
        })),
      };
    });

    if (crawlResult.pageCount === 0) {
      console.warn(`[CrawlWebsite] No pages crawled from ${rootUrl}`);
      return { success: false, error: "No pages could be crawled", documentIds: [] };
    }

    const fullCrawl = await crawlWebsite(rootUrl, {
      maxDepth: crawlDepth,
      maxPages,
    });

    const documentIds: number[] = [];

    for (let i = 0; i < fullCrawl.pages.length; i++) {
      const page = fullCrawl.pages[i]!;

      const docResult = await step.run(`ingest-page-${i}`, async () => {
        const pageTitle =
          i === 0 && customTitle
            ? customTitle
            : page.title || `Page from ${new URL(page.url).hostname}`;

        const htmlBuffer = Buffer.from(page.html, "utf-8");
        const blob = await putFile({
          filename: `website-${encodeURIComponent(page.url)}.html`,
          data: htmlBuffer,
          contentType: "text/html",
        });

        const companyIdBigInt = BigInt(companyId);
        const [newDocument] = await db
          .insert(document)
          .values({
            url: blob.url,
            title: pageTitle,
            mimeType: "text/x-website",
            category,
            companyId: companyIdBigInt,
            ocrEnabled: true,
            ocrProcessed: false,
            sourceArchiveName: rootUrl,
            ocrMetadata: {
              sourceUrl: page.url,
              crawlDepth: page.depth ?? 0,
              rootUrl,
            },
          } as typeof document.$inferInsert)
          .returning({ id: document.id });

        if (!newDocument) {
          throw new Error(`Failed to create document for ${page.url}`);
        }

        const { jobId } = await triggerDocumentProcessing(
          blob.url,
          pageTitle,
          companyId,
          userId,
          newDocument.id,
          category,
          {
            mimeType: "text/x-website",
            originalFilename: `${pageTitle}.html`,
          },
        );

        await db.insert(ocrJobs).values({
          id: jobId,
          companyId: companyIdBigInt,
          userId,
          status: "queued",
          documentUrl: blob.url,
          documentName: pageTitle,
        });

        return { documentId: newDocument.id, jobId };
      });

      documentIds.push(docResult.documentId);
    }

    console.log(
      `[CrawlWebsite] Done: ${documentIds.length} documents created from ${rootUrl}`,
    );

    return {
      success: true,
      documentIds,
      pagesCrawled: fullCrawl.pages.length,
      errors: fullCrawl.errors,
    };
  },
);
