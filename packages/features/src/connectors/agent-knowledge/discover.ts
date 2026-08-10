/**
 * Filesystem discovery for the agent-knowledge connector.
 *
 * Walks only the locations named in `layout.ts`, never follows symlinks, and
 * refuses to leave the root it was pointed at. Everything it declines to read
 * comes back as a `SkippedKnowledgeItem` so the caller can show the user what
 * was left behind instead of silently under-reporting.
 */

import { lstat, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { DiscoveredKnowledgeItem, SkippedKnowledgeItem } from "../types";
import {
    CONFIG_EXTENSIONS,
    KNOWLEDGE_EXTENSIONS,
    TOOL_LAYOUTS,
    isDeniedDirectory,
    isDeniedFilename,
    layoutFor,
    type AgentToolId,
    type KnowledgeKind,
    type KnowledgeScope,
    type LayoutEntry,
    type ToolLayout,
} from "./layout";

export const AGENT_KNOWLEDGE_CONNECTOR_ID = "agent-knowledge";

/** 512 KiB — a knowledge file above this is a transcript, not instructions. */
export const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
export const DEFAULT_MAX_ITEMS = 500;

export interface ProjectTarget {
    /** Directory to scan for project-scoped agent knowledge. */
    readonly dir: string;
    /**
     * Stable identity for the project inside `sourceId`. Defaults to the
     * directory's basename. Pass an explicit key when two checkouts share a
     * basename, or when the same project may live at different paths.
     */
    readonly key?: string;
}

export interface AgentKnowledgeScanOptions {
    /** Defaults to `os.homedir()`. */
    readonly homeDir?: string;
    /** Project directories to scan. Empty means "global knowledge only". */
    readonly projects?: readonly (ProjectTarget | string)[];
    /** Defaults to every known tool. */
    readonly tools?: readonly AgentToolId[];
    /** Defaults to both scopes (project scope needs `projects`). */
    readonly scopes?: readonly KnowledgeScope[];
    /** Read `settings.json` / `config.toml`. Off by default — they hold keys. */
    readonly includeConfig?: boolean;
    readonly maxFileBytes?: number;
    readonly maxItems?: number;
}

export interface ScannedRoot {
    readonly toolId: AgentToolId;
    readonly scope: KnowledgeScope;
    readonly key: string;
    readonly dir: string;
    readonly exists: boolean;
    readonly itemCount: number;
}

export interface AgentKnowledgeScan {
    readonly roots: readonly ScannedRoot[];
    readonly items: readonly DiscoveredKnowledgeItem[];
    readonly skipped: readonly SkippedKnowledgeItem[];
    /** True when `maxItems` cut the walk short. */
    readonly truncated: boolean;
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".mdx": "text/markdown",
    ".txt": "text/plain",
    ".json": "application/json",
    ".toml": "text/x-toml",
    ".yaml": "text/x-yaml",
    ".yml": "text/x-yaml",
};

function mimeTypeFor(filePath: string): string {
    return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? "text/plain";
}

function normalizeProject(target: ProjectTarget | string): ProjectTarget {
    return typeof target === "string" ? { dir: target } : target;
}

function projectKeyFor(target: ProjectTarget): string {
    const explicit = target.key?.trim();
    if (explicit) return explicit;
    const base = path.basename(path.resolve(target.dir));
    return base.length > 0 ? base : "project";
}

/**
 * `agent-knowledge://<tool>/<scope-key>/<relative-path>`.
 *
 * Deliberately free of absolute paths: this string is the identity the host
 * keys its documents on, and it has to survive the home directory moving.
 */
export function buildSourceId(
    toolId: AgentToolId,
    scopeKey: string,
    relativePath: string
): string {
    const normalized = relativePath.split(path.sep).join("/");
    return `${AGENT_KNOWLEDGE_CONNECTOR_ID}://${toolId}/${scopeKey}/${normalized}`;
}

function titleFor(layout: ToolLayout, scopeKey: string, relativePath: string): string {
    const normalized = relativePath.split(path.sep).join("/");
    return `${layout.label} (${scopeKey}) — ${normalized}`;
}

function isReadableExtension(name: string, includeConfig: boolean): boolean {
    const ext = path.extname(name).toLowerCase();
    if (KNOWLEDGE_EXTENSIONS.has(ext)) return true;
    return includeConfig && CONFIG_EXTENSIONS.has(ext);
}

interface WalkContext {
    readonly layout: ToolLayout;
    readonly scope: KnowledgeScope;
    readonly scopeKey: string;
    readonly root: string;
    readonly includeConfig: boolean;
    readonly maxFileBytes: number;
    readonly maxItems: number;
    readonly items: DiscoveredKnowledgeItem[];
    readonly skipped: SkippedKnowledgeItem[];
    truncated: boolean;
}

/** Guards against a `..` segment or a symlinked directory escaping the root. */
function isInsideRoot(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function considerFile(
    ctx: WalkContext,
    absolutePath: string,
    kind: KnowledgeKind
): Promise<void> {
    const relativePath = path.relative(ctx.root, absolutePath);
    const sourceId = buildSourceId(ctx.layout.toolId, ctx.scopeKey, relativePath);
    const name = path.basename(absolutePath);

    if (isDeniedFilename(name)) {
        ctx.skipped.push({ sourceId, reason: "excluded", detail: "denylisted filename" });
        return;
    }
    if (!isReadableExtension(name, ctx.includeConfig)) {
        ctx.skipped.push({
            sourceId,
            reason: "excluded",
            detail: `unsupported extension ${path.extname(name) || "(none)"}`,
        });
        return;
    }

    let stats;
    try {
        stats = await lstat(absolutePath);
    } catch (error) {
        // Most layout entries are optional — a user with no `MEMORY.md` has
        // nothing wrong with their setup. Only a real read failure (EACCES and
        // friends) is worth reporting.
        if (isMissing(error)) return;
        ctx.skipped.push({ sourceId, reason: "unreadable", detail: describeError(error) });
        return;
    }

    if (stats.isSymbolicLink()) {
        ctx.skipped.push({ sourceId, reason: "excluded", detail: "symlink" });
        return;
    }
    if (!stats.isFile()) return;
    if (stats.size === 0) {
        ctx.skipped.push({ sourceId, reason: "empty" });
        return;
    }
    if (stats.size > ctx.maxFileBytes) {
        ctx.skipped.push({
            sourceId,
            reason: "too-large",
            detail: `${stats.size} bytes exceeds ${ctx.maxFileBytes}`,
        });
        return;
    }
    if (ctx.items.length >= ctx.maxItems) {
        ctx.truncated = true;
        ctx.skipped.push({ sourceId, reason: "limit-reached", detail: `maxItems=${ctx.maxItems}` });
        return;
    }

    ctx.items.push({
        sourceId,
        connectorId: AGENT_KNOWLEDGE_CONNECTOR_ID,
        title: titleFor(ctx.layout, ctx.scopeKey, relativePath),
        kind,
        mimeType: mimeTypeFor(absolutePath),
        bytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        location: { origin: absolutePath, relativePath: relativePath.split(path.sep).join("/") },
        metadata: {
            tool: ctx.layout.toolId,
            toolLabel: ctx.layout.label,
            scope: ctx.scope,
            scopeKey: ctx.scopeKey,
            kind,
        },
    });
}

async function walkDirectory(
    ctx: WalkContext,
    dir: string,
    kind: KnowledgeKind,
    recursive: boolean
): Promise<void> {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
        if (isMissing(error)) return;
        ctx.skipped.push({
            sourceId: buildSourceId(
                ctx.layout.toolId,
                ctx.scopeKey,
                path.relative(ctx.root, dir)
            ),
            reason: "unreadable",
            detail: describeError(error),
        });
        return;
    }

    // Sorted so a scan of the same tree always reports in the same order —
    // readdir order is filesystem-dependent and would make the truncation
    // cutoff (and every test asserting on it) nondeterministic.
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
        const child = path.join(dir, entry.name);
        if (!isInsideRoot(ctx.root, child)) continue;

        if (entry.isSymbolicLink()) {
            ctx.skipped.push({
                sourceId: buildSourceId(
                    ctx.layout.toolId,
                    ctx.scopeKey,
                    path.relative(ctx.root, child)
                ),
                reason: "excluded",
                detail: "symlink",
            });
            continue;
        }

        if (entry.isDirectory()) {
            if (!recursive || isDeniedDirectory(entry.name)) continue;
            await walkDirectory(ctx, child, kind, recursive);
            continue;
        }

        if (entry.isFile()) {
            await considerFile(ctx, child, kind);
        }
    }
}

async function scanEntry(ctx: WalkContext, entry: LayoutEntry): Promise<void> {
    if (entry.config && !ctx.includeConfig) return;

    const absolutePath = path.resolve(ctx.root, entry.path);
    if (!isInsideRoot(ctx.root, absolutePath)) return;

    if (entry.target === "file") {
        await considerFile(ctx, absolutePath, entry.kind);
        return;
    }

    if (entry.target === "nested") {
        await walkNested(ctx, absolutePath, entry);
        return;
    }

    await walkDirectory(ctx, absolutePath, entry.kind, entry.recursive ?? false);
}

/**
 * Walk `<dir>/<child>/<entry.nested>` for each immediate child directory.
 *
 * Used where a knowledge folder is buried one level inside a directory whose
 * other contents must stay untouched — `~/.claude/projects/<slug>/memory` next
 * to that slug's session transcripts.
 */
async function walkNested(ctx: WalkContext, dir: string, entry: LayoutEntry): Promise<void> {
    const nested = entry.nested;
    if (!nested) return;

    let children;
    try {
        children = await readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const child of [...children].sort((a, b) => a.name.localeCompare(b.name))) {
        if (!child.isDirectory() || child.isSymbolicLink()) continue;
        const target = path.join(dir, child.name, nested);
        if (!isInsideRoot(ctx.root, target)) continue;
        await walkDirectory(ctx, target, entry.kind, true);
    }
}

async function directoryExists(dir: string): Promise<boolean> {
    try {
        const stats = await lstat(dir);
        if (stats.isDirectory()) return true;
        if (!stats.isSymbolicLink()) return false;
        // A symlinked *root* is normal (`~/.claude` pointing at a dotfiles
        // repo). Resolving it once here is safe; the walk below still refuses
        // to follow any symlink found underneath.
        const resolved = await realpath(dir);
        return (await lstat(resolved)).isDirectory();
    } catch {
        return false;
    }
}

async function resolveRoot(dir: string): Promise<string> {
    try {
        return await realpath(dir);
    } catch {
        return path.resolve(dir);
    }
}

/**
 * Discover — but do not read — every knowledge file the configured tools
 * expose. Cheap enough to run on a page load; `collectAgentKnowledge` is the
 * step that actually opens files.
 */
export async function scanAgentKnowledge(
    options: AgentKnowledgeScanOptions = {}
): Promise<AgentKnowledgeScan> {
    const home = options.homeDir ?? homedir();
    const tools = options.tools ?? TOOL_LAYOUTS.map(layout => layout.toolId);
    const scopes = options.scopes ?? (["global", "project"] as const);
    const includeConfig = options.includeConfig ?? false;
    const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
    const projects = (options.projects ?? []).map(normalizeProject);

    const items: DiscoveredKnowledgeItem[] = [];
    const skipped: SkippedKnowledgeItem[] = [];
    const roots: ScannedRoot[] = [];
    let truncated = false;

    for (const toolId of tools) {
        const layout = layoutFor(toolId);

        const targets: { scope: KnowledgeScope; key: string; dir: string; entries: readonly LayoutEntry[] }[] = [];
        if (scopes.includes("global")) {
            targets.push({
                scope: "global",
                key: "global",
                dir: path.join(home, layout.globalRoot),
                entries: layout.globalEntries,
            });
        }
        if (scopes.includes("project")) {
            for (const project of projects) {
                targets.push({
                    scope: "project",
                    key: projectKeyFor(project),
                    dir: path.resolve(project.dir),
                    entries: layout.projectEntries,
                });
            }
        }

        for (const target of targets) {
            const exists = await directoryExists(target.dir);
            const before = items.length;
            if (exists) {
                const ctx: WalkContext = {
                    layout,
                    scope: target.scope,
                    scopeKey: target.key,
                    root: await resolveRoot(target.dir),
                    includeConfig,
                    maxFileBytes,
                    maxItems,
                    items,
                    skipped,
                    truncated: false,
                };
                for (const entry of target.entries) {
                    await scanEntry(ctx, entry);
                }
                truncated = truncated || ctx.truncated;
            }
            roots.push({
                toolId,
                scope: target.scope,
                key: target.key,
                dir: target.dir,
                exists,
                itemCount: items.length - before,
            });
        }
    }

    return { roots, items, skipped, truncated };
}

function isMissing(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
    );
}

export function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
