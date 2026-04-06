/**
 * Web Crawler Service
 *
 * Fetches and extracts content from websites. Supports single-page fetch
 * and multi-page crawling with same-domain link following.
 */

type CheerioAPI = ReturnType<typeof import("cheerio").load>;

function ensureFilePolyfill() {
  if (typeof globalThis.File === "undefined") {
    (globalThis as Record<string, unknown>).File = class File extends Blob {
      name: string;
      lastModified: number;
      constructor(parts: BlobPart[], name: string, opts?: FilePropertyBag) {
        super(parts, opts);
        this.name = name;
        this.lastModified = opts?.lastModified ?? Date.now();
      }
    };
  }
}

async function loadCheerio() {
  ensureFilePolyfill();
  return import("cheerio");
}

export interface CrawlOptions {
  /** Maximum link depth to follow (0 = single page, max 3). Default 0. */
  maxDepth?: number;
  /** Maximum number of pages to crawl. Default 10, max 50. */
  maxPages?: number;
  /** Request timeout in ms. Default 15000. */
  timeoutMs?: number;
}

export interface CrawledPage {
  url: string;
  title: string;
  html: string;
  depth: number;
}

export interface CrawlResult {
  pages: CrawledPage[];
  rootUrl: string;
  rootTitle: string;
  elapsedMs: number;
  errors: string[];
}

const MAX_DEPTH_LIMIT = 3;
const MAX_PAGES_LIMIT = 50;
const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; PDR-AI-Bot/1.0; +https://pdr-ai.com)";

const SKIP_EXTENSIONS = new Set([
  ".pdf", ".zip", ".tar", ".gz", ".rar",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
  ".mp3", ".mp4", ".avi", ".mov", ".wav",
  ".exe", ".dmg", ".deb", ".rpm",
  ".css", ".js", ".woff", ".woff2", ".ttf", ".eot",
]);

export async function crawlWebsite(
  rootUrl: string,
  options: CrawlOptions = {},
): Promise<CrawlResult> {
  const startTime = Date.now();
  const maxDepth = Math.min(options.maxDepth ?? 0, MAX_DEPTH_LIMIT);
  const maxPages = Math.min(options.maxPages ?? 10, MAX_PAGES_LIMIT);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const cheerioModule = await loadCheerio();

  const rootParsed = new URL(rootUrl);
  const origin = rootParsed.origin;

  const visited = new Set<string>();
  const pages: CrawledPage[] = [];
  const errors: string[] = [];

  const queue: Array<{ url: string; depth: number }> = [
    { url: normalizeUrl(rootUrl), depth: 0 },
  ];

  console.log(
    `[WebCrawler] Starting crawl: root=${rootUrl}, maxDepth=${maxDepth}, maxPages=${maxPages}`,
  );

  while (queue.length > 0 && pages.length < maxPages) {
    const item = queue.shift()!;
    const normalized = normalizeUrl(item.url);

    if (visited.has(normalized)) continue;
    visited.add(normalized);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(item.url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        errors.push(`${item.url}: HTTP ${response.status}`);
        continue;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("xhtml")) {
        continue;
      }

      const html = await response.text();
      const $ = cheerioModule.load(html);

      const title =
        $("title").first().text().trim() ||
        $('meta[property="og:title"]').attr("content")?.trim() ||
        normalized;

      pages.push({ url: item.url, title, html, depth: item.depth });
      console.log(
        `[WebCrawler] Fetched (${pages.length}/${maxPages}): ${item.url} [depth=${item.depth}]`,
      );

      if (item.depth < maxDepth) {
        const links = extractSameDomainLinks($, origin, item.url);
        for (const link of links) {
          const norm = normalizeUrl(link);
          if (!visited.has(norm) && !shouldSkipUrl(link)) {
            queue.push({ url: link, depth: item.depth + 1 });
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      errors.push(`${item.url}: ${msg}`);
      console.warn(`[WebCrawler] Error fetching ${item.url}: ${msg}`);
      if (stack) console.warn(`[WebCrawler] Stack: ${stack}`);
    }
  }

  const elapsedMs = Date.now() - startTime;
  console.log(
    `[WebCrawler] Done: ${pages.length} pages crawled, ${errors.length} errors (${elapsedMs}ms)`,
  );

  return {
    pages,
    rootUrl,
    rootTitle: pages[0]?.title ?? rootUrl,
    elapsedMs,
    errors,
  };
}

/**
 * Extract content from raw HTML, stripping boilerplate elements.
 * Returns clean text suitable for embedding.
 */
export async function extractPageContent(html: string): Promise<{
  title: string;
  text: string;
}> {
  const cheerio = await loadCheerio();
  const $ = cheerio.load(html);

  const title =
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    "";

  $("script, style, nav, footer, header, noscript, iframe, svg, aside").remove();
  $('[role="navigation"], [role="banner"], [role="contentinfo"]').remove();

  const text = $("body").text().replace(/\s+/g, " ").trim();
  return { title, text };
}

function extractSameDomainLinks(
  $: CheerioAPI,
  origin: string,
  currentUrl: string,
): string[] {
  const links: string[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    try {
      const resolved = new URL(href, currentUrl);
      if (resolved.origin !== origin) return;

      resolved.hash = "";
      const full = resolved.toString();
      if (!seen.has(full)) {
        seen.add(full);
        links.push(full);
      }
    } catch {
      // invalid URL, skip
    }
  });

  return links;
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    let path = parsed.pathname;
    if (path.endsWith("/") && path.length > 1) {
      path = path.slice(0, -1);
    }
    parsed.pathname = path;
    return parsed.toString();
  } catch {
    return url;
  }
}

function shouldSkipUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    const ext = path.includes(".") ? path.slice(path.lastIndexOf(".")) : "";
    return SKIP_EXTENSIONS.has(ext);
  } catch {
    return true;
  }
}
