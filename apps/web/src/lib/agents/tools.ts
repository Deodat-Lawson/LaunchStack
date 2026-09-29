/**
 * The tool list — every capability an agent can be given, declared once.
 *
 * Hermes, OpenCode and T3 Code all model an agent's reach as a list of named
 * tools it may call; the agent's definition says which of them it gets.
 * Launchstack's tools are the capabilities the chat turn already has, so the
 * registry is small today, but it is the one place a new tool is added: an
 * entry here, and the route that honours it. Everything else — the editor's
 * checklist, the definition file, the badges, the policy resolver — reads
 * this list.
 *
 * An agent stores either `null` (every tool, including ones added after the
 * agent was written) or the exact list of tool ids it may use.
 */

export type AgentToolSurface = "chat" | "meeting";

export interface AgentToolSpec {
    id: string;
    label: string;
    /** One line: what the tool lets the agent do. */
    description: string;
    /** Where the tool is honoured. Meetings ground on retrieval only today. */
    surfaces: readonly AgentToolSurface[];
    /**
     * Whether the person's own toggle is also needed for the tool to run on a
     * turn (web search and reasoning are opt-in per message; retrieval is
     * always on unless the agent lacks it).
     */
    perTurnToggle: boolean;
}

export const AGENT_TOOLS: readonly AgentToolSpec[] = [
    {
        id: "retrieval",
        label: "Workspace retrieval",
        description: "Search the workspace's sources and cite passages from them.",
        surfaces: ["chat", "meeting"],
        perTurnToggle: false,
    },
    {
        id: "web",
        label: "Web search",
        description: "Search the web when the person turns Web on for a message.",
        surfaces: ["chat"],
        perTurnToggle: true,
    },
    {
        id: "reasoning",
        label: "Extended reasoning",
        description: "Use the reasoning route and think before answering when Think is on.",
        surfaces: ["chat"],
        perTurnToggle: true,
    },
    {
        id: "attachments",
        label: "Attachments and images",
        description: "Read files and images attached to a message.",
        surfaces: ["chat"],
        perTurnToggle: false,
    },
];

export const AGENT_TOOL_IDS: readonly string[] = AGENT_TOOLS.map(tool => tool.id);

const BY_ID = new Map(AGENT_TOOLS.map(tool => [tool.id, tool]));

export function agentTool(id: string): AgentToolSpec | undefined {
    return BY_ID.get(id);
}

export function isAgentToolId(value: unknown): value is string {
    return typeof value === "string" && BY_ID.has(value);
}

/**
 * An agent's tool list: `null` means every tool; otherwise exactly these
 * ids, in registry order.
 */
export type AgentToolList = string[] | null;

export function agentAllows(tools: AgentToolList | undefined, id: string): boolean {
    if (tools === null || tools === undefined) return true;
    return tools.includes(id);
}

/** Registry tools the agent does not have — what the badges and the file show. */
export function disabledTools(tools: AgentToolList | undefined): string[] {
    if (tools === null || tools === undefined) return [];
    return AGENT_TOOL_IDS.filter(id => !tools.includes(id));
}

/** The tools the agent has, in registry order. */
export function enabledTools(tools: AgentToolList | undefined): string[] {
    if (tools === null || tools === undefined) return [...AGENT_TOOL_IDS];
    return AGENT_TOOL_IDS.filter(id => tools.includes(id));
}

/**
 * Reads a tool list from anything a row, a form or a file might hold: an
 * array of ids, or the OpenCode-style map (`{ web: false }` denies, a map of
 * only `true` entries allows exactly those). Unknown ids are dropped; a list
 * that ends up naming every tool collapses to `null` so a future tool is
 * not silently withheld from an agent that was never restricted.
 */
export function normalizeToolList(value: unknown): AgentToolList {
    let ids: string[] | null = null;
    if (Array.isArray(value)) {
        ids = value.filter(isAgentToolId);
    } else if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>).filter(
            ([id, on]) => isAgentToolId(id) && typeof on === "boolean"
        );
        if (entries.length === 0) return null;
        const denied = entries.filter(([, on]) => on === false).map(([id]) => id);
        const allowed = entries.filter(([, on]) => on === true).map(([id]) => id);
        ids = denied.length > 0 ? AGENT_TOOL_IDS.filter(id => !denied.includes(id)) : allowed;
    } else {
        return null;
    }
    const chosen = ids;
    const ordered = AGENT_TOOL_IDS.filter(id => chosen.includes(id));
    return ordered.length === AGENT_TOOL_IDS.length ? null : ordered;
}
