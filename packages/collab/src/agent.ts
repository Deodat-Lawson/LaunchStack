/**
 * Agent runtimes — the thing that actually produces a persona's turn.
 *
 * The orchestrator never calls a model directly. It asks a `AgentRuntime` for
 * the next utterance, which is what lets the same meeting run entirely
 * in-process, entirely on a remote worker, or split across both: a remote
 * runtime is just another implementation of this interface (see
 * `net/remote-runtime.ts`).
 */

import type { AgentPersona, ChannelMessage, MeetingConfig } from "./types";

/** The subset of a meeting an agent needs to take its turn. */
export interface TurnContext {
    meetingId: string;
    title: string;
    objective: string;
    agenda: string[];
    /** Grounding passages supplied by the host (retrieval hits, prior minutes). */
    context: string[];
    /** Every participant, so an agent knows who else is in the room. */
    roster: Array<Pick<AgentPersona, "id" | "displayName" | "role">>;
    /** Zero-based index of this turn within the meeting. */
    turnIndex: number;
    maxTurns: number;
    completionMarker: string;
}

export interface AgentTurnRequest {
    persona: AgentPersona;
    context: TurnContext;
    /** Full transcript so far, oldest first. */
    transcript: ChannelMessage[];
}

export interface AgentTurnResult {
    text: string;
    /** Persona ids this turn explicitly addresses (parsed `@mentions`). */
    addressedTo?: string[];
    /** True when the turn contained the completion marker. */
    proposesCompletion?: boolean;
    /** Model / latency metadata surfaced in the UI. */
    meta?: Record<string, unknown>;
}

export interface AgentRuntime {
    /** Identifies the node serving these personas. `"local"` for in-process. */
    readonly nodeId: string;
    /** True when this runtime can serve the given persona. */
    serves(persona: AgentPersona): boolean;
    takeTurn(request: AgentTurnRequest): Promise<AgentTurnResult>;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

export interface CollabChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

/**
 * The single LLM entry point the collaboration engine needs. Hosts adapt their
 * own model factory to this shape, which keeps core free of endpoint config.
 */
export type CollabChatFn = (request: {
    messages: CollabChatMessage[];
    route?: string;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
}) => Promise<string>;

const DEFAULT_COMPLETION_MARKER = "MEETING_COMPLETE";

/** Builds the standing system prompt for one persona in one meeting. */
export function buildSystemPrompt(persona: AgentPersona, ctx: TurnContext): string {
    const roster = ctx.roster
        .filter(p => p.id !== persona.id)
        .map(p => `- @${p.id} (${p.displayName}) — ${p.role}`)
        .join("\n");

    const lines = [
        `You are ${persona.displayName}, the ${persona.role} in a working meeting held in a team chat channel.`,
        "",
        persona.systemPrompt.trim(),
        "",
        `## Meeting: ${ctx.title}`,
        `Objective: ${ctx.objective}`,
    ];

    if (ctx.agenda.length > 0) {
        lines.push("Agenda:", ...ctx.agenda.map((a, i) => `${i + 1}. ${a}`));
    }

    if (roster) {
        lines.push("", "## Other participants", roster);
    }

    if (ctx.context.length > 0) {
        lines.push(
            "",
            "## Grounding context",
            "Only these passages are known-good. Do not invent facts beyond them; say so when something is unknown.",
            ...ctx.context.map((c, i) => `[${i + 1}] ${c}`)
        );
    }

    lines.push(
        "",
        "## How to speak here",
        "- Write one chat message. No preamble, no sign-off, no role label — the channel already shows who you are.",
        "- Address a specific participant with @their-id when you need something from them.",
        "- Be concrete: name numbers, tradeoffs, and owners. Do not restate what was already said.",
        `- This meeting ends after at most ${ctx.maxTurns} turns; you are on turn ${ctx.turnIndex + 1}.`,
        `- When the objective is genuinely met, end your message with ${ctx.completionMarker} on its own line.`
    );

    if (persona.maxTurnChars) {
        lines.push(`- Keep the message under ${persona.maxTurnChars} characters.`);
    }

    return lines.join("\n");
}

/**
 * Renders the transcript as chat turns. The persona's own messages become
 * `assistant`; everyone else's become `user` prefixed with the speaker, which
 * is the shape OpenAI-compatible endpoints handle most reliably for
 * multi-party conversation.
 */
export function buildTranscriptMessages(
    persona: AgentPersona,
    transcript: ChannelMessage[]
): CollabChatMessage[] {
    return transcript.map(m => {
        if (
            m.author.kind === "agent" &&
            m.author.id === persona.id &&
            !m.author.onBehalfOfPersonaId
        ) {
            return { role: "assistant" as const, content: m.text };
        }
        const speaker =
            m.author.kind === "human"
                ? `${m.author.displayName} (human${m.author.onBehalfOfPersonaId ? `, speaking for @${m.author.onBehalfOfPersonaId}` : ""})`
                : `${m.author.displayName} (@${m.author.id})`;
        const prefix = m.kind === "system" ? "System" : speaker;
        return { role: "user" as const, content: `${prefix}: ${m.text}` };
    });
}

/** Extracts `@persona-id` mentions that match a known participant. */
export function parseMentions(text: string, roster: Array<{ id: string }>): string[] {
    const ids = new Set(roster.map(r => r.id));
    const found: string[] = [];
    for (const match of text.matchAll(/@([a-zA-Z0-9_-]+)/g)) {
        const id = match[1]!;
        if (ids.has(id) && !found.includes(id)) found.push(id);
    }
    return found;
}

/**
 * Strips the completion marker and reports whether it was present. The marker
 * never reaches the transcript — it is control flow, not conversation.
 */
export function extractCompletion(
    text: string,
    marker: string = DEFAULT_COMPLETION_MARKER
): { text: string; proposesCompletion: boolean } {
    if (!text.includes(marker)) return { text: text.trim(), proposesCompletion: false };
    const stripped = text
        .split(marker)
        .join("")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return { text: stripped, proposesCompletion: true };
}

// ---------------------------------------------------------------------------
// LLM-backed runtime
// ---------------------------------------------------------------------------

export interface LlmAgentRuntimeOptions {
    nodeId?: string;
    /** Personas this runtime serves. Empty means "any persona routed to me". */
    personaIds?: string[];
    defaultTemperature?: number;
    maxTokens?: number;
}

export class LlmAgentRuntime implements AgentRuntime {
    readonly nodeId: string;
    private readonly personaIds: Set<string> | null;

    constructor(
        private readonly chat: CollabChatFn,
        private readonly options: LlmAgentRuntimeOptions = {}
    ) {
        this.nodeId = options.nodeId ?? "local";
        this.personaIds = options.personaIds?.length ? new Set(options.personaIds) : null;
    }

    serves(persona: AgentPersona): boolean {
        const owner = persona.nodeId ?? "local";
        if (owner !== this.nodeId) return false;
        return this.personaIds ? this.personaIds.has(persona.id) : true;
    }

    async takeTurn({ persona, context, transcript }: AgentTurnRequest): Promise<AgentTurnResult> {
        const started = Date.now();
        const messages: CollabChatMessage[] = [
            { role: "system", content: buildSystemPrompt(persona, context) },
            ...buildTranscriptMessages(persona, transcript),
        ];
        if (transcript.length === 0) {
            messages.push({
                role: "user",
                content:
                    "System: You are opening the meeting. State the goal and your first substantive point.",
            });
        }

        const raw = await this.chat({
            messages,
            route: persona.route,
            temperature: persona.temperature ?? this.options.defaultTemperature,
            maxTokens: this.options.maxTokens,
        });

        const { text, proposesCompletion } = extractCompletion(raw, context.completionMarker);
        const capped =
            persona.maxTurnChars && text.length > persona.maxTurnChars
                ? `${text.slice(0, persona.maxTurnChars - 1).trimEnd()}…`
                : text;

        return {
            text: capped,
            addressedTo: parseMentions(capped, context.roster),
            proposesCompletion,
            meta: { nodeId: this.nodeId, latencyMs: Date.now() - started, route: persona.route },
        };
    }
}

// ---------------------------------------------------------------------------
// Scripted runtime (tests, demos, evals)
// ---------------------------------------------------------------------------

/**
 * Replays canned lines per persona. Used by integration tests and by the
 * evaluation harness so meeting *orchestration* can be scored without paying
 * for — or being made flaky by — model calls.
 */
export class ScriptedAgentRuntime implements AgentRuntime {
    readonly nodeId: string;
    private readonly cursors = new Map<string, number>();

    constructor(
        private readonly script: Record<string, string[]>,
        options: { nodeId?: string } = {}
    ) {
        this.nodeId = options.nodeId ?? "local";
    }

    serves(persona: AgentPersona): boolean {
        return (persona.nodeId ?? "local") === this.nodeId && persona.id in this.script;
    }

    async takeTurn({ persona, context }: AgentTurnRequest): Promise<AgentTurnResult> {
        const lines = this.script[persona.id] ?? [];
        const cursor = this.cursors.get(persona.id) ?? 0;
        this.cursors.set(persona.id, cursor + 1);
        const raw = lines[Math.min(cursor, lines.length - 1)] ?? "(no comment)";
        const { text, proposesCompletion } = extractCompletion(raw, context.completionMarker);
        return {
            text,
            addressedTo: parseMentions(text, context.roster),
            proposesCompletion,
            meta: { nodeId: this.nodeId, scripted: true },
        };
    }
}

export function defaultCompletionMarker(config: Pick<MeetingConfig, "completionMarker">): string {
    return config.completionMarker ?? DEFAULT_COMPLETION_MARKER;
}

export { DEFAULT_COMPLETION_MARKER };
