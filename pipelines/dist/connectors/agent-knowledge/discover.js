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
import { CONFIG_EXTENSIONS, KNOWLEDGE_EXTENSIONS, TOOL_LAYOUTS, isDeniedDirectory, isDeniedFilename, layoutFor, } from "./layout.js";
export const AGENT_KNOWLEDGE_CONNECTOR_ID = "agent-knowledge";
/** 512 KiB — a knowledge file above this is a transcript, not instructions. */
export const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
export const DEFAULT_MAX_ITEMS = 500;
const MIME_BY_EXTENSION = {
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".mdx": "text/markdown",
    ".txt": "text/plain",
    ".json": "application/json",
    ".toml": "text/x-toml",
    ".yaml": "text/x-yaml",
    ".yml": "text/x-yaml",
};
function mimeTypeFor(filePath) {
    return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? "text/plain";
}
function normalizeProject(target) {
    return typeof target === "string" ? { dir: target } : target;
}
function projectKeyFor(target) {
    const explicit = target.key?.trim();
    if (explicit)
        return explicit;
    const base = path.basename(path.resolve(target.dir));
    return base.length > 0 ? base : "project";
}
/**
 * `agent-knowledge://<tool>/<scope-key>/<relative-path>`.
 *
 * Deliberately free of absolute paths: this string is the identity the host
 * keys its documents on, and it has to survive the home directory moving.
 */
export function buildSourceId(toolId, scopeKey, relativePath) {
    const normalized = relativePath.split(path.sep).join("/");
    return `${AGENT_KNOWLEDGE_CONNECTOR_ID}://${toolId}/${scopeKey}/${normalized}`;
}
function titleFor(layout, scopeKey, relativePath) {
    const normalized = relativePath.split(path.sep).join("/");
    return `${layout.label} (${scopeKey}) — ${normalized}`;
}
function isReadableExtension(name, includeConfig) {
    const ext = path.extname(name).toLowerCase();
    if (KNOWLEDGE_EXTENSIONS.has(ext))
        return true;
    return includeConfig && CONFIG_EXTENSIONS.has(ext);
}
/** Guards against a `..` segment or a symlinked directory escaping the root. */
function isInsideRoot(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
async function considerFile(ctx, absolutePath, kind) {
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
    }
    catch (error) {
        // Most layout entries are optional — a user with no `MEMORY.md` has
        // nothing wrong with their setup. Only a real read failure (EACCES and
        // friends) is worth reporting.
        if (isMissing(error))
            return;
        ctx.skipped.push({ sourceId, reason: "unreadable", detail: describeError(error) });
        return;
    }
    if (stats.isSymbolicLink()) {
        ctx.skipped.push({ sourceId, reason: "excluded", detail: "symlink" });
        return;
    }
    if (!stats.isFile())
        return;
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
async function walkDirectory(ctx, dir, kind, recursive) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    }
    catch (error) {
        if (isMissing(error))
            return;
        ctx.skipped.push({
            sourceId: buildSourceId(ctx.layout.toolId, ctx.scopeKey, path.relative(ctx.root, dir)),
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
        if (!isInsideRoot(ctx.root, child))
            continue;
        if (entry.isSymbolicLink()) {
            ctx.skipped.push({
                sourceId: buildSourceId(ctx.layout.toolId, ctx.scopeKey, path.relative(ctx.root, child)),
                reason: "excluded",
                detail: "symlink",
            });
            continue;
        }
        if (entry.isDirectory()) {
            if (!recursive || isDeniedDirectory(entry.name))
                continue;
            await walkDirectory(ctx, child, kind, recursive);
            continue;
        }
        if (entry.isFile()) {
            await considerFile(ctx, child, kind);
        }
    }
}
async function scanEntry(ctx, entry) {
    if (entry.config && !ctx.includeConfig)
        return;
    const absolutePath = path.resolve(ctx.root, entry.path);
    if (!isInsideRoot(ctx.root, absolutePath))
        return;
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
async function walkNested(ctx, dir, entry) {
    const nested = entry.nested;
    if (!nested)
        return;
    let children;
    try {
        children = await readdir(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const child of [...children].sort((a, b) => a.name.localeCompare(b.name))) {
        if (!child.isDirectory() || child.isSymbolicLink())
            continue;
        const target = path.join(dir, child.name, nested);
        if (!isInsideRoot(ctx.root, target))
            continue;
        await walkDirectory(ctx, target, entry.kind, true);
    }
}
async function directoryExists(dir) {
    try {
        const stats = await lstat(dir);
        if (stats.isDirectory())
            return true;
        if (!stats.isSymbolicLink())
            return false;
        // A symlinked *root* is normal (`~/.claude` pointing at a dotfiles
        // repo). Resolving it once here is safe; the walk below still refuses
        // to follow any symlink found underneath.
        const resolved = await realpath(dir);
        return (await lstat(resolved)).isDirectory();
    }
    catch {
        return false;
    }
}
async function resolveRoot(dir) {
    try {
        return await realpath(dir);
    }
    catch {
        return path.resolve(dir);
    }
}
/**
 * Discover — but do not read — every knowledge file the configured tools
 * expose. Cheap enough to run on a page load; `collectAgentKnowledge` is the
 * step that actually opens files.
 */
export async function scanAgentKnowledge(options = {}) {
    const home = options.homeDir ?? homedir();
    const tools = options.tools ?? TOOL_LAYOUTS.map(layout => layout.toolId);
    const scopes = options.scopes ?? ["global", "project"];
    const includeConfig = options.includeConfig ?? false;
    const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
    const projects = (options.projects ?? []).map(normalizeProject);
    const items = [];
    const skipped = [];
    const roots = [];
    let truncated = false;
    for (const toolId of tools) {
        const layout = layoutFor(toolId);
        const targets = [];
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
                const ctx = {
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
function isMissing(error) {
    return (typeof error === "object" &&
        error !== null &&
        error.code === "ENOENT");
}
export function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=discover.js.map