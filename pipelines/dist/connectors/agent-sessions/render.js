/**
 * Markdown rendering of a normalized session.
 *
 * The rendered document is what gets chunked and embedded, so its structure is
 * retrieval-facing: `##` headings per speaker turn line up with the
 * heading-aware chunker, and the provenance header travels in the text itself —
 * retrieval sees chunks, not documents, so a chunk has to carry its own origin.
 */
import { sessionToolLabel } from "./types.js";
/**
 * Tool output can contain three-backtick runs of its own, so results are
 * fenced with four. Four-backtick runs inside a *truncated* tool result are
 * rare enough to accept.
 */
const RESULT_FENCE = "````";
function formatTimestamp(iso) {
    if (!iso)
        return null;
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
    return match ? `${match[1]} ${match[2]}` : iso;
}
function describeDropped(session) {
    const { thinking, sidechain, metadata, unknown, malformed } = session.dropped;
    const parts = [];
    if (thinking > 0)
        parts.push(`${thinking} thinking block${thinking === 1 ? "" : "s"}`);
    if (sidechain > 0)
        parts.push(`${sidechain} subagent record${sidechain === 1 ? "" : "s"}`);
    if (metadata > 0)
        parts.push(`${metadata} harness record${metadata === 1 ? "" : "s"}`);
    if (unknown > 0)
        parts.push(`${unknown} unrecognized record${unknown === 1 ? "" : "s"}`);
    if (malformed > 0)
        parts.push(`${malformed} malformed line${malformed === 1 ? "" : "s"}`);
    return parts.length > 0 ? parts.join(", ") : null;
}
export function sessionDisplayTitle(session, fallbackId) {
    if (session.title)
        return session.title;
    const firstUser = session.segments.find((segment) => segment.kind === "user");
    if (firstUser) {
        const line = firstUser.text.split("\n")[0]?.replace(/\s+/g, " ").trim() ?? "";
        if (line.length > 0)
            return line.length > 80 ? `${line.slice(0, 77)}…` : line;
    }
    return `${sessionToolLabel(session.tool)} session ${fallbackId.slice(0, 8)}`;
}
/**
 * The rendered text is what gets content-hashed for change detection, so
 * nothing sync-dependent (like a synced-at stamp) may appear in it — only
 * facts about the session itself. Sync timestamps live in the sink's metadata.
 */
export function renderSessionMarkdown(session, options) {
    const label = sessionToolLabel(session.tool);
    const lines = [`# ${options.title}`, ""];
    lines.push(`> Imported ${label} session${session.sessionId ? ` \`${session.sessionId}\`` : ""}.`);
    const where = [];
    if (session.projectPath)
        where.push(`project \`${session.projectPath}\``);
    if (session.gitBranch)
        where.push(`branch \`${session.gitBranch}\``);
    if (where.length > 0)
        lines.push(`> ${where.join(" · ")}.`);
    const started = formatTimestamp(session.startedAt ?? undefined);
    const ended = formatTimestamp(session.endedAt ?? undefined);
    if (started) {
        lines.push(`> ${started}${ended && ended !== started ? ` → ${ended}` : ""}.`);
    }
    const droppedNote = describeDropped(session);
    if (droppedNote)
        lines.push(`> Not imported: ${droppedNote}.`);
    lines.push("");
    let lastSpeaker = null;
    for (const segment of session.segments) {
        if (segment.kind === "user") {
            const at = formatTimestamp(segment.at);
            lines.push(`## User${at ? ` — ${at}` : ""}`, "", segment.text, "");
            lastSpeaker = "user";
        }
        else if (segment.kind === "assistant") {
            if (lastSpeaker !== "assistant")
                lines.push("## Assistant", "");
            lines.push(segment.text, "");
            lastSpeaker = "assistant";
        }
        else if (segment.kind === "tool-call") {
            const summary = segment.summary.length > 0 ? ` — \`${segment.summary}\`` : "";
            lines.push(`> → **${segment.name}**${summary}`, "");
        }
        else {
            lines.push(RESULT_FENCE, segment.text, RESULT_FENCE, "");
        }
    }
    return (lines
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trimEnd() + "\n");
}
//# sourceMappingURL=render.js.map