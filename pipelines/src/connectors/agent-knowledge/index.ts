/**
 * agent-knowledge connector — Claude Code and Codex.
 *
 * Reads the knowledge those tools already keep on disk (instructions,
 * subagents, slash commands, skills, memories, prompts) and hands it to a
 * host-supplied sink for ingestion. No auth, no API, no polling: the source
 * is the local filesystem, so a sync is immediate.
 */

export {
    AGENT_KNOWLEDGE_CONNECTOR_ID,
    DEFAULT_MAX_FILE_BYTES,
    DEFAULT_MAX_ITEMS,
    buildSourceId,
    scanAgentKnowledge,
    type AgentKnowledgeScan,
    type AgentKnowledgeScanOptions,
    type ProjectTarget,
    type ScannedRoot,
} from "./discover";

export {
    collectAgentKnowledge,
    hashContent,
    readKnowledgeItem,
    type CollectedAgentKnowledge,
} from "./collect";

export {
    DEFAULT_SYNC_CONCURRENCY,
    syncAgentKnowledge,
    type AgentKnowledgeSyncOptions,
    type AgentKnowledgeSyncResult,
} from "./sync";

export {
    CLAUDE_CODE_LAYOUT,
    CODEX_LAYOUT,
    CONFIG_EXTENSIONS,
    DENIED_DIRECTORIES,
    DENIED_FILENAMES,
    KNOWLEDGE_EXTENSIONS,
    TOOL_LAYOUTS,
    isDeniedDirectory,
    isDeniedFilename,
    layoutFor,
    type AgentToolId,
    type KnowledgeKind,
    type KnowledgeScope,
    type LayoutEntry,
    type ToolLayout,
} from "./layout";
