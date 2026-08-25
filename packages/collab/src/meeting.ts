/**
 * Meeting orchestrator — runs a multi-agent conversation inside a channel.
 *
 * The design rule is that a meeting is *just a channel*: every agent turn,
 * every human interjection, and every state change is an appended message.
 * There is no separate "meeting transcript" to keep in sync, which is what
 * makes human takeover and Slack mirroring fall out for free — both are
 * readers and writers of the same log.
 */

import type { AgentRuntime, AgentTurnResult, TurnContext } from "./agent";
import { DEFAULT_COMPLETION_MARKER } from "./agent";
import type { Clock } from "./clock";
import { systemClock } from "./clock";
import type { ChannelStore } from "./store";
import { selectNextSpeaker } from "./turn-policy";
import type {
    AgentPersona,
    ChannelMessage,
    MeetingConfig,
    MeetingState,
    MeetingStepResult,
} from "./types";

export interface MeetingEvent {
    type:
        | "meeting.started"
        | "meeting.turn"
        | "meeting.paused"
        | "meeting.resumed"
        | "meeting.human_control"
        | "meeting.human_released"
        | "meeting.human_message"
        | "meeting.completed"
        | "meeting.failed";
    meetingId: string;
    state: MeetingState;
    message?: ChannelMessage;
    at: string;
}

export type MeetingEventListener = (event: MeetingEvent) => void;

export interface MeetingOrchestratorOptions {
    store: ChannelStore;
    config: MeetingConfig;
    /** Runtimes are consulted in order; the first that `serves()` wins. */
    runtimes: AgentRuntime[];
    clock?: Clock;
    /** Persisted state to resume from. */
    initialState?: MeetingState;
    /**
     * How many consecutive turn failures are tolerated before the meeting is
     * marked failed. A remote worker restarting mid-meeting should not kill it.
     */
    maxConsecutiveFailures?: number;
}

export class MeetingOrchestrator {
    readonly config: MeetingConfig;
    private readonly store: ChannelStore;
    private readonly runtimes: AgentRuntime[];
    private readonly clock: Clock;
    private readonly listeners = new Set<MeetingEventListener>();
    private readonly maxConsecutiveFailures: number;
    private consecutiveFailures = 0;
    private state: MeetingState;
    /**
     * Tail of the step queue. Every `step()` chains onto it, so concurrent
     * callers (an HTTP request and the run loop) are serialized rather than
     * racing for the same turn index.
     */
    private stepQueue: Promise<unknown> = Promise.resolve();

    constructor(options: MeetingOrchestratorOptions) {
        this.store = options.store;
        this.config = options.config;
        this.runtimes = options.runtimes;
        this.clock = options.clock ?? systemClock;
        this.maxConsecutiveFailures = options.maxConsecutiveFailures ?? 2;
        this.state = options.initialState ?? {
            meetingId: options.config.id,
            status: "scheduled",
            turnIndex: 0,
            nextSpeakerId: null,
        };
    }

    getState(): MeetingState {
        return { ...this.state };
    }

    on(listener: MeetingEventListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emit(type: MeetingEvent["type"], message?: ChannelMessage): void {
        const event: MeetingEvent = {
            type,
            meetingId: this.config.id,
            state: this.getState(),
            message,
            at: this.clock.iso(),
        };
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch {
                // Listener failures never abort a meeting.
            }
        }
    }

    private get completionMarker(): string {
        return this.config.completionMarker ?? DEFAULT_COMPLETION_MARKER;
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /** Posts the kickoff system message and moves to `running`. Idempotent. */
    async start(): Promise<MeetingState> {
        if (this.state.status !== "scheduled") return this.getState();

        const agenda =
            this.config.agenda.length > 0
                ? `\nAgenda:\n${this.config.agenda.map((a, i) => `${i + 1}. ${a}`).join("\n")}`
                : "";
        await this.store.append({
            channelId: this.config.channelId,
            author: { kind: "agent", id: "system", displayName: "Launchstack" },
            kind: "system",
            text: `*${this.config.title}* started.\nObjective: ${this.config.objective}${agenda}\nParticipants: ${this.config.participants
                .map(p => `${p.displayName} (@${p.id})`)
                .join(", ")}`,
            meta: { meetingId: this.config.id, event: "started" },
        });

        this.state = {
            ...this.state,
            status: "running",
            startedAt: this.clock.iso(),
            nextSpeakerId: this.peekNextSpeaker(await this.transcript())?.id ?? null,
        };
        this.emit("meeting.started");
        return this.getState();
    }

    /**
     * Advances exactly one agent turn. Returns without a message — and without
     * consuming a turn — when the meeting is paused, under human control, or
     * already finished.
     */
    async step(): Promise<MeetingStepResult> {
        const run = this.stepQueue.then(
            () => this.stepInner(),
            () => this.stepInner()
        );
        // Swallow on the queue tail only — the caller still sees the rejection.
        this.stepQueue = run.then(
            () => undefined,
            () => undefined
        );
        return run;
    }

    private async stepInner(): Promise<MeetingStepResult> {
        if (this.state.status === "scheduled") await this.start();

        if (this.state.status === "paused") {
            return { state: this.getState(), done: false, skipped: "paused" };
        }
        if (this.state.status === "human_control") {
            return { state: this.getState(), done: false, skipped: "human_control" };
        }
        if (this.state.status === "completed" || this.state.status === "failed") {
            return { state: this.getState(), done: true, skipped: "completed" };
        }
        if (this.state.turnIndex >= this.config.maxTurns) {
            await this.finish("max turns reached");
            return { state: this.getState(), done: true, skipped: "max_turns" };
        }

        const transcript = await this.transcript();
        const speaker = this.peekNextSpeaker(transcript);
        if (!speaker) {
            await this.finish("no eligible speaker");
            return { state: this.getState(), done: true, skipped: "no_speaker" };
        }

        const runtime = this.runtimeFor(speaker);
        if (!runtime) {
            this.state = {
                ...this.state,
                status: "failed",
                error: `No runtime serves persona "${speaker.id}" (node ${speaker.nodeId ?? "local"})`,
                endedAt: this.clock.iso(),
            };
            this.emit("meeting.failed");
            return { state: this.getState(), done: true };
        }

        let result: AgentTurnResult;
        try {
            result = await runtime.takeTurn({
                persona: speaker,
                context: this.turnContext(),
                transcript,
            });
            this.consecutiveFailures = 0;
        } catch (err) {
            this.consecutiveFailures++;
            const detail = err instanceof Error ? err.message : String(err);
            await this.store.append({
                channelId: this.config.channelId,
                author: { kind: "agent", id: "system", displayName: "Launchstack" },
                kind: "system",
                text: `@${speaker.id} could not respond (${detail}). ${
                    this.consecutiveFailures >= this.maxConsecutiveFailures
                        ? "Ending the meeting."
                        : "Passing the floor on."
                }`,
                meta: { meetingId: this.config.id, event: "turn_failed", personaId: speaker.id },
            });

            if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
                this.state = {
                    ...this.state,
                    status: "failed",
                    error: detail,
                    endedAt: this.clock.iso(),
                };
                this.emit("meeting.failed");
                return { state: this.getState(), done: true };
            }
            // Burn the turn so a persistently dead node cannot loop forever.
            this.state = { ...this.state, turnIndex: this.state.turnIndex + 1 };
            this.state = {
                ...this.state,
                nextSpeakerId: this.peekNextSpeaker(await this.transcript())?.id ?? null,
            };
            return { state: this.getState(), done: false };
        }

        const text = result.text.trim();
        const message = await this.store.append({
            channelId: this.config.channelId,
            author: { kind: "agent", id: speaker.id, displayName: speaker.displayName },
            text: text.length > 0 ? text : "(no comment)",
            kind: "chat",
            meta: {
                meetingId: this.config.id,
                turnIndex: this.state.turnIndex,
                addressedTo: result.addressedTo,
                ...result.meta,
            },
        });

        this.state = { ...this.state, turnIndex: this.state.turnIndex + 1 };

        if (result.proposesCompletion) {
            await this.finish("objective met", speaker.id);
            this.emit("meeting.turn", message);
            return { state: this.getState(), done: true, message };
        }

        if (this.state.turnIndex >= this.config.maxTurns) {
            await this.finish("max turns reached");
            this.emit("meeting.turn", message);
            return { state: this.getState(), done: true, message };
        }

        this.state = {
            ...this.state,
            nextSpeakerId: this.peekNextSpeaker(await this.transcript())?.id ?? null,
        };
        this.emit("meeting.turn", message);
        return { state: this.getState(), done: false, message };
    }

    /**
     * Runs turns until the meeting ends or `limit` turns have been taken.
     * Stops early — without error — when a human takes control or pauses it.
     */
    async run(
        options: { limit?: number; onStep?: (r: MeetingStepResult) => void } = {}
    ): Promise<MeetingState> {
        const limit = options.limit ?? this.config.maxTurns;
        for (let i = 0; i < limit; i++) {
            const result = await this.step();
            options.onStep?.(result);
            if (result.done) break;
            if (result.skipped === "paused" || result.skipped === "human_control") break;
        }
        return this.getState();
    }

    async pause(): Promise<MeetingState> {
        if (this.state.status !== "running") return this.getState();
        this.state = { ...this.state, status: "paused" };
        await this.systemNote("Meeting paused.");
        this.emit("meeting.paused");
        return this.getState();
    }

    async resume(): Promise<MeetingState> {
        if (this.state.status !== "paused" && this.state.status !== "human_control") {
            return this.getState();
        }
        this.state = { ...this.state, status: "running", controller: undefined };
        await this.systemNote("Agents resumed.");
        this.emit("meeting.resumed");
        return this.getState();
    }

    // -------------------------------------------------------------------------
    // Human control
    // -------------------------------------------------------------------------

    /**
     * A human takes the floor. Agent turns stop until `release()`. When
     * `asPersonaId` is given the human occupies that agent's seat and their
     * messages are attributed to both.
     */
    async takeOver(input: {
        humanId: string;
        displayName: string;
        asPersonaId?: string;
    }): Promise<MeetingState> {
        if (this.state.status === "completed" || this.state.status === "failed") {
            return this.getState();
        }
        if (input.asPersonaId && !this.config.participants.some(p => p.id === input.asPersonaId)) {
            throw new Error(`Unknown persona "${input.asPersonaId}"`);
        }

        this.state = {
            ...this.state,
            status: "human_control",
            controller: {
                humanId: input.humanId,
                displayName: input.displayName,
                asPersonaId: input.asPersonaId,
                since: this.clock.iso(),
            },
        };
        await this.systemNote(
            input.asPersonaId
                ? `${input.displayName} took over @${input.asPersonaId}. Agents are on hold.`
                : `${input.displayName} took the floor. Agents are on hold.`
        );
        this.emit("meeting.human_control");
        return this.getState();
    }

    /** Hands control back to the agents. */
    async release(): Promise<MeetingState> {
        if (this.state.status !== "human_control") return this.getState();
        const who = this.state.controller?.displayName ?? "The facilitator";
        this.state = { ...this.state, status: "running", controller: undefined };
        await this.systemNote(`${who} handed control back to the agents.`);
        this.emit("meeting.human_released");
        return this.getState();
    }

    /**
     * Posts a human message into the channel. Allowed in *any* non-terminal
     * state — a human can chime in without taking over, exactly as they would
     * in a real Slack channel.
     */
    async postHumanMessage(input: {
        humanId: string;
        displayName: string;
        text: string;
        asPersonaId?: string;
        threadId?: string;
        /**
         * Set when the message arrived *from* Slack. Carrying it through is what
         * stops the Slack bridge mirroring the message straight back and showing
         * the human their own words twice.
         */
        slackTs?: string;
        meta?: Record<string, unknown>;
    }): Promise<ChannelMessage> {
        if (this.state.status === "completed" || this.state.status === "failed") {
            throw new Error("Meeting has ended");
        }
        const asPersonaId = input.asPersonaId ?? this.state.controller?.asPersonaId;
        const message = await this.store.append({
            channelId: this.config.channelId,
            author: {
                kind: "human",
                id: input.humanId,
                displayName: input.displayName,
                onBehalfOfPersonaId: asPersonaId,
            },
            text: input.text,
            kind: "chat",
            threadId: input.threadId,
            slackTs: input.slackTs,
            meta: { ...input.meta, meetingId: this.config.id, humanIntervention: true },
        });

        // A human speaking through a seat consumes that seat's turn, so the
        // rotation keeps advancing instead of handing the floor straight back.
        if (asPersonaId) {
            this.state = { ...this.state, turnIndex: this.state.turnIndex + 1 };
        }
        this.state = {
            ...this.state,
            nextSpeakerId: this.peekNextSpeaker(await this.transcript())?.id ?? null,
        };
        this.emit("meeting.human_message", message);
        return message;
    }

    /**
     * Ends the meeting deliberately (facilitator "wrap it up"). Distinct from
     * `failed` — the transcript is still usable minutes.
     */
    async complete(reason = "closed by facilitator"): Promise<MeetingState> {
        if (this.state.status === "completed" || this.state.status === "failed") {
            return this.getState();
        }
        await this.finish(reason);
        return this.getState();
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    private async finish(reason: string, byPersonaId?: string): Promise<void> {
        this.state = {
            ...this.state,
            status: "completed",
            nextSpeakerId: null,
            endedAt: this.clock.iso(),
            controller: undefined,
        };
        await this.store.append({
            channelId: this.config.channelId,
            author: { kind: "agent", id: "system", displayName: "Launchstack" },
            kind: "system",
            text: `Meeting ended — ${reason}${byPersonaId ? ` (@${byPersonaId})` : ""}. ${this.state.turnIndex} turn${
                this.state.turnIndex === 1 ? "" : "s"
            } taken.`,
            meta: { meetingId: this.config.id, event: "completed", reason },
        });
        this.emit("meeting.completed");
    }

    private async systemNote(text: string): Promise<void> {
        await this.store.append({
            channelId: this.config.channelId,
            author: { kind: "agent", id: "system", displayName: "Launchstack" },
            kind: "system",
            text,
            meta: { meetingId: this.config.id },
        });
    }

    private async transcript(): Promise<ChannelMessage[]> {
        return this.store.read(this.config.channelId);
    }

    private peekNextSpeaker(transcript: ChannelMessage[]): AgentPersona | null {
        return selectNextSpeaker({
            participants: this.config.participants,
            transcript,
            turnIndex: this.state.turnIndex,
            policy: this.config.turnPolicy,
        });
    }

    private runtimeFor(persona: AgentPersona): AgentRuntime | null {
        return this.runtimes.find(r => r.serves(persona)) ?? null;
    }

    private turnContext(): TurnContext {
        return {
            meetingId: this.config.id,
            title: this.config.title,
            objective: this.config.objective,
            agenda: this.config.agenda,
            context: this.config.context ?? [],
            roster: this.config.participants.map(p => ({
                id: p.id,
                displayName: p.displayName,
                role: p.role,
            })),
            turnIndex: this.state.turnIndex,
            maxTurns: this.config.maxTurns,
            completionMarker: this.completionMarker,
        };
    }
}
