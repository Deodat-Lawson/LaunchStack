/**
 * Inngest Website Crawl Function
 *
 * BFS crawl of a website: fetches pages, discovers same-domain links,
 * stores each page's HTML, and fans out document processing events.
 *
 * Architecture follows the ZIP extraction pattern in processDocument.ts:
 * - Each discovered page becomes its own document
 * - Pages are dispatched in batches of 10 with 2s delays
 * - The crawl tracks visited URLs to avoid duplicates
 */

import { inngest } from "../client";
import { uploadFile } from "~/lib/storage";
import { processDocumentUpload } from "~/server/services/document-upload";

const FETCH_TIMEOUT_MS = 30_000;
const MAX_HTML_BYTES = 10 * 1024 * 1024;
const CRAWL_DELAY_MS = 1_000;

const ASSET_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
  ".css", ".js", ".json", ".xml", ".zip", ".tar", ".gz",
  ".mp3", ".mp4", ".wav", ".avi", ".mov",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a URL for deduplication: strip trailing slashes, hash, query params.
 */
function normalizeUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    u.hash = "";
    u.search = "";
    // Normalize path: remove trailing slash (unless it's just "/")
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.href;
  } catch {
    return urlStr.replace(/\/+$/, "");
  }
}

function sanitizeForFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 80);
}

function deriveTitle(html: string, url: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const raw = match?.[1]?.trim();
  if (raw && raw.length > 0) {
    return raw.replace(/\s+/g, " ").slice(0, 200);
  }
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.replace(/\/+$/, "") || parsed.hostname;
  } catch {
    return url;
  }
}

async function fetchPage(
  url: string,
): Promise<{ html: string; finalUrl: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; PDR-AI-WebIndexer/1.0; +https://pdr.ai)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("html")) return null;

    const arrayBuf = await response.arrayBuffer();
    if (arrayBuf.byteLength > MAX_HTML_BYTES) return null;

    return {
      html: Buffer.from(arrayBuf).toString("utf-8"),
      finalUrl: response.url,
    };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

/**
 * Extract same-domain links from HTML.
 */
async function discoverLinks(html: string, pageUrl: string): Promise<string[]> {
  const cheerio = await import("cheerio");
  const $ = cheerio.load(html);
  const baseUrl = new URL(pageUrl);
  const seen = new Set<string>();

  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    try {
      const resolved = new URL(href, pageUrl);

      // Same domain only
      if (resolved.hostname !== baseUrl.hostname) return;

      // Skip non-http
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;

      const normalized = normalizeUrl(resolved.href);

      // Skip asset URLs
      const pathname = new URL(normalized).pathname;
      const lastDot = pathname.lastIndexOf(".");
      if (lastDot !== -1) {
        const ext = pathname.slice(lastDot).toLowerCase();
        if (ASSET_EXTENSIONS.has(ext)) return;
      }

      seen.add(normalized);
    } catch {
      // Invalid URL — skip
    }
  });

  return [...seen];
}

// ---------------------------------------------------------------------------
// Inngest Function
// ---------------------------------------------------------------------------

export const crawlWebsite = inngest.createFunction(
  {
    id: "crawl-website",
    name: "Website Crawl & Index",
    retries: 2,
    concurrency: [{ limit: 2 }],
    throttle: { limit: 5, period: "1m" },
    timeouts: { finish: "30m" },
    onFailure: async ({ error, event }) => {
      console.error(
        `[CrawlWebsite] Failed: crawlGroup=${event.data.event.data.crawlGroupId}, url=${event.data.event.data.url}`,
        error,
      );
    },
  },
  { event: "website/crawl.requested" },
  async ({ event, step }) => {
    const { url, userId, companyId, category, maxDepth, maxPages, crawlGroupId, requestUrl } =
      event.data;

    console.log(
      `[CrawlWebsite] Starting crawl: url=${url}, maxDepth=${maxDepth}, maxPages=${maxPages}, group=${crawlGroupId}`,
    );

    // ------------------------------------------------------------------
    // Step 1: BFS crawl — fetch pages and discover links
    // ------------------------------------------------------------------
    const crawlResult = await step.run("crawl-pages", async () => {
      const visited = new Set<string>();
      const startNormalized = normalizeUrl(url);
      visited.add(startNormalized);

      // BFS queue entries: { url, depth, parentUrl }
      interface QueueEntry {
        url: string;
        depth: number;
        parentUrl: string | null;
      }

      const queue: QueueEntry[] = [{ url, depth: 0, parentUrl: null }];
      const pages: {
        url: string;
        html: string;
        title: string;
        depth: number;
        parentUrl: string | null;
        discoveredLinks: number;
      }[] = [];

      let queueIdx = 0;
      while (queueIdx < queue.length && pages.length < maxPages) {
        const entry = queue[queueIdx]!;
        queueIdx++;

        // Polite delay (skip for first page)
        if (pages.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, CRAWL_DELAY_MS));
        }

        console.log(
          `[CrawlWebsite] Fetching page ${pages.length + 1}/${maxPages}: ${entry.url} (depth=${entry.depth})`,
        );

        const page = await fetchPage(entry.url);
        if (!page) {
          console.log(`[CrawlWebsite] Failed to fetch ${entry.url}, skipping`);
          continue;
        }

        // Deduplicate on final URL after redirects
        const finalNormalized = normalizeUrl(page.finalUrl);
        if (finalNormalized !== normalizeUrl(entry.url) && visited.has(finalNormalized)) {
          console.log(
            `[CrawlWebsite] ${entry.url} redirected to already-visited ${finalNormalized}, skipping`,
          );
          continue;
        }
        visited.add(finalNormalized);

        const pageTitle = deriveTitle(page.html, page.finalUrl);

        // Discover links for next depth level
        let discoveredLinks = 0;
        if (entry.depth < maxDepth) {
          const links = await discoverLinks(page.html, page.finalUrl);
          for (const link of links) {
            const normalized = normalizeUrl(link);
            if (!visited.has(normalized)) {
              visited.add(normalized);
              queue.push({ url: link, depth: entry.depth + 1, parentUrl: entry.url });
              discoveredLinks++;
            }
          }
        }

        pages.push({
          url: entry.url,
          html: page.html,
          title: pageTitle,
          depth: entry.depth,
          parentUrl: entry.parentUrl,
          discoveredLinks,
        });
      }

      console.log(
        `[CrawlWebsite] Crawl finished: ${pages.length} pages fetched, ${visited.size} URLs discovered`,
      );

      return { pages, totalDiscovered: visited.size };
    });

    // ------------------------------------------------------------------
    // Step 2: Store each page and trigger document processing
    // ------------------------------------------------------------------
    const storedPages = await step.run("store-pages", async () => {
      const results: {
        url: string;
        title: string;
        depth: number;
        parentUrl: string | null;
        documentId: number;
        jobId: string;
      }[] = [];

      for (const page of crawlResult.pages) {
        try {
          const parsedUrl = new URL(page.url);
          const filename = `${sanitizeForFilename(page.title) || "webpage"}.html`;

          // Inject <base> tag for relative URL resolution
          const baseTag = `<base href="${parsedUrl.origin}/">`;
          const enrichedHtml = /<head[^>]*>/i.test(page.html)
            ? page.html.replace(/(<head[^>]*>)/i, `$1${baseTag}`)
            : `${baseTag}${page.html}`;
          const htmlBuffer = Buffer.from(enrichedHtml, "utf-8");

          const uploaded = await uploadFile({
            filename,
            data: htmlBuffer,
            contentType: "text/html",
            userId,
          });

          const uploadResult = await processDocumentUpload({
            user: { userId, companyId: BigInt(companyId) },
            documentName: page.title,
            rawDocumentUrl: uploaded.url,
            requestUrl,
            category,
            explicitStorageType: uploaded.provider,
            mimeType: "text/html",
            originalFilename: filename,
            isWebsite: true,
            crawlGroupId,
          });

          results.push({
            url: page.url,
            title: page.title,
            depth: page.depth,
            parentUrl: page.parentUrl,
            documentId: uploadResult.document.id,
            jobId: uploadResult.jobId,
          });

          console.log(
            `[CrawlWebsite] Stored page: "${page.title}" (depth=${page.depth}, docId=${uploadResult.document.id})`,
          );
        } catch (error) {
          console.error(`[CrawlWebsite] Failed to store page ${page.url}:`, error);
        }
      }

      return results;
    });

    console.log(
      `[CrawlWebsite] Complete: ${storedPages.length} pages stored and queued for processing`,
    );

    return {
      success: true,
      crawlGroupId,
      pagesStored: storedPages.length,
      totalDiscovered: crawlResult.totalDiscovered,
      pages: storedPages,
    };
  },
);
