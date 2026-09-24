/**
 * Client-side shapes for the collaboration surfaces. Mirrors what
 * `/api/collab/**` returns — deliberately hand-written rather than inferred so
 * the UI has one place to look when the API changes.
 */

import type { AgentAutonomy } from "~/lib/agents/autonomy";
import type { AgentMode, AgentStyleId, AgentToolList } from "~/lib/agents/definition";

export type MeetingStatus =
    | "scheduled"
    | "running"
    | "paused"
    | "human_control"
    | "completed"
    | "failed";

export interface MeetingParticipant {
    id: string;
    displayName: string;
    role: string;
    systemPrompt?: string;
    nodeId?: string | null;
    route?: string | null;
    accent?: string | null;
    /** Picture shown instead of initials, when the agent has one. */
    avatarUrl?: string | null;
}

/** One phase of a meeting's workflow, as the engine walks it. */
export interface MeetingPhase {
    id: string;
    title: string;
    goal: string;
    turns: number;
    speakerIds?: string[];
}

export interface MeetingSummary {
    id: string;
    title: string;
    objective: string;
    status: MeetingStatus;
    turnIndex: number;
    maxTurns: number;
    channelId: string;
    channelSlug: string | null;
    participants: MeetingParticipant[];
    workflowKey: string | null;
    workflowTitle: string | null;
    /** Titles and lengths only — enough for a progress strip. */
    phases: Array<Pick<MeetingPhase, "id" | "title" | "turns">>;
    slackChannelId: string | null;
    slackMirrorEnabled: boolean;
    createdAt: string;
    startedAt: string | null;
    endedAt: string | null;
}

export interface ChannelMessage {
    id: string;
    channelId: string;
    seq: number;
    ts: string;
    author: {
        kind: "agent" | "human";
        id: string;
        displayName: string;
        onBehalfOfPersonaId?: string;
    };
    text: string;
    kind: "chat" | "system" | "decision" | "action_item" | "summary";
    threadId?: string;
    slackTs?: string;
    meta?: Record<string, unknown>;
}

export interface MeetingState {
    meetingId: string;
    status: MeetingStatus;
    turnIndex: number;
    nextSpeakerId: string | null;
    /** Index of the phase in force, when the meeting has phases. */
    phaseIndex?: number;
    controller?: {
        humanId: string;
        displayName: string;
        asPersonaId?: string;
        since: string;
    };
    startedAt?: string;
    endedAt?: string;
    error?: string;
}

export interface MeetingMinutes {
    meetingId: string;
    title: string;
    objective: string;
    status: MeetingStatus;
    turnsTaken: number;
    participants: Array<{ id: string; displayName: string; role: string; messages: number }>;
    decisions: Array<{ text: string; sourceSeq: number; author: string }>;
    actionItems: Array<{ text: string; owner?: string; sourceSeq: number }>;
    summary: string;
    humanInterventions: number;
}

export interface MeetingDetail {
    meeting: {
        id: string;
        title: string;
        objective: string;
        agenda: string[];
        participants: MeetingParticipant[];
        turnPolicy: { kind: string; moderatorId?: string };
        maxTurns: number;
        phases: MeetingPhase[];
        workflowKey: string | null;
        workflowTitle: string | null;
        channelId: string;
        channelSlug: string | null;
        slack: { channelId: string; enabled: boolean; useAgentIdentity?: boolean } | null;
        createdAt: string;
    };
    state: MeetingState;
    messages: ChannelMessage[];
    latestSeq: number;
    minutes: MeetingMinutes;
}

/**
 * A roster row: the meeting participant plus the harness fields the chat
 * and the Agents page read. See `~/lib/agents/definition` for what each means.
 */
export interface AgentPersonaRecord extends MeetingParticipant {
    dbId: string;
    systemPrompt: string;
    temperature?: number;
    maxTurnChars?: number;
    archived: boolean;
    /** Own autonomy level; null inherits `AgentsResponse.defaults.autonomy`. */
    autonomy?: AgentAutonomy | null;
    /** One line on when to use this agent. */
    description: string;
    mode: AgentMode;
    /** Tool ids from the registry; null = every tool. */
    tools: AgentToolList;
    style: AgentStyleId | null;
    /** Seeded from the starter roster; can be reset to its shipped definition. */
    builtin: boolean;
}

/** What the chat needs to know about an agent to pick it and attribute turns. */
export type ChatAgentOption = Pick<
    AgentPersonaRecord,
    | "id"
    | "displayName"
    | "role"
    | "description"
    | "accent"
    | "avatarUrl"
    | "mode"
    | "tools"
    | "builtin"
>;

export interface WorkerNode {
    nodeId: string;
    label?: string;
    personaIds: string[];
    lastSeenAt: number;
    queuedEvents: number;
    connected: boolean;
}

export interface AgentsResponse {
    personas: AgentPersonaRecord[];
    nodes: WorkerNode[];
    /** Workspace defaults the roster inherits. Absent on older servers. */
    defaults?: { autonomy: string };
    network: { enabled: boolean; hubId: string | null; hubPath: string };
    slack: { canPost: boolean; canReceive: boolean; missing: string[] };
}

export const MEETING_STATUS_META: Record<
    MeetingStatus,
    { label: string; tone: "live" | "idle" | "human" | "done" | "bad" }
> = {
    scheduled: { label: "Scheduled", tone: "idle" },
    running: { label: "Live", tone: "live" },
    paused: { label: "Paused", tone: "idle" },
    human_control: { label: "Human control", tone: "human" },
    completed: { label: "Ended", tone: "done" },
    failed: { label: "Failed", tone: "bad" },
};

export function statusColor(tone: "live" | "idle" | "human" | "done" | "bad"): string {
    switch (tone) {
        case "live":
            return "oklch(0.58 0.15 165)";
        case "human":
            return "oklch(0.6 0.17 50)";
        case "bad":
            return "var(--danger)";
        case "done":
            return "var(--ink-3)";
        default:
            return "var(--ink-3)";
    }
}

/**
 * Stable colour per persona so the same agent reads the same across the
 * transcript, the roster, and the participant strip.
 */
export function personaColor(persona: { id: string; accent?: string | null }): string {
    if (persona.accent) return persona.accent;
    let hash = 0;
    for (const ch of persona.id) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
    return `oklch(0.56 0.14 ${hash})`;
}

export function initialsOf(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
}
