/**
 * ZIP archive self-extraction — moved from the web `process-document`
 * Inngest function (ADR-003). Each selected entry becomes its own source
 * document; `createDocumentLifecycle` enqueues that entry's
 * `source.version.created` event in the same transaction that creates its
 * rows, so the fan-out is durable per entry (the old version extracted all
 * 500 files inside one non-resumable Inngest step).
 *
 * Storage change vs the web original: extracted files and the project
 * summary go through the engine's StoragePort (the configured backend)
 * instead of unconditionally into Vercel Blob — the mixed-storage defect
 * flagged in the pipeline map.
 */
import path from "node:path";

import { eq } from "drizzle-orm";

import { getDb } from "../db";
import { document, ocrJobs } from "../db/schema";
import { getStoragePort } from "../storage";

import { createDocumentLifecycle } from "./source-lifecycle";

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

/** Files that should never be indexed — generated, build output, vendored */
const REPO_LOW_VALUE_PATTERNS = [
    /\bdist\//,
    /\bbuild\//,
    /\bout\//,
    /\b\.next\//,
    /\b\.nuxt\//,
    /\bcoverage\//,
    /\b\.turbo\//,
    /\b\.cache\//,
    /\b\.parcel-cache\//,
    /\.min\.(js|css)$/i,
    /\.map$/i,
    /\.bundle\.(js|css)$/i,
    /\.d\.ts$/i,
    /\.d\.mts$/i,
    /\b__snapshots__\//,
    /\bfixtures?\//i,
    /\b__fixtures__\//,
    /\b__mocks__\//,
    /\.snap$/,
    /\bvendor\//,
    /\bthird.?party\//i,
    /\bextern(al)?s?\//i,
    /\.yarn\//,
    /\.pnp\./,
    /\.(png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot|mp3|mp4|mov|avi)$/i,
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

function isLowValueFile(p: string): boolean {
    return REPO_LOW_VALUE_PATTERNS.some(re => re.test(p));
}

function fileRelevanceScore(p: string): number {
    if (REPO_HIGH_VALUE_PATTERNS.some(re => re.test(p))) return 0;
    return 1;
}

function selectRelevantFiles(
    paths: string[],
    limit: number
): { selected: string[]; totalBefore: number; skippedLowValue: number } {
    const totalBefore = paths.length;
    const afterLowValue = paths.filter(p => !isLowValueFile(p));
    const skippedLowValue = totalBefore - afterLowValue.length;

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

export function isZipFile(mimeType?: string, filename?: string): boolean {
    if (mimeType && ZIP_MIME_TYPES.has(mimeType)) return true;
    if (filename?.toLowerCase().endsWith(".zip")) return true;
    return false;
}

function canonicalizeZipEntry(entryPath: string): string {
    const forwardSlashPath = entryPath.replaceAll("\\", "/");

    if (path.posix.isAbsolute(forwardSlashPath) || path.win32.isAbsolute(forwardSlashPath)) {
        throw new Error(`[ArchiveExpansion] Invalid ZIP entry path (absolute): ${entryPath}`);
    }

    if (forwardSlashPath.split("/").some(segment => segment === "..")) {
        throw new Error(`[ArchiveExpansion] Invalid ZIP entry path (traversal): ${entryPath}`);
    }
    const normalizedPath = path.posix.normalize(forwardSlashPath);
    const canonicalPath = normalizedPath.replace(/\/+$/, "");
    if (canonicalPath === "." || canonicalPath === "") {
        throw new Error(`[ArchiveExpansion] Invalid ZIP entry path (empty): ${entryPath}`);
    }

    return canonicalPath;
}

function shouldSkipEntry(p: string): boolean {
    return ZIP_SKIP_PATTERNS.some(re => re.test(p));
}

function extractExtension(filename: string): string {
    const dot = filename.lastIndexOf(".");
    return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

function mimeFromExtension(ext: string): string | undefined {
    return EXTENSION_TO_MIME[ext.toLowerCase()];
}

const TEXT_FAST_PATH_MIMES = new Set([
    "text/plain",
    "text/markdown",
    "text/css",
    "text/xml",
    "text/javascript",
    "text/typescript",
    "text/jsx",
    "text/tsx",
    "text/csv",
    "text/html",
    "application/json",
]);

const TEXT_FAST_PATH_EXTENSIONS = new Set([
    ".txt",
    ".md",
    ".markdown",
    ".log",
    ".rst",
    ".adoc",
    ".py",
    ".js",
    ".ts",
    ".jsx",
    ".tsx",
    ".css",
    ".scss",
    ".less",
    ".java",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".go",
    ".rs",
    ".rb",
    ".php",
    ".swift",
    ".kt",
    ".sh",
    ".bash",
    ".sql",
    ".r",
    ".lua",
    ".pl",
    ".scala",
    ".xml",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".env",
    ".json",
    ".geojson",
    ".csv",
]);

const EXTENSIONLESS_TEXT_FILENAMES = new Set([
    "makefile",
    "dockerfile",
    "license",
    "licence",
    "readme",
    "gemfile",
    "procfile",
    "vagrantfile",
    "rakefile",
    "brewfile",
    "justfile",
    "taskfile",
]);

/** Text/code files skip OCR routing and go straight to the text adapter. */
export function isTextFastPathFile(mimeType?: string, filename?: string): boolean {
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
    for (const byte of sample) {
        if (byte === 0) nullCount++;
    }
    return nullCount === 0;
}

export interface ExpandArchiveInput {
    companyId: number;
    sourceId: number;
    ocrJobId: string;
    documentUrl: string;
    documentName: string;
    category: string;
    userId: string;
    archiveIdentity?: string;
    embeddingIndexKey?: string;
    traceId: string;
    /** Fetches the archive bytes — injected so web/worker share storage access. */
    fetchArchive: (url: string) => Promise<Response>;
}

export interface ExpandArchiveResult {
    /** Total documents created: indexed archive entries + project summary. */
    extracted: number;
    stats: {
        totalEntries: number;
        afterBasicFilter: number;
        skippedLowValue: number;
        /** Archive entries turned into documents (excludes the summary). */
        indexed: number;
    };
}

const MAX_EXTRACTED_FILES = 500;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB per file

/**
 * Extract a ZIP source into per-entry documents (each with its own
 * transactional lifecycle + outbox event), write a project summary, then
 * delete the original ZIP document and job. Idempotent: entry creation keys
 * are derived from the archive identity, so a replay converges on the same
 * rows and the delete of an already-deleted ZIP is a no-op.
 */
export async function expandArchive(input: ExpandArchiveInput): Promise<ExpandArchiveResult> {
    const routingName = input.documentName;
    // A present-but-blank identity is a producer bug: silently falling back
    // to the legacy key path would fork the idempotency keyspace across
    // retries (entries created under `archive:{sourceId}:...` keys would not
    // converge with a later replay carrying the real identity). Fail loudly;
    // only a genuinely absent identity takes the legacy path.
    if (input.archiveIdentity !== undefined && input.archiveIdentity.trim() === "") {
        throw new Error(
            `[ArchiveExpansion] archiveIdentity must not be blank (job ${input.ocrJobId})`
        );
    }
    const archiveIdentity = input.archiveIdentity ?? `archive:${input.sourceId}`;
    const useLegacyArchiveKeys = input.archiveIdentity === undefined;
    const storage = getStoragePort();

    const JSZip = (await import("jszip")).default;

    const res = await input.fetchArchive(input.documentUrl);
    if (!res.ok) {
        throw new Error(`Failed to fetch ZIP archive: ${res.status} ${res.statusText}`);
    }
    const zipBuffer = Buffer.from(await res.arrayBuffer());
    const zip = new JSZip();
    const interceptedZip = zip as unknown as {
        file: (...args: unknown[]) => unknown;
    };
    const originalFile = interceptedZip.file.bind(zip);
    const seenLoadedPaths = new Set<string>();
    interceptedZip.file = (...args: unknown[]) => {
        const [zipPath] = args;
        if (args.length > 1 && typeof zipPath === "string") {
            const canonicalPath = canonicalizeZipEntry(zipPath);
            if (seenLoadedPaths.has(canonicalPath)) {
                throw new Error(
                    `[ArchiveExpansion] Duplicate ZIP entry path after canonicalization: ${canonicalPath}`
                );
            }
            seenLoadedPaths.add(canonicalPath);
        }
        return originalFile(...args);
    };
    await zip.loadAsync(zipBuffer);
    const seenCanonicalPaths = new Set<string>();
    const canonicalEntries = Object.entries(zip.files).map(([zipPath, entry]) => {
        const canonicalPath = canonicalizeZipEntry(entry.unsafeOriginalName ?? zipPath);
        if (seenCanonicalPaths.has(canonicalPath)) {
            throw new Error(
                `[ArchiveExpansion] Duplicate ZIP entry path after canonicalization: ${canonicalPath}`
            );
        }
        seenCanonicalPaths.add(canonicalPath);
        return { canonicalPath, entry };
    });
    const zipEntriesByPath = new Map(
        canonicalEntries.map(({ canonicalPath, entry }) => [canonicalPath, entry] as const)
    );
    const allPaths = canonicalEntries.map(({ canonicalPath }) => canonicalPath);
    const entries = canonicalEntries
        .filter(({ canonicalPath, entry }) => !entry.dir && !shouldSkipEntry(canonicalPath))
        .map(({ canonicalPath }) => canonicalPath)
        .sort();
    const {
        selected: cappedEntries,
        totalBefore,
        skippedLowValue,
    } = selectRelevantFiles(entries, MAX_EXTRACTED_FILES);

    console.log(
        `[ArchiveExpansion] ZIP contains ${allPaths.length} entries, ` +
            `${totalBefore} after basic filter, ${skippedLowValue} skipped as low-value, ` +
            `${cappedEntries.length} selected for indexing`
    );

    const fileTree = entries.map(p => `  ${p}`).join("\n");
    let readmeContent = "";
    const readmePath = entries.find(p => {
        const name = path.posix.basename(p).toLowerCase();
        return (
            name === "readme.md" ||
            name === "readme" ||
            name === "readme.txt" ||
            name === "readme.rst"
        );
    });
    const readmeEntry = readmePath ? zipEntriesByPath.get(readmePath) : undefined;
    if (readmeEntry) {
        try {
            readmeContent = (await readmeEntry.async("string")).slice(0, 8000);
        } catch {
            /* ignore read errors */
        }
    }

    let indexed = 0;

    for (const entryPath of cappedEntries) {
        const entry = zipEntriesByPath.get(entryPath)!;
        const ext = extractExtension(entryPath);
        const baseName = path.posix.basename(entryPath);

        if (ext === ".zip") {
            console.log(`[ArchiveExpansion] Skipping nested ZIP: ${entryPath}`);
            continue;
        }

        const compressedSize =
            (entry as unknown as { _data?: { compressedSize?: number } })._data?.compressedSize ??
            0;
        if (compressedSize > MAX_FILE_SIZE_BYTES) {
            console.warn(`[ArchiveExpansion] Skipping oversized file: ${entryPath}`);
            continue;
        }

        const fileBuffer = Buffer.from(await entry.async("arraybuffer"));

        if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
            console.warn(`[ArchiveExpansion] Skipping oversized extracted file: ${entryPath}`);
            continue;
        }

        let fileMime = mimeFromExtension(ext);
        if (!fileMime && !ext) {
            const lowerBase = baseName.toLowerCase();
            if (EXTENSIONLESS_TEXT_FILENAMES.has(lowerBase) || sniffTextContent(fileBuffer)) {
                fileMime = "text/plain";
            }
        }

        const stored = await storage.upload({
            filename: baseName,
            data: fileBuffer,
            contentType: fileMime,
            userId: input.userId,
        });
        await createDocumentLifecycle({
            companyId: BigInt(input.companyId),
            userId: input.userId,
            title: baseName,
            category: input.category,
            url: stored.url,
            creationKey: useLegacyArchiveKeys
                ? `${archiveIdentity}:entry:${entryPath}`
                : JSON.stringify(["archive", archiveIdentity, "entry", entryPath]),
            processingUrl: stored.url,
            mimeType: fileMime ?? null,
            sourceArchiveName: routingName,
            sourceArchiveEntry: entryPath,
            traceId: input.traceId,
            processing: {
                originalFilename: baseName,
                embeddingIndexKey: input.embeddingIndexKey,
            },
        });
        indexed += 1;
    }

    // `indexed` counts archive entries only; `extracted` additionally counts
    // the project-summary document so callers see every document created.
    let extracted = indexed;

    if (indexed > 0) {
        const summaryText = [
            `# Project Summary: ${routingName}`,
            "",
            `**Indexing stats:** ${indexed} files indexed out of ${totalBefore} ` +
                `(${skippedLowValue} low-value files skipped: build output, generated code, assets)`,
            "",
            `## File Structure (${totalBefore} files)`,
            fileTree,
            "",
            ...(readmeContent ? ["## README", "", readmeContent] : []),
        ].join("\n");

        const summaryStored = await storage.upload({
            filename: `_summary_${routingName}.md`,
            data: Buffer.from(summaryText, "utf-8"),
            contentType: "text/markdown",
            userId: input.userId,
        });

        await createDocumentLifecycle({
            companyId: BigInt(input.companyId),
            userId: input.userId,
            title: `_project_summary.md`,
            category: input.category,
            url: summaryStored.url,
            creationKey: useLegacyArchiveKeys
                ? `${archiveIdentity}:summary`
                : JSON.stringify(["archive", archiveIdentity, "summary"]),
            processingUrl: summaryStored.url,
            mimeType: "text/markdown",
            sourceArchiveName: routingName,
            sourceArchiveEntry: null,
            traceId: input.traceId,
            processing: {
                originalFilename: `_project_summary.md`,
                embeddingIndexKey: input.embeddingIndexKey,
            },
        });
        extracted += 1;
    }

    const db = getDb();
    await db.delete(ocrJobs).where(eq(ocrJobs.id, input.ocrJobId));
    await db.delete(document).where(eq(document.id, input.sourceId));
    console.log(`[ArchiveExpansion] Deleted original ZIP document id=${input.sourceId}`);

    return {
        extracted,
        stats: {
            totalEntries: allPaths.length,
            afterBasicFilter: totalBefore,
            skippedLowValue,
            indexed,
        },
    };
}
