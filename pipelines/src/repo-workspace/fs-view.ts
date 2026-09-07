/**
 * WorkspaceView over a directory on disk — the read-only window stages C and
 * D get onto one commit's checkout (a git worktree).
 *
 * Safety properties, enforced here and nowhere else:
 * - never follows symlinks (lstat before every read),
 * - never exposes `.git` or escapes the root (paths are normalized and
 *   containment-checked),
 * - never returns binary content (NUL probe on the first 8 KiB),
 * - bounded work everywhere (file-count, size, and result caps).
 *
 * Search is a deterministic JS scan. `rg` would be faster on huge trees; the
 * port shape (`WorkspaceView.searchText`) is where a ripgrep-backed
 * implementation slots in without touching any caller (design §2.3).
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import type { SearchMatch, SearchOptions, WorkspaceFile, WorkspaceView } from "./types";

const MAX_FILES = 50_000;
const DEFAULT_MAX_READ_BYTES = 1024 * 1024;
const BINARY_PROBE_BYTES = 8 * 1024;
const MAX_SEARCH_RESULTS = 50;
const MAX_MATCH_TEXT_CHARS = 240;
const MAX_SEARCH_FILE_BYTES = 512 * 1024;

/** Directories never listed. `.git` is a hard rule; the rest are build
 * output that would drown the map and the search in noise. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
    ".git",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    "dist",
    "build",
    ".next",
    "target",
    ".cache",
]);

function isContained(root: string, candidate: string): boolean {
    const rel = path.relative(root, candidate);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function toPosix(p: string): string {
    return p.split(path.sep).join("/");
}

async function isBinary(filePath: string): Promise<boolean> {
    const handle = await fs.open(filePath, "r");
    try {
        const buffer = Buffer.alloc(BINARY_PROBE_BYTES);
        const { bytesRead } = await handle.read(buffer, 0, BINARY_PROBE_BYTES, 0);
        return buffer.subarray(0, bytesRead).includes(0);
    } finally {
        await handle.close();
    }
}

/** Suffix/prefix glob: `*.ts`, `src/*`, or a literal path. Anything more
 * elaborate is deliberately unsupported — callers get determinism, not power. */
export function matchesGlob(filePath: string, glob: string | undefined): boolean {
    if (!glob) return true;
    if (glob.startsWith("*")) return filePath.endsWith(glob.slice(1));
    if (glob.endsWith("*")) return filePath.startsWith(glob.slice(0, -1));
    return filePath === glob;
}

async function walk(root: string): Promise<WorkspaceFile[]> {
    const files: WorkspaceFile[] = [];
    const stack: string[] = [root];

    while (stack.length > 0) {
        const dir = stack.pop()!;
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        // Sorted so truncation at MAX_FILES is deterministic.
        entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const entry of entries) {
            const absolute = path.join(dir, entry.name);
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) {
                if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
                stack.push(absolute);
                continue;
            }
            if (!entry.isFile()) continue;
            if (files.length >= MAX_FILES) return files;
            let size = 0;
            try {
                size = (await fs.lstat(absolute)).size;
            } catch {
                continue;
            }
            files.push({ path: toPosix(path.relative(root, absolute)), size });
        }
    }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return files;
}

export function createDirectoryView(rootDir: string, sha: string): WorkspaceView {
    const root = path.resolve(rootDir);
    let listing: Promise<WorkspaceFile[]> | null = null;

    const listFiles = (): Promise<WorkspaceFile[]> => {
        listing ??= walk(root);
        return listing;
    };

    const readFile = async (relPath: string, maxBytes?: number): Promise<string | null> => {
        const limit = maxBytes ?? DEFAULT_MAX_READ_BYTES;
        if (relPath.includes("\0")) return null;
        const absolute = path.resolve(root, relPath);
        if (!isContained(root, absolute)) return null;
        let stat;
        try {
            stat = await fs.lstat(absolute);
        } catch {
            return null;
        }
        if (!stat.isFile() || stat.isSymbolicLink()) return null;
        if (stat.size > limit) return null;
        try {
            if (await isBinary(absolute)) return null;
            return await fs.readFile(absolute, "utf8");
        } catch {
            return null;
        }
    };

    const searchText = async (pattern: string, options?: SearchOptions): Promise<SearchMatch[]> => {
        const maxResults = Math.min(options?.maxResults ?? MAX_SEARCH_RESULTS, 200);
        if (pattern.length === 0 || pattern.length > 500) return [];

        let regex: RegExp;
        const flags = options?.caseSensitive ? "" : "i";
        try {
            regex = new RegExp(pattern, flags);
        } catch {
            // Invalid regex → literal-substring search.
            regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
        }

        const matches: SearchMatch[] = [];
        const files = await listFiles();
        for (const file of files) {
            if (matches.length >= maxResults) break;
            if (!matchesGlob(file.path, options?.glob)) continue;
            if (file.size > MAX_SEARCH_FILE_BYTES) continue;
            const content = await readFile(file.path, MAX_SEARCH_FILE_BYTES);
            if (content === null) continue;
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
                const line = lines[i]!;
                if (line.length > 5000) continue;
                if (regex.test(line)) {
                    matches.push({
                        path: file.path,
                        line: i + 1,
                        text: line.trim().slice(0, MAX_MATCH_TEXT_CHARS),
                    });
                }
            }
        }
        return matches;
    };

    return { sha, listFiles, readFile, searchText };
}
