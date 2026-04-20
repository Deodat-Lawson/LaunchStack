/**
 * ZIP Archive Adapter
 *
 * Extracts files from a ZIP archive and routes each through the appropriate
 * ingestion adapter. Pages from all extracted files are merged into a single
 * StandardizedDocument with file-boundary markers.
 *
 * Skips macOS resource forks (__MACOSX), hidden dot-files, and files with no
 * matching adapter.  Uses JSZip which is already a project dependency.
 */

import type {
  SourceAdapter,
  SourceAdapterOptions,
  StandardizedDocument,
  StandardizedPage,
} from "@launchstack/core/ingestion/types";

const SKIP_PATTERNS = [
  /^__MACOSX\//,
  /\/\./,
  /^\./,
  /\.DS_Store$/,
  /Thumbs\.db$/i,
];

function shouldSkip(path: string): boolean {
  return SKIP_PATTERNS.some((re) => re.test(path));
}

function extractExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

const SKIP_ADAPTERS = new Set([
  "FallbackAdapter",
  "ZipAdapter",
  "ImageAdapter",
  "JsonExportAdapter",
]);


export class ZipAdapter implements SourceAdapter {
  readonly name = "ZipAdapter";

  private static readonly MIME_TYPES = new Set([
    "application/zip",
    "application/x-zip-compressed",
    "multipart/x-zip",
  ]);

  private static readonly EXTENSIONS = new Set([".zip"]);

  canHandle(mimeType: string, extension: string): boolean {
    return (
      ZipAdapter.MIME_TYPES.has(mimeType) ||
      ZipAdapter.EXTENSIONS.has(extension.toLowerCase())
    );
  }

  async process(
    input: string | Buffer,
    options?: SourceAdapterOptions,
  ): Promise<StandardizedDocument> {
    const startTime = Date.now();
    const archiveName = options?.filename ?? "archive.zip";
    console.log(`[ZipAdapter] Opening archive: ${archiveName}`);

    const JSZip = (await import("jszip")).default;
    const buffer = await this.resolveBuffer(input);
    const zip = await JSZip.loadAsync(buffer);

    const entries = Object.keys(zip.files)
      .filter((path) => !zip.files[path]!.dir && !shouldSkip(path))
      .sort();

    console.log(
      `[ZipAdapter] Archive contains ${Object.keys(zip.files).length} entries, ` +
        `${entries.length} processable files after filtering`,
    );

    const allPages: StandardizedPage[] = [];
    let processedCount = 0;
    let skippedCount = 0;

    for (const entryPath of entries) {
      const ext = extractExtension(entryPath);
      const baseName = entryPath.split("/").pop() ?? entryPath;

      // Lazy import to avoid circular dependency (index.ts imports ZipAdapter)
      const { findAdapter } = await import("./index");
      const adapter = findAdapter("", ext, baseName);

      if (!adapter || SKIP_ADAPTERS.has(adapter.name)) {
        skippedCount++;
        continue;
      }

      try {
        const fileBuffer = Buffer.from(
          await zip.files[entryPath]!.async("arraybuffer"),
        );

        console.log(
          `[ZipAdapter] Extracting ${entryPath} (${(fileBuffer.length / 1024).toFixed(1)}KB) → ${adapter.name}`,
        );

        const doc = await adapter.process(fileBuffer, {
          filename: baseName,
          mimeType: "",
        });

        const headerPage: StandardizedPage = {
          pageNumber: allPages.length + 1,
          textBlocks: [`--- File: ${entryPath} ---`],
          tables: [],
        };
        allPages.push(headerPage);

        for (const page of doc.pages) {
          allPages.push({
            ...page,
            pageNumber: allPages.length + 1,
          });
        }

        processedCount++;
      } catch (err) {
        console.warn(
          `[ZipAdapter] Failed to process ${entryPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
        allPages.push({
          pageNumber: allPages.length + 1,
          textBlocks: [`[Failed to extract: ${entryPath}]`],
          tables: [],
        });
      }
    }

    if (allPages.length === 0) {
      allPages.push({
        pageNumber: 1,
        textBlocks: [
          `Empty or unsupported archive — no processable files found in ${archiveName}.`,
        ],
        tables: [],
      });
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[ZipAdapter] Done: ${processedCount} files processed, ${skippedCount} skipped, ` +
        `${allPages.length} pages total (${elapsed}ms)`,
    );

    return {
      pages: allPages,
      metadata: {
        sourceType: "text",
        totalPages: allPages.length,
        provider: "native_text",
        processingTimeMs: elapsed,
        confidenceScore: processedCount > 0 ? 85 : 0,
        originalFilename: archiveName,
        mimeType: options?.mimeType ?? "application/zip",
      },
    };
  }

  private async resolveBuffer(input: string | Buffer): Promise<Buffer> {
    if (Buffer.isBuffer(input)) return input;

    const res = await fetch(input);
    if (!res.ok) {
      throw new Error(`ZipAdapter fetch failed: ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
