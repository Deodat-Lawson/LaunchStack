/**
 * What an agent *is*, in one vocabulary shared by the roster, the meeting
 * room, the chat composer and the API.
 *
 * The shape follows the harness that Hermes, OpenCode and T3 Code converged
 * on: an agent is a named system prompt with a one-line description (so a
 * router or a person can pick it), a *mode* (drives a conversation, is
 * called into one, or both), a model preference, a tool allow-list and a
 * permission level. In Launchstack the tools are the chat's own capabilities
 * — workspace retrieval, web search, reasoning, attachments — and the
 * permission level is the autonomy dial that already governs meetings.
 *
 * Dependency-free apart from the autonomy module, so a client component, a
 * route handler and a test all describe an agent with the same words.
 */

import { isAgentAutonomy, type AgentAutonomy } from "./autonomy";
import { agentAllows, normalizeToolList, type AgentToolList } from "./tools";

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

/**
 * - `primary`  — can be the agent a chat is held with (picked in the composer).
 * - `subagent` — only called into a turn with `@handle`, or seated in a meeting.
 * - `all`      — both. The default.
 */
export const AGENT_MODES = ["primary", "subagent", "all"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];
export const DEFAULT_AGENT_MODE: AgentMode = "all";

export const AGENT_MODE_META: Record<AgentMode, { label: string; description: string }> = {
    primary: {
        label: "Primary",
        description: "Can be picked as the agent a chat is held with. Not summoned with @.",
    },
    subagent: {
        label: "Subagent",
        description: "Summoned into a single turn with @handle, or seated in a meeting.",
    },
    all: {
        label: "Primary + subagent",
        description: "Pickable in the composer and summonable with @handle.",
    },
};

export function isAgentMode(value: unknown): value is AgentMode {
    return typeof value === "string" && (AGENT_MODES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Tools — the registry lives in ./tools; re-exported so callers have one import
// ---------------------------------------------------------------------------

export {
    AGENT_TOOLS,
    AGENT_TOOL_IDS,
    agentAllows,
    agentTool,
    disabledTools,
    enabledTools,
    isAgentToolId,
    normalizeToolList,
    type AgentToolList,
    type AgentToolSpec,
} from "./tools";

// ---------------------------------------------------------------------------
// Response styles the chat already supports
// ---------------------------------------------------------------------------

/** Mirrors `~/lib/ai/styles` without importing its prompt bodies. */
export const AGENT_STYLE_IDS = ["concise", "detailed", "academic", "organized"] as const;
export type AgentStyleId = (typeof AGENT_STYLE_IDS)[number];

export function isAgentStyle(value: unknown): value is AgentStyleId {
    return typeof value === "string" && (AGENT_STYLE_IDS as readonly string[]).includes(value);
}

export const AGENT_ROUTE_IDS = ["default", "fast", "reasoning", "vision"] as const;
export type AgentRouteId = (typeof AGENT_ROUTE_IDS)[number];

export function isAgentRoute(value: unknown): value is AgentRouteId {
    return typeof value === "string" && (AGENT_ROUTE_IDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The definition
// ---------------------------------------------------------------------------

/**
 * Everything that makes an agent, independent of where it is stored. The
 * roster row, the definition file and the meeting participant are all views
 * of this.
 */
export interface AgentDefinition {
    /** Handle: `@key` in transcripts and mentions. Lowercase, mention-safe. */
    key: string;
    displayName: string;
    /** One-line role label, e.g. "Finance partner". */
    role: string;
    /** One line on when to use this agent. Read by people and by @-menus. */
    description: string;
    /** The standing instructions — the body of the definition file. */
    systemPrompt: string;
    mode: AgentMode;
    /** Tool ids from the registry; null = every tool. */
    tools: AgentToolList;
    /** Response style the chat applies under the instructions; null = the chat's default. */
    style: AgentStyleId | null;
    /** Model route hint (`fast`, `reasoning`, …); null = the deployment default. */
    route: AgentRouteId | null;
    temperature: number | null;
    maxTurnChars: number | null;
    /** Colour used for the avatar and the transcript. */
    accent: string | null;
    /** Picture shown instead of initials — a path under /agents or an https URL. */
    avatarUrl: string | null;
    /** Own autonomy level; null inherits the workspace default. */
    autonomy: AgentAutonomy | null;
    /** Which worker node serves this agent; null = this app. */
    nodeId: string | null;
}

export const AGENT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export function isAgentKey(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length >= 2 &&
        value.length <= 48 &&
        AGENT_KEY_PATTERN.test(value)
    );
}

/** Turns free text into a handle: "Finance Partner!" → "finance-partner". */
export function toAgentKey(input: string): string {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
}

// ---------------------------------------------------------------------------
// Mentions
// ---------------------------------------------------------------------------

const MENTION = /(^|[^\w@])@([a-z0-9][a-z0-9_-]*)/gi;

/** Every `@handle` in the text that names a known agent, first occurrence first. */
export function mentionedAgentKeys(text: string, known: readonly string[]): string[] {
    const roster = new Set(known);
    const found: string[] = [];
    for (const match of text.matchAll(MENTION)) {
        const key = match[2]!.toLowerCase();
        if (roster.has(key) && !found.includes(key)) found.push(key);
    }
    return found;
}

/** The handle being typed at the caret — `@ana` → "ana" — or null when not in a mention. */
export function mentionQueryAt(
    text: string,
    caret: number
): { query: string; start: number } | null {
    const before = text.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at < 0) return null;
    if (at > 0 && /[\w@]/.test(before[at - 1]!)) return null;
    const query = before.slice(at + 1);
    if (!/^[a-z0-9_-]*$/i.test(query)) return null;
    return { query: query.toLowerCase(), start: at };
}

// ---------------------------------------------------------------------------
// Resolving a chat turn against an agent
// ---------------------------------------------------------------------------

export interface ChatTurnRequest {
    webSearch: boolean;
    thinking: boolean;
    hasAttachments: boolean;
}

export interface ResolvedChatTurn {
    webSearch: boolean;
    thinking: boolean;
    /** True when the agent refused an attachment the person sent. */
    attachmentsDropped: boolean;
    /** Route the agent asks for. The server still honours attachment/vision needs first. */
    route: AgentRouteId | null;
    style: AgentStyleId | null;
    temperature: number | null;
    /** Human-readable notes on what the agent changed, for the UI. */
    notes: string[];
}

/**
 * What a turn may actually do once an agent's tool policy is applied to the
 * person's toggles. Pure, so the composer can show the effect before sending
 * and the route can enforce it after.
 */
export function resolveChatTurn(
    agent: Pick<AgentDefinition, "tools" | "route" | "style" | "temperature"> | null,
    request: ChatTurnRequest
): ResolvedChatTurn {
    if (!agent) {
        return {
            webSearch: request.webSearch,
            thinking: request.thinking,
            attachmentsDropped: false,
            route: null,
            style: null,
            temperature: null,
            notes: [],
        };
    }
    const notes: string[] = [];
    const webSearch = request.webSearch && agentAllows(agent.tools, "web");
    if (request.webSearch && !webSearch) notes.push("web search is off for this agent");
    const thinking = request.thinking && agentAllows(agent.tools, "reasoning");
    if (request.thinking && !thinking) notes.push("extended reasoning is off for this agent");
    const attachmentsDropped = request.hasAttachments && !agentAllows(agent.tools, "attachments");
    if (attachmentsDropped) notes.push("this agent does not read attachments");
    return {
        webSearch,
        thinking,
        attachmentsDropped,
        route: agent.route ?? null,
        style: agent.style ?? null,
        temperature: agent.temperature ?? null,
        notes,
    };
}

/** True when the agent may be the one a chat is held with. */
export function usableAsPrimary(agent: Pick<AgentDefinition, "mode">): boolean {
    return agent.mode !== "subagent";
}

/** True when `@handle` may summon the agent into a turn. */
export function usableAsSubagent(agent: Pick<AgentDefinition, "mode">): boolean {
    return agent.mode !== "primary";
}

/** A same-origin path (`/agents/analyst.jpg`) or an https URL; anything else is dropped. */
export function normalizeAvatarUrl(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 512) return null;
    if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
    if (/^https:\/\/[^\s]+$/i.test(trimmed)) return trimmed;
    return null;
}

/** Reads a loosely-typed record (a DB row, a parsed file) into a definition. */
export function coerceAgentDefinition(
    input: Partial<Record<keyof AgentDefinition, unknown>> & { key: string }
): AgentDefinition {
    const temperature =
        typeof input.temperature === "number" && Number.isFinite(input.temperature)
            ? Math.min(2, Math.max(0, input.temperature))
            : null;
    const maxTurnChars =
        typeof input.maxTurnChars === "number" && Number.isFinite(input.maxTurnChars)
            ? Math.round(input.maxTurnChars)
            : null;
    return {
        key: toAgentKey(String(input.key)),
        displayName: typeof input.displayName === "string" ? input.displayName.trim() : "",
        role: typeof input.role === "string" ? input.role.trim() : "",
        description: typeof input.description === "string" ? input.description.trim() : "",
        systemPrompt: typeof input.systemPrompt === "string" ? input.systemPrompt.trim() : "",
        mode: isAgentMode(input.mode) ? input.mode : DEFAULT_AGENT_MODE,
        tools: normalizeToolList(input.tools),
        style: isAgentStyle(input.style) ? input.style : null,
        route: isAgentRoute(input.route) && input.route !== "default" ? input.route : null,
        temperature,
        maxTurnChars,
        accent:
            typeof input.accent === "string" && input.accent.trim() ? input.accent.trim() : null,
        avatarUrl: normalizeAvatarUrl(input.avatarUrl),
        autonomy: isAgentAutonomy(input.autonomy) ? input.autonomy : null,
        nodeId:
            typeof input.nodeId === "string" && input.nodeId.trim() ? input.nodeId.trim() : null,
    };
}
