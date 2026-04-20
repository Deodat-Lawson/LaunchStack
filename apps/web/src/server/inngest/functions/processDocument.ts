/**
 * Inngest Document Processing Function
 * Background job handler that delegates to the backend Doc Ingestion tool.
 *
 * ZIP archives are detected early and self-extracted: each file inside the ZIP
 * becomes its own document row, gets stored individually in Vercel Blob, and
 * receives a separate ingestion event. The original ZIP document is deleted.
 */

import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { runDocIngestionTool } from "~/lib/tools";
import { db } from "~/server/db";
import { document, ocrJobs } from "@launchstack/core/db/schema";
import { putFile } from "~/server/storage/vercel-blob";
import { fetchFile } from "~/lib/storage";

import type {
  ProcessDocumentEventData,
  PipelineResult,
  VectorizedChunk,
} from "~/lib/ocr/types";

export type { ProcessDocumentEventData, PipelineResult, VectorizedChunk };

// ---------------------------------------------------------------------------
// ZIP detection & extraction helpers
// ---------------------------------------------------------------------------

const ZIP_MIME_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "multipart/x-zip",
]);

const ZIP_SKIP_PATTERNS = [
  /^__MACOSX\//,
  /\/\./,
  /^\./,
  /\.DS_Store$/,
  /Thumbs\.db$/i,
  /\.bin$/i,
  /\.sqlite3?$/i,
  /\.db$/i,
  /\.pyc$/i,
  /\.pyo$/i,
  /\.o$/,
  /\.so$/,
  /\.dll$/i,
  /\.dylib$/,
  /\.class$/,
  /\.wasm$/,
  /\.lock$/i,
  /node_modules\//,
  /__pycache__\//,
  /\.git\//,
  /\.venv\//,
  /chroma-collections$/,
  /chroma-embeddings$/,
];

// ---------------------------------------------------------------------------
// Smart relevance filtering for GitHub repos — skip low-value files that
// dilute the vector space without contributing useful retrieval results.
// ---------------------------------------------------------------------------

/** Files that should never be indexed — generated, build output, vendored */
const REPO_LOW_VALUE_PATTERNS = [
  // Build output & generated code
  /\bdist\//,
  /\bbuild\//,
  /\bout\//,
  /\b\.next\//,
  /\b\.nuxt\//,
  /\bcoverage\//,
  /\b\.turbo\//,
  /\b\.cache\//,
  /\b\.parcel-cache\//,
  // Minified & sourcemaps
  /\.min\.(js|css)$/i,
  /\.map$/i,
  /\.bundle\.(js|css)$/i,
  // TypeScript declarations (generated)
  /\.d\.ts$/i,
  /\.d\.mts$/i,
  // Test fixtures & snapshots
  /\b__snapshots__\//,
  /\bfixtures?\//i,
  /\b__fixtures__\//,
  /\b__mocks__\//,
  /\.snap$/,
  // Vendored dependencies
  /\bvendor\//,
  /\bthird.?party\//i,
  /\bextern(al)?s?\//i,
  // Package manager artifacts
  /\.yarn\//,
  /\.pnp\./,
  // Assets that don't contain searchable code
  /\.(png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot|mp3|mp4|mov|avi)$/i,
  // IDE & editor config
  /\.idea\//,
  /\.vscode\//,
  /\.editorconfig$/i,
];

/** Tier 1: High-value files — sorted first for indexing priority */
const REPO_HIGH_VALUE_PATTERNS = [
  /readme/i,
  /contributing/i,
  /changelog/i,
  /^src\//,
  /^lib\//,
  /^app\//,
  /^server\//,
  /^api\//,
  /^pages\//,
  /^components\//,
  /schema/i,
  /migrat/i,
  /route/i,
  /model/i,
  /service/i,
  /package\.json$/,
  /requirements\.txt$/,
  /go\.mod$/,
  /Cargo\.toml$/,
  /docker/i,
  /\.env\.example$/,
];

function isLowValueFile(path: string): boolean {
  return REPO_LOW_VALUE_PATTERNS.some((re) => re.test(path));
}

function fileRelevanceScore(path: string): number {
  if (REPO_HIGH_VALUE_PATTERNS.some((re) => re.test(path))) return 0; // highest priority
  return 1; // normal priority
}

/**
 * Filter and rank files by relevance, returning at most `limit` paths.
 * Skips low-value files first, then ranks remainder by relevance tier.
 */
function selectRelevantFiles(
  paths: string[],
  limit: number,
): { selected: string[]; totalBefore: number; skippedLowValue: number } {
  const totalBefore = paths.length;
  const afterLowValue = paths.filter((p) => !isLowValueFile(p));
  const skippedLowValue = totalBefore - afterLowValue.length;

  // Sort: high-value files first, then alphabetical within each tier
  afterLowValue.sort((a, b) => {
    const scoreA = fileRelevanceScore(a);
    const scoreB = fileRelevanceScore(b);
    if (scoreA !== scoreB) return scoreA - scoreB;
    return a.localeCompare(b);
  });

  return {
    selected: afterLowValue.slice(0, limit),
    totalBefore,
    skippedLowValue,
  };
}

const EXTENSION_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".csv": "text/csv",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ppt": "application/vnd.ms-powerpoint",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".html": "text/html",
  ".htm": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".bmp": "image/bmp",
  ".json": "application/json",
  ".xml": "text/plain",
  ".yaml": "text/plain",
  ".yml": "text/plain",
  ".toml": "text/plain",
  ".ini": "text/plain",
  ".cfg": "text/plain",
  ".env": "text/plain",
  ".log": "text/plain",
  ".rst": "text/plain",
  ".py": "text/plain",
  ".js": "text/plain",
  ".ts": "text/plain",
  ".jsx": "text/plain",
  ".tsx": "text/plain",
  ".css": "text/plain",
  ".scss": "text/plain",
  ".less": "text/plain",
  ".java": "text/plain",
  ".c": "text/plain",
  ".cpp": "text/plain",
  ".h": "text/plain",
  ".hpp": "text/plain",
  ".go": "text/plain",
  ".rs": "text/plain",
  ".rb": "text/plain",
  ".php": "text/plain",
  ".swift": "text/plain",
  ".kt": "text/plain",
  ".sh": "text/plain",
  ".bash": "text/plain",
  ".sql": "text/plain",
  ".r": "text/plain",
  ".lua": "text/plain",
  ".pl": "text/plain",
  ".scala": "text/plain",
  ".geojson": "application/json",
  ".raw": "text/plain",
  ".rels": "text/plain",
  ".dat": "text/plain",
};

function isZipFile(mimeType?: string, filename?: string): boolean {
  if (mimeType && ZIP_MIME_TYPES.has(mimeType)) return true;
  if (filename && filename.toLowerCase().endsWith(".zip")) return true;
  return false;
}

function shouldSkipEntry(path: string): boolean {
  return ZIP_SKIP_PATTERNS.some((re) => re.test(path));
}

function extractExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

function mimeFromExtension(ext: string): string | undefined {
  return EXTENSION_TO_MIME[ext.toLowerCase()];
}

interface ExtractedFileInfo {
  documentId: number;
  documentUrl: string;
  documentName: string;
  originalFilename: string;
  mimeType: string | undefined;
  jobId: string;
}

interface ZipExtractionResult {
  files: ExtractedFileInfo[];
  /** Full file tree (all paths after basic filtering) for the project summary */
  fileTree: string;
  /** README content extracted during the main pass (avoids re-downloading ZIP) */
  readmeContent: string;
  /** Stats for logging/user feedback */
  stats: {
    totalEntries: number;
    afterBasicFilter: number;
    skippedLowValue: number;
    indexed: number;
  };
}

const TEXT_FAST_PATH_MIMES = new Set([
  "text/plain", "text/markdown", "text/css", "text/xml",
  "text/javascript", "text/typescript", "text/jsx", "text/tsx",
  "text/csv", "text/html", "application/json",
]);

const TEXT_FAST_PATH_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".log", ".rst", ".adoc",
  ".py", ".js", ".ts", ".jsx", ".tsx", ".css", ".scss", ".less",
  ".java", ".c", ".cpp", ".h", ".hpp", ".go", ".rs", ".rb", ".php",
  ".swift", ".kt", ".sh", ".bash", ".sql", ".r", ".lua", ".pl", ".scala",
  ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".env",
  ".json", ".geojson", ".csv",
]);

const EXTENSIONLESS_TEXT_FILENAMES = new Set([
  "makefile", "dockerfile", "license", "licence", "readme",
  "gemfile", "procfile", "vagrantfile", "rakefile", "brewfile",
  "justfile", "taskfile",
]);

function isTextFastPathFile(mimeType?: string, filename?: string): boolean {
  if (mimeType && TEXT_FAST_PATH_MIMES.has(mimeType)) return true;
  if (filename) {
    const ext = extractExtension(filename);
    if (ext && TEXT_FAST_PATH_EXTENSIONS.has(ext)) return true;
    const base = filename.split("/").pop()?.toLowerCase() ?? "";
    if (EXTENSIONLESS_TEXT_FILENAMES.has(base)) return true;
  }
  return false;
}

function sniffTextContent(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 1024);
  let nullCount = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) nullCount++;
  }
  return nullCount === 0;
}

// ---------------------------------------------------------------------------
// Inngest Function
// ---------------------------------------------------------------------------

export const uploadDocument = inngest.createFunction(
  {
    id: "process-document",
    name: "Document Ingestion Pipeline (V2)",
    retries: 5,
    concurrency: [{ limit: 3 }],
    throttle: { limit: 30, period: "1m" },
    timeouts: { finish: "120m" },
    onFailure: async ({ error, event }) => {
      console.error(`[ProcessDocument] Pipeline failed for job ${JSON.stringify(event.data)}:`, error);

      const data = event.data?.event?.data as ProcessDocumentEventData | undefined;
      if (data?.documentId) {
        try {
          await db
            .update(document)
            .set({
              ocrProcessed: true,
              ocrMetadata: {
                error: "processing_failed",
                errorMessage: error instanceof Error ? error.message : String(error),
                failedAt: new Date().toISOString(),
              },
            })
            .where(eq(document.id, data.documentId));
          console.log(
            `[ProcessDocument] Marked document ${data.documentId} as failed`,
          );
        } catch (dbError) {
          console.error("[ProcessDocument] Could not mark document as failed:", dbError);
        }
      }
    },
  },
  { event: "document/process.requested" },
  async ({ event, step }) => {
    const eventData = event.data;
    const routingName = eventData.originalFilename ?? eventData.documentName;

    // ------------------------------------------------------------------
    // ZIP self-extraction: detect ZIP, extract files, fan out
    // ------------------------------------------------------------------
    if (isZipFile(eventData.mimeType, routingName)) {
      console.log(
        `[ProcessDocument] ZIP detected: "${routingName}", extracting files...`,
      );

      const MAX_EXTRACTED_FILES = 500;
      const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB per file

      const extraction = await step.run(
        "extract-zip-archive",
        async (): Promise<ZipExtractionResult> => {
          const JSZip = (await import("jszip")).default;

          const res = await fetchFile(eventData.documentUrl);
          if (!res.ok) {
            throw new Error(
              `Failed to fetch ZIP archive: ${res.status} ${res.statusText}`,
            );
          }
          const zipBuffer = Buffer.from(await res.arrayBuffer());
          const zip = await JSZip.loadAsync(zipBuffer);

          const allPaths = Object.keys(zip.files);
          const entries = allPaths
            .filter((p) => !zip.files[p]!.dir && !shouldSkipEntry(p))
            .sort();

          // Smart relevance filter: skip low-value files, prioritize high-value ones
          const { selected: cappedEntries, totalBefore, skippedLowValue } =
            selectRelevantFiles(entries, MAX_EXTRACTED_FILES);

          console.log(
            `[ProcessDocument] ZIP contains ${allPaths.length} entries, ` +
              `${totalBefore} after basic filter, ${skippedLowValue} skipped as low-value, ` +
              `${cappedEntries.length} selected for indexing`,
          );

          // Build file tree + extract README in same pass (avoids re-downloading ZIP later)
          const fileTree = entries.map((p) => `  ${p}`).join("\n");
          let readmeContent = "";
          const readmePath = entries.find((p) => {
            const name = p.split("/").pop()?.toLowerCase() ?? "";
            return name === "readme.md" || name === "readme" || name === "readme.txt" || name === "readme.rst";
          });
          if (readmePath) {
            try {
              readmeContent = (await zip.files[readmePath]!.async("string")).slice(0, 8000);
            } catch { /* ignore read errors */ }
          }

          const archiveName = routingName;
          const results: ExtractedFileInfo[] = [];

          for (const entryPath of cappedEntries) {
            const ext = extractExtension(entryPath);
            const baseName = entryPath.split("/").pop() ?? entryPath;
            const titleName = baseName;

            if (ext === ".zip") {
              console.log(`[ProcessDocument] Skipping nested ZIP: ${entryPath}`);
              continue;
            }

            try {
              const entry = zip.files[entryPath]!;
              const compressedSize = (entry as unknown as { _data?: { compressedSize?: number } })._data?.compressedSize ?? 0;
              if (compressedSize > MAX_FILE_SIZE_BYTES) {
                console.warn(
                  `[ProcessDocument] Skipping oversized file: ${entryPath} (${(compressedSize / 1024 / 1024).toFixed(1)}MB)`,
                );
                continue;
              }

              const fileBuffer = Buffer.from(
                await entry.async("arraybuffer"),
              );

              if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
                console.warn(
                  `[ProcessDocument] Skipping oversized extracted file: ${entryPath} (${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB)`,
                );
                continue;
              }

              let fileMime = mimeFromExtension(ext);
              if (!fileMime && !ext) {
                const lowerBase = baseName.toLowerCase();
                if (EXTENSIONLESS_TEXT_FILENAMES.has(lowerBase) || sniffTextContent(fileBuffer)) {
                  fileMime = "text/plain";
                }
              }

              console.log(
                `[ProcessDocument] Storing extracted file: ${entryPath} (${(fileBuffer.length / 1024).toFixed(1)}KB, mime=${fileMime ?? "unknown"})`,
              );

              const blob = await putFile({
                filename: baseName,
                data: fileBuffer,
                contentType: fileMime,
              });
              const [newDoc] = await db
                .insert(document)
                .values({
                  url: blob.url,
                  title: titleName,
                  mimeType: fileMime ?? null,
                  category: eventData.category,
                  companyId: BigInt(eventData.companyId),
                  ocrEnabled: true,
                  ocrProcessed: false,
                  sourceArchiveName: archiveName,
                })
                .returning({
                  id: document.id,
                  url: document.url,
                  title: document.title,
                });

              if (newDoc) {
                const childJobId = `ocr-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;

                await db.insert(ocrJobs).values({
                  id: childJobId,
                  companyId: BigInt(eventData.companyId),
                  userId: eventData.userId,
                  status: "queued",
                  documentUrl: blob.url,
                  documentName: titleName,
                });

                results.push({
                  documentId: newDoc.id,
                  documentUrl: blob.url,
                  documentName: titleName,
                  originalFilename: baseName,
                  mimeType: fileMime,
                  jobId: childJobId,
                });
              }
            } catch (err) {
              console.warn(
                `[ProcessDocument] Failed to extract ${entryPath}: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }

          console.log(
            `[ProcessDocument] Extracted ${results.length} files from ${archiveName}`,
          );
          return {
            files: results,
            fileTree,
            readmeContent,
            stats: {
              totalEntries: allPaths.length,
              afterBasicFilter: totalBefore,
              skippedLowValue,
              indexed: results.length,
            },
          };
        },
      );

      const extractedFiles = extraction.files;

      // ----------------------------------------------------------------
      // Generate a project summary chunk from file tree + README content
      // ----------------------------------------------------------------
      if (extractedFiles.length > 0) {
        await step.run("generate-project-summary", async () => {
          const archiveName = routingName;
          const { fileTree, readmeContent, stats } = extraction;

          const summaryText = [
            `# Project Summary: ${archiveName}`,
            "",
            `**Indexing stats:** ${stats.indexed} files indexed out of ${stats.afterBasicFilter} ` +
              `(${stats.skippedLowValue} low-value files skipped: build output, generated code, assets)`,
            "",
            `## File Structure (${stats.afterBasicFilter} files)`,
            fileTree,
            "",
            ...(readmeContent
              ? ["## README", "", readmeContent]
              : []),
          ].join("\n");

          const summaryBlob = await putFile({
            filename: `_summary_${archiveName}.md`,
            data: Buffer.from(summaryText, "utf-8"),
            contentType: "text/markdown",
          });

          const summaryJobId = `ocr-${Date.now().toString(36)}-summary`;

          const [summaryDoc] = await db
            .insert(document)
            .values({
              url: summaryBlob.url,
              title: `_project_summary.md`,
              mimeType: "text/markdown",
              category: eventData.category,
              companyId: BigInt(eventData.companyId),
              ocrEnabled: true,
              ocrProcessed: false,
              sourceArchiveName: archiveName,
            })
            .returning({ id: document.id });

          if (summaryDoc) {
            await db.insert(ocrJobs).values({
              id: summaryJobId,
              companyId: BigInt(eventData.companyId),
              userId: eventData.userId,
              status: "queued",
              documentUrl: summaryBlob.url,
              documentName: `_project_summary.md`,
            });

            extractedFiles.push({
              documentId: summaryDoc.id,
              documentUrl: summaryBlob.url,
              documentName: `_project_summary.md`,
              originalFilename: `_project_summary.md`,
              mimeType: "text/markdown",
              jobId: summaryJobId,
            });

            console.log(
              `[ProcessDocument] Generated project summary for ${archiveName} (${summaryText.length} chars)`,
            );
          }
        });
      }

      const FAN_OUT_BATCH_SIZE = 10;
      if (extractedFiles.length > 0) {
        for (let i = 0; i < extractedFiles.length; i += FAN_OUT_BATCH_SIZE) {
          const batch = extractedFiles.slice(i, i + FAN_OUT_BATCH_SIZE);
          await step.sendEvent(
            `fan-out-batch-${i}`,
            batch.map((f) => ({
              name: "document/process.requested" as const,
              data: {
                jobId: f.jobId,
                documentUrl: f.documentUrl,
                documentName: f.documentName,
                originalFilename: f.originalFilename,
                companyId: eventData.companyId,
                userId: eventData.userId,
                documentId: f.documentId,
                category: eventData.category,
                mimeType: f.mimeType,
                options: {
                  embeddingIndexKey: eventData.options?.embeddingIndexKey,
                },
              },
            })),
          );
          if (i + FAN_OUT_BATCH_SIZE < extractedFiles.length) {
            await step.sleep(`fan-out-delay-${i}`, "2s");
          }
        }
      }

      await step.run("delete-zip-document", async () => {
        await db
          .delete(ocrJobs)
          .where(eq(ocrJobs.id, eventData.jobId));
        await db
          .delete(document)
          .where(eq(document.id, eventData.documentId));
        console.log(
          `[ProcessDocument] Deleted original ZIP document id=${eventData.documentId}`,
        );
      });

      return {
        success: true,
        jobId: eventData.jobId,
        extracted: extractedFiles.length,
        stats: extraction.stats,
      };
    }

    // ------------------------------------------------------------------
    // Fast path: text/code files skip the full OCR pipeline
    // ------------------------------------------------------------------
    if (isTextFastPathFile(eventData.mimeType, routingName)) {
      console.log(
        `[ProcessDocument] Text fast-path for "${routingName}" (mime=${eventData.mimeType ?? "none"})`,
      );

      const result = await runDocIngestionTool({
        ...eventData,
        runtime: {
          updateJobStatus: false,
          markFailureInDb: false,
          fastTextPath: true,
          runStep: async <T>(stepName: string, fn: () => Promise<T>) =>
            step.run(stepName, fn) as Promise<T>,
        },
      });

      if (result.success && eventData.documentId && eventData.companyId) {
        await step.sendEvent("trigger-metadata-extraction", {
          name: "company-metadata/extract.requested" as const,
          data: {
            documentId: eventData.documentId,
            companyId: String(eventData.companyId),
          },
        });
      }

      return result;
    }

    // ------------------------------------------------------------------
    // Normal (non-ZIP) document processing
    // ------------------------------------------------------------------
    const result = await runDocIngestionTool({
      ...eventData,
      runtime: {
        updateJobStatus: false,
        markFailureInDb: false,
        runStep: async <T>(stepName: string, fn: () => Promise<T>) =>
          step.run(stepName, fn) as Promise<T>,
      },
    });

    if (result.success && eventData.documentId && eventData.companyId) {
      await step.sendEvent("trigger-metadata-extraction", {
        name: "company-metadata/extract.requested" as const,
        data: {
          documentId: eventData.documentId,
          companyId: String(eventData.companyId),
        },
      });
    }

    return result;
  },
);
