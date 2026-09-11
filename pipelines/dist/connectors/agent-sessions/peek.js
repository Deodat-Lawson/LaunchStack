/**
 * Bounded metadata peek for the sessions browser.
 *
 * A browsable session list needs real titles and first-prompt previews for
 * hundreds of sessions, and a full parse of hundreds of megabytes is the wrong
 * price for that. The facts the list needs live in predictable places — both
 * dialects put `cwd` on the earliest records, Claude Code appends its title
 * records near the end of the file — so a bounded read of the head and tail of
 * each file recovers them. A peek is best-effort by contract: any miss (torn
 * lines, unreadable file, format drift) degrades to nulls, never to an error.
 */
import { open } from "node:fs/promises";
import { isHarnessUserText } from "./parse-claude.js";
import { extractCodexText } from "./parse-codex.js";
/** Head and tail window. Together at most 128 KiB of a file is read. */
export const PEEK_WINDOW_BYTES = 64 * 1024;
const PREVIEW_MAX_CHARS = 160;
const DEFAULT_PEEK_CONCURRENCY = 8;
const EMPTY_PEEK = { title: null, preview: null, projectPath: null, gitBranch: null };
function asRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value
        : null;
}
function asString(value) {
    return typeof value === "string" && value.length > 0 ? value : null;
}
function toPreview(text) {
    const line = text.split("\n")[0]?.replace(/\s+/g, " ").trim() ?? "";
    if (line.length === 0)
        return null;
    return line.length > PREVIEW_MAX_CHARS ? `${line.slice(0, PREVIEW_MAX_CHARS - 1)}…` : line;
}
/**
 * Read the first and last `PEEK_WINDOW_BYTES` of a file. A small file comes
 * back as one head window and no tail.
 */
async function readWindows(absolutePath) {
    let handle;
    try {
        handle = await open(absolutePath, "r");
    }
    catch {
        return null;
    }
    try {
        const { size } = await handle.stat();
        if (size <= PEEK_WINDOW_BYTES * 2) {
            const buffer = Buffer.alloc(size);
            await handle.read(buffer, 0, size, 0);
            return { head: buffer.toString("utf8"), tail: "" };
        }
        const headBuffer = Buffer.alloc(PEEK_WINDOW_BYTES);
        const tailBuffer = Buffer.alloc(PEEK_WINDOW_BYTES);
        await handle.read(headBuffer, 0, PEEK_WINDOW_BYTES, 0);
        await handle.read(tailBuffer, 0, PEEK_WINDOW_BYTES, size - PEEK_WINDOW_BYTES);
        return { head: headBuffer.toString("utf8"), tail: tailBuffer.toString("utf8") };
    }
    catch {
        return null;
    }
    finally {
        await handle.close().catch(() => undefined);
    }
}
/** Whole JSON lines in a window; the cut line at either edge is dropped. */
function windowLines(chunk, edge) {
    if (chunk.length === 0)
        return [];
    const lines = chunk.split("\n");
    if (edge === "head")
        lines.pop();
    else
        lines.shift();
    return lines.filter(line => line.trim().length > 0);
}
function parseLine(line) {
    try {
        return asRecord(JSON.parse(line));
    }
    catch {
        return null;
    }
}
/** First real user text in a Claude Code conversation record, if any. */
function claudeUserText(record) {
    if (record.isSidechain === true || record.isMeta === true)
        return null;
    const content = asRecord(record.message)?.content;
    if (typeof content === "string") {
        return isHarnessUserText(content) ? null : asString(content.trim());
    }
    if (!Array.isArray(content))
        return null;
    for (const block of content) {
        const blockRecord = asRecord(block);
        if (asString(blockRecord?.type) !== "text")
            continue;
        const text = asString(blockRecord?.text);
        if (text && !isHarnessUserText(text))
            return text.trim();
    }
    return null;
}
function peekClaude(head, tail) {
    let customTitle = null;
    let aiTitle = null;
    let preview = null;
    let projectPath = null;
    let gitBranch = null;
    // Title records are appended when a title is set, so the tail sees the
    // latest; scanning head first covers sessions short enough to have none.
    for (const line of [...windowLines(head, "head"), ...windowLines(tail, "tail")]) {
        const record = parseLine(line);
        if (!record)
            continue;
        const type = asString(record.type);
        if (type === "custom-title")
            customTitle = asString(record.customTitle) ?? customTitle;
        else if (type === "ai-title")
            aiTitle = asString(record.aiTitle) ?? aiTitle;
        else if (type === "user" || type === "assistant") {
            projectPath ??= asString(record.cwd);
            gitBranch ??= asString(record.gitBranch);
            if (type === "user" && preview === null) {
                const text = claudeUserText(record);
                if (text)
                    preview = toPreview(text);
            }
        }
    }
    return { title: customTitle ?? aiTitle, preview, projectPath, gitBranch };
}
function peekCodex(head) {
    let preview = null;
    let projectPath = null;
    for (const line of windowLines(head, "head")) {
        const record = parseLine(line);
        if (!record)
            continue;
        const type = asString(record.type);
        const payload = asRecord(record.payload) ?? {};
        if (type === "session_meta" || type === "turn_context") {
            projectPath ??= asString(payload.cwd);
        }
        else if (type === "response_item" && asString(payload.type) === "message") {
            if (preview === null && asString(payload.role) === "user") {
                const text = extractCodexText(payload.content).trim();
                if (text)
                    preview = toPreview(text);
            }
        }
        else if (type === "event_msg" && asString(payload.type) === "user_message") {
            if (preview === null) {
                const text = asString(payload.message)?.trim();
                if (text)
                    preview = toPreview(text);
            }
        }
        if (preview && projectPath)
            break;
    }
    // Codex titles live in ~/.codex/session_index.jsonl, joined in by the
    // caller; the rollout itself never carries one.
    return { title: null, preview, projectPath, gitBranch: null };
}
/** Peek one session file. Never throws. */
export async function peekSessionFile(absolutePath, tool) {
    const windows = await readWindows(absolutePath);
    if (!windows)
        return EMPTY_PEEK;
    return tool === "codex" ? peekCodex(windows.head) : peekClaude(windows.head, windows.tail);
}
/** Peek many discovered sessions with bounded concurrency, keyed by sourceId. */
export async function peekSessions(items, options = {}) {
    const peeks = new Map();
    const limit = Math.max(1, Math.min(options.concurrency ?? DEFAULT_PEEK_CONCURRENCY, items.length));
    let cursor = 0;
    const workers = Array.from({ length: limit }, async () => {
        while (true) {
            const index = cursor++;
            const item = items[index];
            if (!item)
                return;
            const tool = item.metadata.tool === "codex" ? "codex" : "claude-code";
            peeks.set(item.sourceId, await peekSessionFile(item.location.origin, tool));
        }
    });
    await Promise.all(workers);
    return peeks;
}
//# sourceMappingURL=peek.js.map