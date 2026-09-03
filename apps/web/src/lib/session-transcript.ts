/**
 * Client-side parser for imported agent-session transcripts.
 *
 * The agent-sessions connector renders every session to a fixed Markdown
 * grammar (pipelines/src/connectors/agent-sessions/render.ts is the only
 * producer). This module is the read side of that grammar: it turns the
 * stored Markdown back into typed segments so the viewer can lay the
 * conversation out as a conversation, and the chat can seed a continuation
 * from the last turns. Anything the parser does not recognize stays inside
 * the surrounding text segment — a transcript that drifts from the grammar
 * degrades to prose, never to an error.
 */

/** Mirrors the connector's TranscriptSegment vocabulary, plus timestamps. */
export type TranscriptSegment =
    | { kind: "user"; text: string; at: string | null }
    | { kind: "assistant"; text: string }
    | { kind: "tool-call"; name: string; summary: string }
    | { kind: "tool-result"; text: string };

export interface ParsedSessionTranscript {
    title: string | null;
    /** Provenance blockquote lines under the title, `> ` stripped. */
    provenance: string[];
    segments: TranscriptSegment[];
}

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
const TOOL_CALL_RE = /^> → \*\*(.+?)\*\*(?: — `(.*)`)?\s*$/;

type DocumentLike = {
    ocrMetadata?: Record<string, unknown> | null;
};

/** True when a document row was written by the agent-sessions connector. */
export function isAgentSessionDocument(doc: DocumentLike | null | undefined): boolean {
    return doc?.ocrMetadata?.connector === "agent-sessions";
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

export function parseSessionTranscript(markdown: string): ParsedSessionTranscript {
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

    return { title, provenance, segments };
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

    const header = parsed.title ? `Continuing the imported session "${parsed.title}".` : null;
    return [header, ...parts].filter(Boolean).join("\n\n");
}
