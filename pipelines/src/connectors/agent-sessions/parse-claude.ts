/**
 * Claude Code session parser.
 *
 * A session file is one JSON record per line. Conversation lines (`user` /
 * `assistant`) embed an API-shaped message whose content is either a plain
 * string or an array of typed blocks; everything else is harness bookkeeping.
 * The parser is line-tolerant — a torn trailing line from a live write, or a
 * record type added by next week's CLI, is counted and skipped, never fatal.
 */

import {
    TOOL_INPUT_MAX_CHARS,
    TOOL_RESULT_MAX_CHARS,
    truncateText,
    type NormalizedSession,
    type TranscriptSegment,
} from "./types";

/**
 * Record types that are known harness bookkeeping. Anything outside this set
 * and the conversation types is counted as `unknown` — the drift signal that
 * tells us the CLI's format moved ahead of this parser.
 */
const METADATA_RECORD_TYPES: ReadonlySet<string> = new Set([
    "attachment",
    "system",
    "summary",
    "queue-operation",
    "last-prompt",
    "atis-latch",
    "bridge-session",
    "frame-link",
    "mode",
    "artifact-autoreact-ledger",
    "artifact-comment-monitor",
    "file-history-snapshot",
    "file-history-delta",
    "compact-boundary",
    "todo",
    "permission-mode",
    "worktree-state",
    "pr-link",
    "agent-name",
    "relocated",
]);

/** Keys whose value makes a one-line summary of what a tool call did. */
const TOOL_INPUT_SUMMARY_KEYS: readonly string[] = [
    "command",
    "file_path",
    "path",
    "pattern",
    "query",
    "url",
    "prompt",
    "description",
    "skill",
];

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function asString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

export function summarizeToolInput(input: unknown): string {
    const record = asRecord(input);
    if (record) {
        for (const key of TOOL_INPUT_SUMMARY_KEYS) {
            const value = asString(record[key]);
            if (value) return truncateText(value.replace(/\s+/g, " ").trim(), TOOL_INPUT_MAX_CHARS);
        }
    }
    try {
        return truncateText(JSON.stringify(input) ?? "", TOOL_INPUT_MAX_CHARS);
    } catch {
        return "";
    }
}

/** tool_result content is a string or an array of typed blocks. */
export function extractToolResultText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    const parts: string[] = [];
    for (const block of content) {
        const record = asRecord(block);
        if (!record) continue;
        const text = asString(record.text);
        if (text) parts.push(text);
        else if (asString(record.type)) parts.push(`[${String(record.type)}]`);
    }
    return parts.join("\n");
}

/**
 * Slash-command echoes and hook output are injected into the user channel by
 * the harness; they read as bookkeeping, not as something the user said.
 */
export function isHarnessUserText(text: string): boolean {
    const trimmed = text.trimStart();
    return (
        trimmed.startsWith("<command-name>") ||
        trimmed.startsWith("<local-command-stdout>") ||
        trimmed.startsWith("<system-reminder>")
    );
}

export function parseClaudeSession(raw: string): NormalizedSession {
    const segments: TranscriptSegment[] = [];
    const dropped = { thinking: 0, sidechain: 0, metadata: 0, unknown: 0, malformed: 0 };

    let sessionId: string | null = null;
    let projectPath: string | null = null;
    let gitBranch: string | null = null;
    let customTitle: string | null = null;
    let aiTitle: string | null = null;
    let startedAt: string | null = null;
    let endedAt: string | null = null;

    for (const line of raw.split("\n")) {
        if (line.trim().length === 0) continue;

        let record: Record<string, unknown> | null;
        try {
            record = asRecord(JSON.parse(line));
        } catch {
            dropped.malformed += 1;
            continue;
        }
        if (!record) {
            dropped.malformed += 1;
            continue;
        }

        const type = asString(record.type);
        if (type === "custom-title") {
            customTitle = asString(record.customTitle) ?? customTitle;
            continue;
        }
        if (type === "ai-title") {
            aiTitle = asString(record.aiTitle) ?? aiTitle;
            continue;
        }
        if (type !== "user" && type !== "assistant") {
            if (type && METADATA_RECORD_TYPES.has(type)) dropped.metadata += 1;
            else dropped.unknown += 1;
            continue;
        }

        sessionId ??= asString(record.sessionId);
        projectPath ??= asString(record.cwd);
        gitBranch ??= asString(record.gitBranch);
        const at = asString(record.timestamp) ?? undefined;
        if (at) {
            startedAt ??= at;
            endedAt = at;
        }

        if (record.isSidechain === true) {
            dropped.sidechain += 1;
            continue;
        }
        if (record.isMeta === true) {
            dropped.metadata += 1;
            continue;
        }

        const message = asRecord(record.message);
        const content = message?.content;

        if (type === "user") {
            if (typeof content === "string") {
                if (isHarnessUserText(content)) dropped.metadata += 1;
                else if (content.trim().length > 0) {
                    segments.push({ kind: "user", text: content.trim(), at });
                }
                continue;
            }
            if (!Array.isArray(content)) {
                dropped.unknown += 1;
                continue;
            }
            const texts: string[] = [];
            for (const block of content) {
                const blockRecord = asRecord(block);
                const blockType = asString(blockRecord?.type);
                if (blockType === "text") {
                    const text = asString(blockRecord?.text);
                    if (text && !isHarnessUserText(text)) texts.push(text.trim());
                    else if (text) dropped.metadata += 1;
                } else if (blockType === "tool_result") {
                    const text = extractToolResultText(blockRecord?.content).trim();
                    if (text.length > 0) {
                        segments.push({
                            kind: "tool-result",
                            text: truncateText(text, TOOL_RESULT_MAX_CHARS),
                        });
                    }
                } else if (blockType === "image") {
                    dropped.metadata += 1;
                } else {
                    dropped.unknown += 1;
                }
            }
            const combined = texts.join("\n\n").trim();
            if (combined.length > 0) segments.push({ kind: "user", text: combined, at });
            continue;
        }

        // assistant
        if (!Array.isArray(content)) {
            dropped.unknown += 1;
            continue;
        }
        for (const block of content) {
            const blockRecord = asRecord(block);
            const blockType = asString(blockRecord?.type);
            if (blockType === "thinking" || blockType === "redacted_thinking") {
                dropped.thinking += 1;
            } else if (blockType === "text") {
                const text = asString(blockRecord?.text)?.trim();
                if (text) segments.push({ kind: "assistant", text, at });
            } else if (blockType === "tool_use") {
                segments.push({
                    kind: "tool-call",
                    name: asString(blockRecord?.name) ?? "tool",
                    summary: summarizeToolInput(blockRecord?.input),
                });
            } else {
                dropped.unknown += 1;
            }
        }
    }

    return {
        tool: "claude-code",
        sessionId,
        title: customTitle ?? aiTitle,
        projectPath,
        gitBranch,
        startedAt,
        endedAt,
        segments,
        dropped,
    };
}
