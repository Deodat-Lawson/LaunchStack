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
import { z } from "zod";

import { assertPublicHttpUrl, fetchPublicUrl, UrlGuardError } from "~/server/security/url-guard";
import { processDocumentUpload } from "~/server/services/document-upload";
import { uploadFile } from "~/lib/storage";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { inngest } from "~/server/inngest/client";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

const WebsiteUploadSchema = z.object({
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
    return value
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 80);
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
 *
 * Uses `fetchPublicUrl` so the SSRF guard is re-run on every redirect hop —
 * a public page 302ing into the metadata service or an internal host is
 * rejected mid-chain. Guard rejections are rethrown (not swallowed) so the
 * route can answer 400 instead of a generic fetch failure.
 */
async function fetchPage(url: string): Promise<{ html: string; finalUrl: string } | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetchPublicUrl(url, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (compatible; PDR-AI-WebIndexer/1.0; +https://pdr.ai)",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
    } catch (err) {
        clearTimeout(timeout);
        if (err instanceof UrlGuardError) throw err;
        return null;
    }
}

/**
 * JS-rendered fetching is currently unavailable. The old implementation
 * posted to ${SIDECAR_URL}/crawl — a route no service in this repository ever
 * implemented, so it could only fail and fall back (ADR-004 §5 removed the
 * phantom sidecar endpoints). Callers already treat null as "render without
 * JS"; a future crawling service can reintroduce this behind a real endpoint.
 */
async function fetchPageWithJsRender(
    _url: string
): Promise<{ html: string; finalUrl: string } | null> {
    console.log(
        "[WebsiteUpload] JS rendering skipped: no crawl service is implemented " +
            "(the sidecar /crawl endpoint never existed; ADR-004 §5)."
    );
    return null;
}

export async function POST(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    return withRateLimit(request, RateLimitPresets.strict, async () => {
        try {
            const validation = await validateRequestBody(request, WebsiteUploadSchema);
            if (!validation.success) {
                return validation.response;
            }

            const { url, title, category, crawl, maxDepth, maxPages, jsRender } =
                validation.data;

            // SSRF guard: http(s) only, and the host must resolve to a public
            // address. Guards both single-page fetch and the crawl seed (the
            // Inngest crawl job then only follows links from fetched pages).
            let parsedUrl: URL;
            try {
                parsedUrl = await assertPublicHttpUrl(url);
            } catch (err) {
                if (err instanceof UrlGuardError) {
                    return NextResponse.json({ error: err.message }, { status: 400 });
                }
                throw err;
            }
            const normalizedSourceUrl = new URL(parsedUrl);
            normalizedSourceUrl.hash = "";

            // ------------------------------------------------------------------
            // Crawl mode: dispatch to Inngest and return immediately
            // ------------------------------------------------------------------
            if (crawl) {
                const crawlGroupId = `crawl-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;

                console.log(
                    `[WebsiteUpload] Dispatching crawl: url=${url}, maxDepth=${maxDepth ?? DEFAULT_MAX_DEPTH}, ` +
                        `maxPages=${maxPages ?? DEFAULT_MAX_PAGES}, group=${crawlGroupId}`
                );

                const { ids } = await inngest.send({
                    name: "website/crawl.requested",
                    data: {
                        url,
                        userId: ctx.data.clerkUserId,
                        companyId: ctx.data.companyId.toString(),
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
                    { status: 202 }
                );
            }

            // ------------------------------------------------------------------
            // Single-page mode
            // ------------------------------------------------------------------
            console.log(
                `[WebsiteUpload] Fetching: ${url}, user=${ctx.data.clerkUserId}, jsRender=${jsRender ?? false}`
            );

            let page: { html: string; finalUrl: string } | null = null;
            let usedJsRender = false;

            if (jsRender) {
                page = await fetchPageWithJsRender(url);
                if (page) usedJsRender = true;
            }

            page ??= await fetchPage(url);

            if (!page) {
                return NextResponse.json(
                    { error: "Failed to fetch URL or URL did not return valid HTML" },
                    { status: 502 }
                );
            }

            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Empty trimmed titles must fall back.
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
                userId: ctx.data.clerkUserId,
                companyId: ctx.data.companyId,
            });

            console.log(
                `[WebsiteUpload] Stored ${htmlBuffer.byteLength} bytes as ${filename} via ${uploaded.provider}`
            );

            const uploadResult = await processDocumentUpload({
                user: {
                    userId: ctx.data.clerkUserId,
                    companyId: ctx.data.companyId,
                },
                documentName: resolvedTitle,
                rawDocumentUrl: uploaded.url,
                creationKey: `website:${normalizedSourceUrl.href}`,
                requestUrl: request.url,
                category,
                explicitStorageType: uploaded.provider,
                mimeType: "text/html",
                originalFilename: filename,
                isWebsite: true,
            });

            console.log(
                `[WebsiteUpload] Pipeline triggered: jobId=${uploadResult.jobId}, docId=${uploadResult.document.id}`
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
                { status: 202 }
            );
        } catch (error) {
            // A redirect chain that lands on a private/internal address (or any
            // other guard rejection surfaced mid-fetch) is a client-input
            // problem, not a server error.
            if (error instanceof UrlGuardError) {
                return NextResponse.json({ error: error.message }, { status: 400 });
            }
            console.error("[WebsiteUpload] Error:", error);
            return NextResponse.json(
                {
                    error: "Failed to index website",
                    details: error instanceof Error ? error.message : "Unknown error",
                },
                { status: 500 }
            );
        }
    });
}
