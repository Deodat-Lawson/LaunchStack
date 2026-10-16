/**
 * Client-side parser for stored conversation transcripts.
 *
 * Two producers write conversations as Markdown in one shared grammar:
 *
 * - the agent-sessions connector (pipelines/src/connectors/agent-sessions/
 *   render.ts) — imported Claude Code / Codex sessions, with tool calls;
 * - assistant conversations saved over MCP (~/server/assistant-conversations/
 *   render.ts) — a Claude, ChatGPT or Gemini chat, user and assistant turns
 *   only. Its provenance line starts with "Saved from", its assistant
 *   headings carry a time like its user headings, and a message line that
 *   would read as a speaker heading is escaped with a leading backslash.
 *
 * This module is the read side of that grammar: it turns the stored Markdown
 * back into typed segments so the viewer can lay the conversation out as a
 * conversation, and the chat can seed a continuation from the last turns.
 * Anything the parser does not recognize stays inside the surrounding text
 * segment — a transcript that drifts from the grammar degrades to prose,
 * never to an error.
 */

/** Mirrors the connector's TranscriptSegment vocabulary, plus timestamps. */
export type TranscriptSegment =
    | { kind: "user"; text: string; at: string | null }
    /** `at` is only set for saved assistant conversations; agent sessions have none. */
    | { kind: "assistant"; text: string; at?: string | null }
    | { kind: "tool-call"; name: string; summary: string }
    | { kind: "tool-result"; text: string };

/** Which producer wrote a transcript; decides the few rules that differ. */
export type TranscriptFormat = "agent-session" | "assistant-conversation";

export interface ParsedSessionTranscript {
    title: string | null;
    /** Provenance blockquote lines under the title, `> ` stripped. */
    provenance: string[];
    segments: TranscriptSegment[];
    format: TranscriptFormat;
}

/** `ocrMetadata.connector` of an imported agent session. */
export const AGENT_SESSIONS_CONNECTOR = "agent-sessions";
/** `ocrMetadata.connector` of a conversation an assistant saved over MCP. */
export const ASSISTANT_CONVERSATIONS_CONNECTOR = "assistant-conversations";

/** The assistant families a saved conversation can come from (mirrors ASSISTANT_CLIENTS). */
export type AssistantFamily = "claude" | "chatgpt" | "gemini" | "other";

/** What the viewer, the provenance line and the follow-up note call each family. */
export const ASSISTANT_LABELS: Record<AssistantFamily, string> = {
    claude: "Claude",
    chatgpt: "ChatGPT",
    gemini: "Gemini",
    other: "Assistant",
};

export function isAssistantFamily(value: unknown): value is AssistantFamily {
    return typeof value === "string" && Object.hasOwn(ASSISTANT_LABELS, value);
}

/**
 * How a saved assistant conversation's provenance line begins. The renderer
 * writes it and the parser reads it, so a transcript fetched without its
 * document row (the chat's continue path) still parses in the right format.
 */
export const SAVED_CONVERSATION_PROVENANCE_PREFIX = "Saved from ";

/** Session facts the sink stores on the document row. All best-effort. */
export interface AgentSessionMeta {
    tool: "claude-code" | "codex" | null;
    sessionId: string | null;
    projectPath: string | null;
    gitBranch: string | null;
    startedAt: string | null;
    endedAt: string | null;
    dropped: Record<string, number> | null;
}

/** Tool results are fenced with four backticks (they may contain three). */
const RESULT_FENCE = "````";

const USER_HEADING_RE = /^## User(?: — (.+?))?\s*$/;
const ASSISTANT_HEADING_RE = /^## Assistant\s*$/;
/** Saved conversations time their assistant turns too. */
const TIMED_ASSISTANT_HEADING_RE = /^## Assistant(?: — (.+?))?\s*$/;
const TOOL_CALL_RE = /^> → \*\*(.+?)\*\*(?: — `(.*)`)?\s*$/;

type DocumentLike = {
    ocrMetadata?: Record<string, unknown> | null;
};

/** True when a document row was written by the agent-sessions connector. */
export function isAgentSessionDocument(doc: DocumentLike | null | undefined): boolean {
    return doc?.ocrMetadata?.connector === AGENT_SESSIONS_CONNECTOR;
}

/** True when an assistant saved this document over MCP (`save_conversation`). */
export function isAssistantConversationDocument(doc: DocumentLike | null | undefined): boolean {
    return doc?.ocrMetadata?.connector === ASSISTANT_CONVERSATIONS_CONNECTOR;
}

/** A connector marker whose documents read as conversations. */
export function isConversationConnector(connector: unknown): boolean {
    return (
        connector === AGENT_SESSIONS_CONNECTOR || connector === ASSISTANT_CONVERSATIONS_CONNECTOR
    );
}

/** True for any document the conversation viewer renders. */
export function isConversationDocument(doc: DocumentLike | null | undefined): boolean {
    return isConversationConnector(doc?.ocrMetadata?.connector);
}

function metaString(meta: Record<string, unknown>, key: string): string | null {
    const value = meta[key];
    return typeof value === "string" && value.length > 0 ? value : null;
}

/** Typed view of the session facts in `ocrMetadata`, for viewer headers. */
export function agentSessionMeta(doc: DocumentLike | null | undefined): AgentSessionMeta {
    const meta = doc?.ocrMetadata ?? {};
    const tool = meta.tool;
    const dropped = meta.dropped;
    return {
        tool: tool === "claude-code" || tool === "codex" ? tool : null,
        sessionId: metaString(meta, "sessionId"),
        projectPath: metaString(meta, "projectPath"),
        gitBranch: metaString(meta, "gitBranch"),
        startedAt: metaString(meta, "startedAt"),
        endedAt: metaString(meta, "endedAt"),
        dropped:
            typeof dropped === "object" && dropped !== null && !Array.isArray(dropped)
                ? (dropped as Record<string, number>)
                : null,
    };
}

/** Facts the save service stores on a saved conversation's document row. */
export interface AssistantConversationMeta {
    assistant: AssistantFamily | null;
    /** "Claude", "ChatGPT", "Gemini" or "Assistant". */
    label: string;
    /** The connection's own name, e.g. "Claude Code" or an access key's name. */
    clientName: string | null;
    model: string | null;
    savedAt: string | null;
    messageCount: number | null;
}

export function assistantConversationMeta(
    doc: DocumentLike | null | undefined
): AssistantConversationMeta {
    const meta = doc?.ocrMetadata ?? {};
    const assistant = isAssistantFamily(meta.assistant) ? meta.assistant : null;
    const count = meta.messageCount;
    return {
        assistant,
        label: ASSISTANT_LABELS[assistant ?? "other"],
        clientName: metaString(meta, "clientName"),
        model: metaString(meta, "model"),
        savedAt: metaString(meta, "savedAt"),
        messageCount: typeof count === "number" && Number.isFinite(count) ? count : null,
    };
}

function isConversationHeading(line: string): boolean {
    return USER_HEADING_RE.test(line) || TIMED_ASSISTANT_HEADING_RE.test(line);
}

/**
 * Escape one line of a saved conversation's message so it cannot read as a
 * speaker heading: a line that is a heading once any leading backslashes are
 * removed gains one more. Paired with {@link unescapeConversationLine}, which
 * removes exactly one, so every line survives the round trip unchanged —
 * including one that was already written as `\## User`.
 */
export function escapeConversationLine(line: string): string {
    return isConversationHeading(line.replace(/^\\+/, "")) ? `\\${line}` : line;
}

export function unescapeConversationLine(line: string): string {
    return line.startsWith("\\") && isConversationHeading(line.replace(/^\\+/, ""))
        ? line.slice(1)
        : line;
}

/**
 * Parse a stored transcript. The format is read from the provenance line
 * unless the caller already knows it from the document row.
 */
export function parseSessionTranscript(
    markdown: string,
    options: { format?: TranscriptFormat } = {}
): ParsedSessionTranscript {
    const lines = markdown.split("\n");
    const segments: TranscriptSegment[] = [];
    const provenance: string[] = [];

    let title: string | null = null;
    let index = 0;

    if (lines[index]?.startsWith("# ")) {
        title = lines[index]!.slice(2).trim() || null;
        index += 1;
    }

    // Provenance is the run of blockquote lines between the title and the
    // first speaker heading; blank lines inside the run are allowed.
    while (index < lines.length) {
        const line = lines[index]!;
        if (line.trim().length === 0) {
            index += 1;
            continue;
        }
        if (line.startsWith("> ") && !TOOL_CALL_RE.test(line)) {
            provenance.push(line.slice(2).trim());
            index += 1;
            continue;
        }
        break;
    }

    const format: TranscriptFormat =
        options.format ??
        (provenance[0]?.startsWith(SAVED_CONVERSATION_PROVENANCE_PREFIX)
            ? "assistant-conversation"
            : "agent-session");
    if (format === "assistant-conversation") {
        return { title, provenance, segments: parseConversationTurns(lines, index), format };
    }

    let mode: "user" | "assistant" | null = null;
    let userAt: string | null = null;
    let buffer: string[] = [];

    const flushText = () => {
        const text = buffer.join("\n").trim();
        buffer = [];
        if (text.length === 0 || mode === null) return;
        if (mode === "user") segments.push({ kind: "user", text, at: userAt });
        else segments.push({ kind: "assistant", text });
    };

    for (; index < lines.length; index += 1) {
        const line = lines[index]!;

        const userHeading = USER_HEADING_RE.exec(line);
        if (userHeading) {
            flushText();
            mode = "user";
            userAt = userHeading[1] ?? null;
            continue;
        }
        if (ASSISTANT_HEADING_RE.test(line)) {
            flushText();
            mode = "assistant";
            continue;
        }

        const toolCall = TOOL_CALL_RE.exec(line);
        if (toolCall) {
            flushText();
            segments.push({ kind: "tool-call", name: toolCall[1]!, summary: toolCall[2] ?? "" });
            continue;
        }

        if (line === RESULT_FENCE) {
            flushText();
            const result: string[] = [];
            index += 1;
            while (index < lines.length && lines[index] !== RESULT_FENCE) {
                result.push(lines[index]!);
                index += 1;
            }
            const text = result.join("\n").trim();
            if (text.length > 0) segments.push({ kind: "tool-result", text });
            continue;
        }

        buffer.push(line);
    }
    flushText();

    return { title, provenance, segments, format };
}

/**
 * The turns of a saved assistant conversation. Only the two speaker headings
 * are structure — there are no tool calls, so a message line that looks like
 * one (or like a result fence) is the message's own text — and every message
 * line is unescaped on the way out.
 */
function parseConversationTurns(lines: readonly string[], start: number): TranscriptSegment[] {
    const segments: TranscriptSegment[] = [];
    let mode: "user" | "assistant" | null = null;
    let at: string | null = null;
    let buffer: string[] = [];

    const flush = () => {
        const text = buffer.join("\n").trim();
        buffer = [];
        if (text.length === 0 || mode === null) return;
        segments.push(
            mode === "user" ? { kind: "user", text, at } : { kind: "assistant", text, at }
        );
    };

    for (let index = start; index < lines.length; index += 1) {
        const line = lines[index]!;
        const user = USER_HEADING_RE.exec(line);
        const assistant = user ? null : TIMED_ASSISTANT_HEADING_RE.exec(line);
        if (user || assistant) {
            flush();
            mode = user ? "user" : "assistant";
            at = (user ?? assistant)![1] ?? null;
            continue;
        }
        buffer.push(unescapeConversationLine(line));
    }
    flush();
    return segments;
}

/** Default budget for a continuation context seeded from a transcript. */
export const CONTINUATION_MAX_CHARS = 6000;
const CONTINUATION_SEGMENT_MAX_CHARS = 1200;

/**
 * The tail of the conversation as a compact "User: … / Assistant: …" block,
 * newest turns kept, sized for a prompt rather than a reader. Tool traffic is
 * folded into one-line notes — the transcript document itself is pinned as a
 * retrieval source, so the model can pull exact tool output from there.
 */
export function buildContinuationContext(
    parsed: ParsedSessionTranscript,
    options: { maxChars?: number } = {}
): string {
    const maxChars = options.maxChars ?? CONTINUATION_MAX_CHARS;
    const parts: string[] = [];
    let used = 0;

    for (let i = parsed.segments.length - 1; i >= 0; i -= 1) {
        const segment = parsed.segments[i]!;
        let line: string;
        if (segment.kind === "user") line = `User: ${segment.text}`;
        else if (segment.kind === "assistant") line = `Assistant: ${segment.text}`;
        else if (segment.kind === "tool-call") {
            line = `[ran ${segment.name}${segment.summary ? `: ${segment.summary}` : ""}]`;
        } else {
            continue; // tool results live in the pinned document
        }

        if (line.length > CONTINUATION_SEGMENT_MAX_CHARS) {
            line = `${line.slice(0, CONTINUATION_SEGMENT_MAX_CHARS)}…`;
        }
        if (used + line.length > maxChars) break;
        parts.unshift(line);
        used += line.length + 2;
    }

    const header = parsed.title
        ? parsed.format === "assistant-conversation"
            ? `Continuing the saved conversation "${parsed.title}".`
            : `Continuing the imported session "${parsed.title}".`
        : null;
    return [header, ...parts].filter(Boolean).join("\n\n");
}
