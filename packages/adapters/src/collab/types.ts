/**
 * Collaboration engine types — channels, meetings, and the participants that
 * speak in them.
 *
 * A *channel* is a Slack-shaped message log: an ordered, append-only sequence
 * of messages with authors and optional threads. A *meeting* is an orchestrated
 * conversation that runs **inside** a channel: agents take turns, a human can
 * step in at any point, and the whole thing is transcript-first so it can be
 * mirrored to a real Slack channel without translation.
 *
 * Nothing here talks to a network, a database, or an LLM. Those are ports —
 * see `store.ts`, `agent.ts`, and `net/`.
 */

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

export const ParticipantKinds = ["agent", "human"] as const;
export type ParticipantKind = (typeof ParticipantKinds)[number];

/**
 * A message author. Deliberately denormalized (`displayName` copied onto every
 * message) so a transcript stays readable after a persona is renamed or
 * removed — the same reason Slack stores the display name on the message.
 */
export interface MessageAuthor {
    kind: ParticipantKind;
    /** Persona id for agents; user id for humans. */
    id: string;
    displayName: string;
    /**
     * Set when a human is speaking *through* an agent seat (takeover). The
     * transcript shows the human, but turn-taking still counts the persona.
     */
    onBehalfOfPersonaId?: string;
}

/**
 * An AI participant. `nodeId` is what makes a meeting distributed: personas
 * whose `nodeId` is not the hub's own id have their turns dispatched over the
 * network to the worker process that claimed that id.
 */
export interface AgentPersona {
    /** Unique within a meeting. Used as the author id on messages. */
    id: string;
    displayName: string;
    /** Short role label — shown in the UI and injected into the system prompt. */
    role: string;
    /** The persona's standing instructions. */
    systemPrompt: string;
    /**
     * Which node serves this persona's turns. Omitted / `"local"` means the
     * orchestrator process itself.
     */
    nodeId?: string;
    /** Model route hint handed to the runtime (`default`, `fast`, `reasoning`). */
    route?: string;
    temperature?: number;
    /** Hard cap on a single turn, in characters. Keeps meetings readable. */
    maxTurnChars?: number;
    /** Free-form colour/emoji used by the UI and by the Slack bridge. */
    accent?: string;
}

export interface HumanParticipant {
    id: string;
    displayName: string;
    /** Workspace role, purely informational for the transcript. */
    role?: string;
}

// ---------------------------------------------------------------------------
// Channel + messages
// ---------------------------------------------------------------------------

export const ChannelMessageKinds = [
    "chat",
    "system",
    "decision",
    "action_item",
    "summary",
] as const;
export type ChannelMessageKind = (typeof ChannelMessageKinds)[number];

export interface ChannelMessage {
    id: string;
    channelId: string;
    /** Monotonic, gap-free, 1-based position within the channel. */
    seq: number;
    /** ISO-8601 timestamp. */
    ts: string;
    author: MessageAuthor;
    text: string;
    kind: ChannelMessageKind;
    /** Root message id when this message belongs to a thread. */
    threadId?: string;
    /** Slack `ts` of the mirrored copy, when the Slack bridge is active. */
    slackTs?: string;
    meta?: Record<string, unknown>;
}

/** Input accepted by `ChannelStore.append` — seq/ts/id are assigned by the store. */
export interface ChannelMessageInput {
    channelId: string;
    author: MessageAuthor;
    text: string;
    kind?: ChannelMessageKind;
    threadId?: string;
    slackTs?: string;
    meta?: Record<string, unknown>;
}

export interface Channel {
    id: string;
    /** Slack-style handle, e.g. `q3-pricing-review`. Unique per workspace. */
    slug: string;
    name: string;
    topic?: string;
    workspaceId: string;
    createdAt: string;
    /** Linked real Slack channel, when mirroring is configured. */
    slackChannelId?: string;
    archived?: boolean;
}

// ---------------------------------------------------------------------------
// Turn policy
// ---------------------------------------------------------------------------

export const TurnPolicyKinds = ["round_robin", "moderated", "reactive"] as const;
export type TurnPolicyKind = (typeof TurnPolicyKinds)[number];

/**
 * How the next speaker is chosen.
 *
 * - `round_robin` — fixed rotation. Deterministic; the default.
 * - `moderated`   — the first persona (or `moderatorId`) opens and closes the
 *   meeting and nominates the next speaker by writing `@persona-id`.
 * - `reactive`    — whoever the last message addressed, else the persona whose
 *   role words best match the last message. Deterministic tie-break by order.
 */
export interface TurnPolicy {
    kind: TurnPolicyKind;
    moderatorId?: string;
}

// ---------------------------------------------------------------------------
// Meeting
// ---------------------------------------------------------------------------

export const MeetingStatuses = [
    "scheduled",
    "running",
    "paused",
    "human_control",
    "completed",
    "failed",
] as const;
export type MeetingStatus = (typeof MeetingStatuses)[number];

export interface SlackMirrorConfig {
    /** Slack channel id (`C…`) the meeting mirrors into. */
    channelId: string;
    /** When false the bridge is configured but dormant. */
    enabled: boolean;
    /** Post agent turns as the agent's display name via `username` override. */
    useAgentIdentity?: boolean;
}

export interface MeetingConfig {
    id: string;
    channelId: string;
    workspaceId: string;
    title: string;
    /** What the meeting is meant to produce. Injected into every system prompt. */
    objective: string;
    agenda: string[];
    participants: AgentPersona[];
    turnPolicy: TurnPolicy;
    /** Hard stop. The orchestrator never exceeds this many agent turns. */
    maxTurns: number;
    /**
     * A persona ends the meeting by emitting this marker. Default
     * `MEETING_COMPLETE`. The marker is stripped before the message is stored.
     */
    completionMarker?: string;
    slack?: SlackMirrorConfig;
    /**
     * Grounding context (retrieved knowledge, prior minutes) prepended to every
     * turn. Kept as plain strings so the engine stays retrieval-agnostic.
     */
    context?: string[];
}

export interface MeetingState {
    meetingId: string;
    status: MeetingStatus;
    /** Agent turns taken so far. Human messages do not advance this. */
    turnIndex: number;
    /** Persona id expected to speak next, or null when the meeting has ended. */
    nextSpeakerId: string | null;
    /** Set while a human holds control. */
    controller?: {
        humanId: string;
        displayName: string;
        /** When set, the human is occupying this agent's seat. */
        asPersonaId?: string;
        since: string;
    };
    startedAt?: string;
    endedAt?: string;
    /** Populated when status is `failed`. */
    error?: string;
}

/** What the orchestrator returns after a single `step()`. */
export interface MeetingStepResult {
    /** The message produced by this step, if any. */
    message?: ChannelMessage;
    state: MeetingState;
    /** True when the meeting reached a terminal state during this step. */
    done: boolean;
    /** Why the step produced no message (paused, human control, complete…). */
    skipped?: "paused" | "human_control" | "completed" | "max_turns" | "no_speaker";
}

// ---------------------------------------------------------------------------
// Minutes
// ---------------------------------------------------------------------------

export interface ActionItem {
    text: string;
    owner?: string;
    /** Message seq the item was extracted from. */
    sourceSeq: number;
}

export interface MeetingMinutes {
    meetingId: string;
    title: string;
    objective: string;
    status: MeetingStatus;
    turnsTaken: number;
    participants: Array<{ id: string; displayName: string; role: string; messages: number }>;
    decisions: Array<{ text: string; sourceSeq: number; author: string }>;
    actionItems: ActionItem[];
    /** Deterministic extractive summary — no LLM call. */
    summary: string;
    humanInterventions: number;
}
