/**
 * Reading half of the connector: opens a discovered session file, parses it
 * with the dialect parser for its tool, and renders the Markdown transcript
 * that becomes the stored `KnowledgeItem`.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { DiscoveredKnowledgeItem, KnowledgeItem, SkippedKnowledgeItem } from "../types";
import { describeError } from "./discover";
import { parseClaudeSession } from "./parse-claude";
import { parseCodexSession } from "./parse-codex";
import { renderSessionMarkdown, sessionDisplayTitle } from "./render";
import type { NormalizedSession, SessionToolId } from "./types";

export interface SessionCollectContext {
    /** Codex thread titles from `~/.codex/session_index.jsonl`, by session id. */
    readonly codexTitles?: ReadonlyMap<string, string>;
}

export interface CollectedAgentSessions {
    readonly items: readonly KnowledgeItem[];
    readonly skipped: readonly SkippedKnowledgeItem[];
}

export function hashContent(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex");
}

function metaString(item: DiscoveredKnowledgeItem, key: string): string | null {
    const value = item.metadata[key];
    return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Codex names its threads in a separate index file rather than in the rollout,
 * so titles are joined in from there. The index is small and append-only; the
 * last entry for an id wins.
 */
export async function loadCodexSessionIndex(homeDir: string): Promise<Map<string, string>> {
    const titles = new Map<string, string>();
    let raw: string;
    try {
        raw = await readFile(path.join(homeDir, ".codex", "session_index.jsonl"), "utf8");
    } catch {
        return titles;
    }
    for (const line of raw.split("\n")) {
        if (line.trim().length === 0) continue;
        try {
            const record = JSON.parse(line) as { id?: unknown; thread_name?: unknown };
            if (typeof record.id === "string" && typeof record.thread_name === "string") {
                titles.set(record.id.toLowerCase(), record.thread_name);
            }
        } catch {
            // A torn line in the index costs one title, nothing more.
        }
    }
    return titles;
}

export async function readSessionItem(
    item: DiscoveredKnowledgeItem,
    context: SessionCollectContext = {}
): Promise<KnowledgeItem | SkippedKnowledgeItem> {
    let raw: string;
    try {
        raw = await readFile(item.location.origin, "utf8");
    } catch (error) {
        return { sourceId: item.sourceId, reason: "unreadable", detail: describeError(error) };
    }

    const tool = metaString(item, "tool") as SessionToolId | null;
    const session: NormalizedSession =
        tool === "codex" ? parseCodexSession(raw) : parseClaudeSession(raw);

    if (session.segments.length === 0) {
        return {
            sourceId: item.sourceId,
            reason: "empty",
            detail: "no conversational content",
        };
    }

    const sessionUuid = metaString(item, "sessionUuid") ?? item.sourceId;
    const indexedTitle =
        tool === "codex"
            ? context.codexTitles?.get((session.sessionId ?? sessionUuid).toLowerCase())
            : undefined;
    const titled: NormalizedSession = indexedTitle ? { ...session, title: indexedTitle } : session;

    const title = sessionDisplayTitle(titled, sessionUuid);
    const content = renderSessionMarkdown(titled, { title });

    return {
        ...item,
        title,
        content,
        contentHash: hashContent(content),
        metadata: {
            ...item.metadata,
            sessionId: titled.sessionId ?? sessionUuid,
            projectPath: titled.projectPath,
            gitBranch: titled.gitBranch,
            startedAt: titled.startedAt,
            endedAt: titled.endedAt,
            segments: titled.segments.length,
            dropped: { ...titled.dropped },
        },
    };
}

function isSkipped(value: KnowledgeItem | SkippedKnowledgeItem): value is SkippedKnowledgeItem {
    return "reason" in value;
}

/** Read and render every discovered session, keeping failures as skips. */
export async function collectAgentSessions(
    discovered: readonly DiscoveredKnowledgeItem[],
    context: SessionCollectContext = {}
): Promise<CollectedAgentSessions> {
    const items: KnowledgeItem[] = [];
    const skipped: SkippedKnowledgeItem[] = [];

    for (const candidate of discovered) {
        const result = await readSessionItem(candidate, context);
        if (isSkipped(result)) skipped.push(result);
        else items.push(result);
    }

    return { items, skipped };
}
