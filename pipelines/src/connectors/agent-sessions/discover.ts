/**
 * Filesystem discovery for the agent-sessions connector.
 *
 * Session transcripts live in exactly two well-known layouts:
 *
 *   ~/.claude/projects/<slug>/<session-uuid>.jsonl
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl   (+ archived_sessions)
 *
 * Discovery is stat-only — nothing is opened here — and unlike the
 * agent-knowledge walk it is newest-first: the sessions worth having in a
 * knowledge base are the recent ones, so when `maxSessions` cuts a first bulk
 * import short it is the tail of history that waits for the next run.
 */

import type { Dirent } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { DiscoveredKnowledgeItem, SkippedKnowledgeItem } from "../types";
import { SESSION_TOOLS, sessionToolLabel, type SessionToolId } from "./types";

export const AGENT_SESSIONS_CONNECTOR_ID = "agent-sessions";

/**
 * 64 MiB. Session files run far larger than knowledge files (45 MB observed in
 * the wild); the cap exists to refuse the pathological, not the typical.
 */
export const DEFAULT_MAX_SESSION_FILE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_SESSIONS = 200;
/**
 * A file modified inside this window is still being written by a live session.
 * Reading it now is safe (JSONL parses line by line) but would mint a new
 * document version per prompt, so it waits for the next sync instead.
 */
export const DEFAULT_QUIESCENCE_MS = 5 * 60 * 1000;

const CLAUDE_SESSION_FILE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
const CODEX_SESSION_FILE =
    /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

export interface AgentSessionsScanOptions {
    /** Defaults to `os.homedir()`. */
    readonly homeDir?: string;
    /** Defaults to every known tool. */
    readonly tools?: readonly SessionToolId[];
    /**
     * Claude Code project-directory slugs to include (the directory names
     * under `~/.claude/projects`). Empty or absent means every project. Codex
     * sessions carry no project at discovery time and are unaffected.
     */
    readonly projects?: readonly string[];
    /** Include `~/.codex/archived_sessions`. On by default. */
    readonly includeArchived?: boolean;
    /**
     * Import exactly these sessions (`agent-sessions://…` ids from a previous
     * scan). Selection is an explicit user action on sessions already shown in
     * a browser, so the quiescence window does not apply — the parsers are
     * line-tolerant, and "import the session I am looking at" must not fail
     * because that session was active minutes ago.
     */
    readonly sourceIds?: readonly string[];
    readonly maxFileBytes?: number;
    readonly maxSessions?: number;
    readonly quiescenceMs?: number;
    /** Clock seam for deterministic tests. */
    readonly now?: () => Date;
}

export interface ScannedSessionRoot {
    readonly toolId: SessionToolId;
    readonly dir: string;
    readonly exists: boolean;
    /** Session files seen under this root, before caps and skips. */
    readonly sessionCount: number;
}

export interface AgentSessionsScan {
    readonly roots: readonly ScannedSessionRoot[];
    /** Newest first. */
    readonly items: readonly DiscoveredKnowledgeItem[];
    readonly skipped: readonly SkippedKnowledgeItem[];
    /** True when `maxSessions` cut the list short. */
    readonly truncated: boolean;
}

/**
 * `agent-sessions://<tool>/<session-uuid>`.
 *
 * Deliberately *not* including the project slug: the slug encodes the absolute
 * path of the checkout (`-Users-me-repo`), and the sourceId is the host's
 * idempotency key, which has to survive a home directory moving. The project
 * lives in metadata and in the rendered provenance header instead.
 */
export function buildSessionSourceId(toolId: SessionToolId, sessionUuid: string): string {
    return `${AGENT_SESSIONS_CONNECTOR_ID}://${toolId}/${sessionUuid.toLowerCase()}`;
}

interface SessionCandidate {
    readonly item: DiscoveredKnowledgeItem;
    readonly mtimeMs: number;
    readonly bytes: number;
}

function placeholderTitle(toolId: SessionToolId, sessionUuid: string): string {
    return `${sessionToolLabel(toolId)} session ${sessionUuid.slice(0, 8)}`;
}

function candidateFor(
    toolId: SessionToolId,
    sessionUuid: string,
    absolutePath: string,
    relativePath: string,
    stats: { size: number; mtime: Date },
    metadata: Record<string, unknown>
): SessionCandidate {
    return {
        mtimeMs: stats.mtime.getTime(),
        bytes: stats.size,
        item: {
            sourceId: buildSessionSourceId(toolId, sessionUuid),
            connectorId: AGENT_SESSIONS_CONNECTOR_ID,
            title: placeholderTitle(toolId, sessionUuid),
            kind: "session",
            // The stored artifact is the rendered Markdown transcript, and the
            // ingestion router picks its adapter from what the sink uploads.
            mimeType: "text/markdown",
            bytes: stats.size,
            modifiedAt: stats.mtime.toISOString(),
            location: {
                origin: absolutePath,
                relativePath: relativePath.split(path.sep).join("/"),
            },
            metadata: {
                tool: toolId,
                toolLabel: sessionToolLabel(toolId),
                sessionUuid: sessionUuid.toLowerCase(),
                kind: "session",
                ...metadata,
            },
        },
    };
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

async function safeReaddir(
    dir: string,
    skipped: SkippedKnowledgeItem[],
    sourceIdOnError: string
): Promise<Dirent[]> {
    try {
        return await readdir(dir, { withFileTypes: true });
    } catch (error) {
        if (!isMissing(error)) {
            skipped.push({
                sourceId: sourceIdOnError,
                reason: "unreadable",
                detail: describeError(error),
            });
        }
        return [];
    }
}

async function statFile(absolutePath: string): Promise<{ size: number; mtime: Date } | null> {
    try {
        const stats = await lstat(absolutePath);
        if (!stats.isFile() || stats.isSymbolicLink()) return null;
        return { size: stats.size, mtime: stats.mtime };
    } catch {
        return null;
    }
}

/** Guards against a `..` segment or a symlinked directory escaping the root. */
function isInsideRoot(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function collectClaudeCandidates(
    claudeRoot: string,
    projectFilter: ReadonlySet<string> | null,
    candidates: SessionCandidate[],
    skipped: SkippedKnowledgeItem[]
): Promise<number> {
    const projectsDir = path.join(claudeRoot, "projects");
    const slugs = await safeReaddir(
        projectsDir,
        skipped,
        buildSessionSourceId("claude-code", "projects-root")
    );

    let seen = 0;
    for (const slug of [...slugs].sort((a, b) => a.name.localeCompare(b.name))) {
        if (!slug.isDirectory() || slug.isSymbolicLink()) continue;
        if (projectFilter && !projectFilter.has(slug.name)) continue;

        const slugDir = path.join(projectsDir, slug.name);
        if (!isInsideRoot(claudeRoot, slugDir)) continue;

        const entries = await safeReaddir(
            slugDir,
            skipped,
            buildSessionSourceId("claude-code", slug.name)
        );
        for (const entry of entries) {
            if (!entry.isFile() || entry.isSymbolicLink()) continue;
            if (!CLAUDE_SESSION_FILE.test(entry.name)) continue;

            const absolutePath = path.join(slugDir, entry.name);
            const stats = await statFile(absolutePath);
            if (!stats) continue;

            seen += 1;
            candidates.push(
                candidateFor(
                    "claude-code",
                    entry.name.replace(/\.jsonl$/i, ""),
                    absolutePath,
                    path.relative(claudeRoot, absolutePath),
                    stats,
                    { projectSlug: slug.name }
                )
            );
        }
    }
    return seen;
}

async function collectCodexCandidates(
    codexRoot: string,
    dir: string,
    archived: boolean,
    candidates: SessionCandidate[],
    skipped: SkippedKnowledgeItem[]
): Promise<number> {
    const entries = await safeReaddir(dir, skipped, buildSessionSourceId("codex", "sessions-root"));

    let seen = 0;
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isSymbolicLink()) continue;
        const child = path.join(dir, entry.name);
        if (!isInsideRoot(codexRoot, child)) continue;

        if (entry.isDirectory()) {
            seen += await collectCodexCandidates(codexRoot, child, archived, candidates, skipped);
            continue;
        }
        if (!entry.isFile()) continue;

        const match = CODEX_SESSION_FILE.exec(entry.name);
        if (!match?.[1]) continue;

        const stats = await statFile(child);
        if (!stats) continue;

        seen += 1;
        candidates.push(
            candidateFor("codex", match[1], child, path.relative(codexRoot, child), stats, {
                archived,
            })
        );
    }
    return seen;
}

async function directoryExists(dir: string): Promise<boolean> {
    try {
        const stats = await lstat(dir);
        if (stats.isDirectory()) return true;
        if (!stats.isSymbolicLink()) return false;
        const resolved = await realpath(dir);
        return (await lstat(resolved)).isDirectory();
    } catch {
        return false;
    }
}

/**
 * Discover — but do not read — every finished session transcript on this
 * machine. `collectAgentSessions` is the step that opens, parses and renders.
 */
export async function scanAgentSessions(
    options: AgentSessionsScanOptions = {}
): Promise<AgentSessionsScan> {
    const home = options.homeDir ?? homedir();
    const tools = options.tools ?? SESSION_TOOLS;
    const includeArchived = options.includeArchived ?? true;
    const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_SESSION_FILE_BYTES;
    const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    const quiescenceMs = options.quiescenceMs ?? DEFAULT_QUIESCENCE_MS;
    const now = (options.now ?? (() => new Date()))().getTime();
    const projectFilter =
        options.projects && options.projects.length > 0 ? new Set(options.projects) : null;
    const sourceIdFilter =
        options.sourceIds && options.sourceIds.length > 0 ? new Set(options.sourceIds) : null;

    const candidates: SessionCandidate[] = [];
    const skipped: SkippedKnowledgeItem[] = [];
    const roots: ScannedSessionRoot[] = [];

    if (tools.includes("claude-code")) {
        const dir = path.join(home, ".claude");
        const exists = await directoryExists(path.join(dir, "projects"));
        const sessionCount = exists
            ? await collectClaudeCandidates(dir, projectFilter, candidates, skipped)
            : 0;
        roots.push({
            toolId: "claude-code",
            dir: path.join(dir, "projects"),
            exists,
            sessionCount,
        });
    }

    if (tools.includes("codex")) {
        const codexRoot = path.join(home, ".codex");
        const sessionDirs: { dir: string; archived: boolean }[] = [
            { dir: path.join(codexRoot, "sessions"), archived: false },
        ];
        if (includeArchived) {
            sessionDirs.push({ dir: path.join(codexRoot, "archived_sessions"), archived: true });
        }
        for (const target of sessionDirs) {
            const exists = await directoryExists(target.dir);
            const sessionCount = exists
                ? await collectCodexCandidates(
                      codexRoot,
                      target.dir,
                      target.archived,
                      candidates,
                      skipped
                  )
                : 0;
            roots.push({ toolId: "codex", dir: target.dir, exists, sessionCount });
        }
    }

    // Newest first, with the path as a deterministic tiebreak.
    candidates.sort(
        (a, b) =>
            b.mtimeMs - a.mtimeMs || a.item.location.origin.localeCompare(b.item.location.origin)
    );

    const items: DiscoveredKnowledgeItem[] = [];
    let truncated = false;

    for (const candidate of candidates) {
        const { item } = candidate;
        if (sourceIdFilter && !sourceIdFilter.has(item.sourceId)) continue;
        if (candidate.bytes === 0) {
            skipped.push({ sourceId: item.sourceId, reason: "empty" });
            continue;
        }
        if (candidate.bytes > maxFileBytes) {
            skipped.push({
                sourceId: item.sourceId,
                reason: "too-large",
                detail: `${candidate.bytes} bytes exceeds ${maxFileBytes}`,
            });
            continue;
        }
        if (!sourceIdFilter && now - candidate.mtimeMs < quiescenceMs) {
            skipped.push({
                sourceId: item.sourceId,
                reason: "active",
                detail: `modified ${item.modifiedAt}; session may still be running`,
            });
            continue;
        }
        if (items.length >= maxSessions) {
            truncated = true;
            skipped.push({
                sourceId: item.sourceId,
                reason: "limit-reached",
                detail: `maxSessions=${maxSessions}`,
            });
            continue;
        }
        items.push(item);
    }

    return { roots, items, skipped, truncated };
}
