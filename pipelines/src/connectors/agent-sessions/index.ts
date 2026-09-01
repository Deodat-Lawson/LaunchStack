/**
 * agent-sessions connector — Claude Code and Codex session transcripts.
 *
 * The sibling of agent-knowledge that imports the one thing agent-knowledge
 * deliberately refuses: `~/.claude/projects/**.jsonl` and
 * `~/.codex/sessions/**.jsonl` conversation logs. Each session is parsed,
 * normalized and rendered to a Markdown transcript (thinking dropped, tool
 * output truncated, subagent sidechains skipped) before a host-supplied sink
 * pushes it through the normal ingestion pipeline.
 */

export {
    AGENT_SESSIONS_CONNECTOR_ID,
    DEFAULT_MAX_SESSION_FILE_BYTES,
    DEFAULT_MAX_SESSIONS,
    DEFAULT_QUIESCENCE_MS,
    buildSessionSourceId,
    scanAgentSessions,
    type AgentSessionsScan,
    type AgentSessionsScanOptions,
    type ScannedSessionRoot,
} from "./discover";

export {
    collectAgentSessions,
    loadCodexSessionIndex,
    readSessionItem,
    type CollectedAgentSessions,
    type SessionCollectContext,
} from "./collect";

export { parseClaudeSession } from "./parse-claude";
export { parseCodexSession } from "./parse-codex";
export {
    PEEK_WINDOW_BYTES,
    peekSessionFile,
    peekSessions,
    type SessionPeek,
} from "./peek";
export { renderSessionMarkdown, sessionDisplayTitle } from "./render";

export {
    syncAgentSessions,
    type AgentSessionsSyncOptions,
    type AgentSessionsSyncResult,
} from "./sync";

export {
    SESSION_TOOLS,
    TOOL_INPUT_MAX_CHARS,
    TOOL_RESULT_MAX_CHARS,
    sessionToolLabel,
    type DroppedCounts,
    type NormalizedSession,
    type SessionToolId,
    type TranscriptSegment,
} from "./types";
