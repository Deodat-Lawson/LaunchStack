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
export { AGENT_SESSIONS_CONNECTOR_ID, DEFAULT_MAX_SESSION_FILE_BYTES, DEFAULT_MAX_SESSIONS, DEFAULT_QUIESCENCE_MS, buildSessionSourceId, scanAgentSessions, } from "./discover.js";
export { collectAgentSessions, loadCodexSessionIndex, readSessionItem, } from "./collect.js";
export { parseClaudeSession } from "./parse-claude.js";
export { parseCodexSession } from "./parse-codex.js";
export { PEEK_WINDOW_BYTES, peekSessionFile, peekSessions } from "./peek.js";
export { renderSessionMarkdown, sessionDisplayTitle } from "./render.js";
export { syncAgentSessions, } from "./sync.js";
export { SESSION_TOOLS, TOOL_INPUT_MAX_CHARS, TOOL_RESULT_MAX_CHARS, sessionToolLabel, } from "./types.js";
//# sourceMappingURL=index.js.map