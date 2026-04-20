/**
 * Website Upload API Route
 *
 * Accepts a URL, fetches the page HTML, stores it via the unified storage
 * layer, and triggers the existing document processing pipeline.
 *
 * Modes:
 * - Single page (default): fetch one URL, store HTML, trigger pipeline
 * - Crawl mode (crawl=true): dispatches an Inngest crawl job that handles
 *   BFS link discovery and fans out each page through the standard pipeline
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { processDocumentUpload } from "~/server/services/document-upload";
import { uploadFile } from "~/lib/storage";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { inngest } from "~/server/inngest/client";

const WebsiteUploadSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  url: z.string().url("A valid URL is required"),
  title: z.string().optional(),
  category: z.string().optional(),
  crawl: z.boolean().optional(),
  maxDepth: z.number().min(1).max(3).optional(),
  maxPages: z.number().min(1).max(50).optional(),
  jsRender: z.boolean().optional(),
});

const MAX_HTML_BYTES = 10 * 1024 * 1024; // 10 MB cap
const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_PAGES = 20;

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

/**
 * Fetch a page with timeout and validation. Returns null on failure.
 */
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
 * Fetch a page using the sidecar's Crawl4AI endpoint for JS rendering.
 * Returns null if the sidecar is not configured or fails.
 */
async function fetchPageWithJsRender(
  url: string,
): Promise<{ html: string; finalUrl: string } | null> {
  const sidecarUrl = process.env.SIDECAR_URL;
  if (!sidecarUrl) {
    console.log("[WebsiteUpload] No SIDECAR_URL configured, skipping JS render");
    return null;
  }

  try {
    const response = await fetch(`${sidecarUrl}/crawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, max_pages: 1, js_render: true }),
      signal: AbortSignal.timeout(60_000),
    });
    if (response.ok) {
      const data = (await response.json()) as {
        pages?: { url: string; markdown: string }[];
      };
      const page = data.pages?.[0];
      if (page?.markdown) {
        return { html: page.markdown, finalUrl: page.url };
      }
    }
  } catch (error) {
    console.warn("[WebsiteUpload] Sidecar /crawl failed:", error);
  }

  return null;
}

export async function POST(request: Request) {
  return withRateLimit(request, RateLimitPresets.strict, async () => {
    try {
      const validation = await validateRequestBody(request, WebsiteUploadSchema);
      if (!validation.success) {
        return validation.response;
      }

      const { userId, url, title, category, crawl, maxDepth, maxPages, jsRender } =
        validation.data;

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
      }

      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return NextResponse.json(
          { error: "Only http(s) URLs are supported" },
          { status: 400 },
        );
      }

      const [userInfo] = await db
        .select()
        .from(users)
        .where(eq(users.userId, userId));

      if (!userInfo) {
        return NextResponse.json({ error: "Invalid user" }, { status: 400 });
      }

      // ------------------------------------------------------------------
      // Crawl mode: dispatch to Inngest and return immediately
      // ------------------------------------------------------------------
      if (crawl) {
        const crawlGroupId = `crawl-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;

        console.log(
          `[WebsiteUpload] Dispatching crawl: url=${url}, maxDepth=${maxDepth ?? DEFAULT_MAX_DEPTH}, ` +
            `maxPages=${maxPages ?? DEFAULT_MAX_PAGES}, group=${crawlGroupId}`,
        );

        const { ids } = await inngest.send({
          name: "website/crawl.requested",
          data: {
            url,
            userId,
            companyId: userInfo.companyId.toString(),
            category,
            maxDepth: maxDepth ?? DEFAULT_MAX_DEPTH,
            maxPages: maxPages ?? DEFAULT_MAX_PAGES,
            crawlGroupId,
            requestUrl: request.url,
          },
        });

        return NextResponse.json(
          {
            success: true,
            crawlGroupId,
            eventIds: ids,
            message: `Crawl started for ${parsedUrl.hostname} (up to ${maxPages ?? DEFAULT_MAX_PAGES} pages, depth ${maxDepth ?? DEFAULT_MAX_DEPTH})`,
            sourceUrl: url,
          },
          { status: 202 },
        );
      }

      // ------------------------------------------------------------------
      // Single-page mode
      // ------------------------------------------------------------------
      console.log(
        `[WebsiteUpload] Fetching: ${url}, user=${userId}, jsRender=${jsRender ?? false}`,
      );

      let page: { html: string; finalUrl: string } | null = null;
      let usedJsRender = false;

      if (jsRender) {
        page = await fetchPageWithJsRender(url);
        if (page) usedJsRender = true;
      }

      if (!page) {
        page = await fetchPage(url);
      }

      if (!page) {
        return NextResponse.json(
          { error: "Failed to fetch URL or URL did not return valid HTML" },
          { status: 502 },
        );
      }

      const resolvedTitle = title?.trim() || deriveTitle(page.html, url);
      const filename = `${sanitizeForFilename(resolvedTitle) || "webpage"}.html`;

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

      console.log(
        `[WebsiteUpload] Stored ${htmlBuffer.byteLength} bytes as ${filename} via ${uploaded.provider}`,
      );

      const uploadResult = await processDocumentUpload({
        user: {
          userId,
          companyId: userInfo.companyId,
        },
        documentName: resolvedTitle,
        rawDocumentUrl: uploaded.url,
        requestUrl: request.url,
        category,
        explicitStorageType: uploaded.provider,
        mimeType: "text/html",
        originalFilename: filename,
        isWebsite: true,
      });

      console.log(
        `[WebsiteUpload] Pipeline triggered: jobId=${uploadResult.jobId}, docId=${uploadResult.document.id}`,
      );

      return NextResponse.json(
        {
          success: true,
          jobId: uploadResult.jobId,
          eventIds: uploadResult.eventIds,
          message: `"${resolvedTitle}" is being indexed`,
          document: uploadResult.document,
          sourceUrl: url,
          jsRendered: usedJsRender,
        },
        { status: 202 },
      );
    } catch (error) {
      console.error("[WebsiteUpload] Error:", error);
      return NextResponse.json(
        {
          error: "Failed to index website",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 },
      );
    }
  });
}
