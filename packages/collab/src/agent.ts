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
    /** The phase in force, when the meeting follows a workflow. */
    phase?: {
        index: number;
        count: number;
        title: string;
        goal: string;
        /** Zero-based turn offset within the phase, and the phase's length. */
        offset: number;
        turns: number;
        /** True on the last phase — the one that has to land the objective. */
        last: boolean;
        /**
         * Seats still to speak in the phase's round, the speaker excluded, so
         * an agent hands the floor to someone waiting and leaves their part to
         * them. Optional on the wire: older hubs do not send it.
         */
        waiting?: string[];
    };
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

    if (ctx.phase) {
        lines.push(
            "",
            `## Current phase: ${ctx.phase.title} (${ctx.phase.index + 1} of ${ctx.phase.count})`,
            ctx.phase.goal.trim(),
            `This phase has ${ctx.phase.turns} turn${ctx.phase.turns === 1 ? "" : "s"}; this is turn ${
                ctx.phase.offset + 1
            } of it.${
                ctx.phase.last
                    ? " It is the closing phase — bring the room to a decision."
                    : " Stay inside the phase's goal; the next phase has its own."
            }`
        );
        if (ctx.phase.waiting && ctx.phase.waiting.length > 0) {
            lines.push(
                `Still to speak in this phase: ${ctx.phase.waiting.map(id => `@${id}`).join(", ")}. Leave their part to them; if you hand the floor on, name one of them.`
            );
        }
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
        `- Speak only as ${persona.displayName}. Never write another participant's lines or answer a question put to someone else; they answer on their own turn.`,
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

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches a line that opens with a seat's speaker label — `Dana (@finance):`,
 * the form the transcript itself puts on every turn, bold or quoted or not.
 * Plain `@finance:` is left alone: that is how people address each other.
 */
function speakerLabel(seat: { id: string; displayName: string }): RegExp {
    const name = escapeRegExp(seat.displayName.trim());
    return new RegExp(
        `^[ \\t>]*(?:[*_]{1,3}[ \\t]*)?${name}[ \\t]*\\(@${escapeRegExp(seat.id)}\\)[ \\t]*(?:[*_]{1,3}[ \\t]*)?:(?:[ \\t]*[*_]{1,3})?[ \\t]*`,
        "i"
    );
}

export interface OwnVoice {
    /** The reply with the speaker's own label dropped and anything said as another seat cut. */
    text: string;
    /** The seat the reply opened as, when it opened as someone else's turn. */
    spokeAs?: string;
    /** True when lines written as another seat were cut. */
    cut: boolean;
}

/**
 * Keeps a reply in its speaker's voice. Models continue the transcript's
 * pattern and write the next person's turn too ("Dana (@finance): Looking at
 * the cash impact…"), which puts words in a seat's mouth that it never said.
 * Everything from the first line labelled as another participant is cut; a
 * reply that opens that way is reported in `spokeAs` so the caller can ask
 * again instead of posting it.
 */
export function keepOwnVoice(
    text: string,
    speaker: Pick<AgentPersona, "id" | "displayName">,
    roster: ReadonlyArray<Pick<AgentPersona, "id" | "displayName">>
): OwnVoice {
    const lines = text.split("\n");
    const first = lines.findIndex(line => line.trim().length > 0);
    if (first === -1) return { text: "", cut: false };
    lines[first] = lines[first]!.replace(speakerLabel(speaker), "");

    const others = roster
        .filter(seat => seat.id !== speaker.id)
        .map(seat => ({ id: seat.id, label: speakerLabel(seat) }));
    for (let i = first; i < lines.length; i++) {
        const other = others.find(seat => seat.label.test(lines[i]!));
        if (!other) continue;
        const kept = lines.slice(0, i).join("\n").trim();
        return { text: kept, cut: true, ...(kept ? {} : { spokeAs: other.id }) };
    }
    return { text: lines.join("\n").trim(), cut: false };
}

/** A sentence end: terminal punctuation, then closing quotes or emphasis, then a space or the end. */
const SENTENCE_END = /[.!?…](?:["'”’)\]*_`]+)?(?=\s|$)/g;

/**
 * Cuts text back to its last complete sentence or line within `maxChars`
 * (default: all of it), for a reply that ran into a length limit. A turn that
 * stops mid-sentence reads as broken; one that stops a sentence early does
 * not. When the only break would keep less than a fifth of the text, it cuts
 * at a word and marks the cut with an ellipsis rather than throw the reply
 * away.
 */
export function trimToCompleteSentence(text: string, maxChars?: number): string {
    const source = text.trim();
    if (!source) return "";
    const window =
        maxChars !== undefined && source.length > maxChars ? source.slice(0, maxChars) : source;
    let cut = -1;
    for (const match of window.matchAll(SENTENCE_END)) cut = match.index + match[0].length;
    const lineBreak = window.lastIndexOf("\n");
    if (lineBreak > cut) cut = lineBreak;
    if (cut >= window.length * 0.2) return window.slice(0, cut).trimEnd();
    const space = window.lastIndexOf(" ", window.length - 2);
    return `${window.slice(0, space > 0 ? space : window.length - 1).trimEnd()}…`;
}

/** The last message of every turn: whose turn it is, so the reply is theirs alone. */
function turnCue(persona: AgentPersona, opening: boolean): CollabChatMessage {
    const who = `${persona.displayName} (@${persona.id})`;
    const own = `Write ${persona.displayName}'s message only — no lines for anyone else.`;
    return {
        role: "user",
        content: opening
            ? `System: You are opening the meeting, ${who}. State the goal and your first substantive point. ${own}`
            : `System: It is your turn, ${who}. ${own}`,
    };
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
        const conversation: CollabChatMessage[] = [
            { role: "system", content: buildSystemPrompt(persona, context) },
            ...buildTranscriptMessages(persona, transcript),
        ];
        const ask = (cue: CollabChatMessage) =>
            this.chat({
                messages: [...conversation, cue],
                route: persona.route,
                temperature: persona.temperature ?? this.options.defaultTemperature,
                maxTokens: this.options.maxTokens,
            });

        let voice = keepOwnVoice(
            await ask(turnCue(persona, context.turnIndex === 0)),
            persona,
            context.roster
        );
        let retried = false;
        if (voice.spokeAs) {
            // The whole reply was someone else's turn. Ask once more, naming the mistake.
            const other = context.roster.find(seat => seat.id === voice.spokeAs);
            const otherName = other ? `${other.displayName} (@${other.id})` : `@${voice.spokeAs}`;
            retried = true;
            voice = keepOwnVoice(
                await ask({
                    role: "user",
                    content: `System: That draft was written as ${otherName}. You are ${persona.displayName} (@${persona.id}): write your own message from your own seat. ${otherName} answers for themselves on their turn.`,
                }),
                persona,
                context.roster
            );
            if (voice.spokeAs) {
                throw new Error(`spoke as @${voice.spokeAs} instead of in its own voice`);
            }
        }

        const { text, proposesCompletion } = extractCompletion(
            voice.text,
            context.completionMarker
        );
        const capped =
            persona.maxTurnChars && text.length > persona.maxTurnChars
                ? trimToCompleteSentence(text, persona.maxTurnChars)
                : text;

        return {
            text: capped,
            addressedTo: parseMentions(capped, context.roster),
            proposesCompletion,
            meta: {
                nodeId: this.nodeId,
                latencyMs: Date.now() - started,
                route: persona.route,
                ...(voice.cut ? { cutOtherVoices: true } : {}),
                ...(retried ? { retriedOwnVoice: true } : {}),
            },
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
