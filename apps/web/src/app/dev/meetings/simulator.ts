/**
 * A browser-side stand-in for `/api/collab/**` and the chat query route, so
 * the Agents app and the Meetings dashboard can be looked at — and driven —
 * without a session or a model.
 *
 * The meeting simulation walks phases the way the engine does (a pure
 * function of the turn index) and speaks from a small script per agent, so
 * the transcript, the plan panel and the minutes all have something to show.
 */

import { parseAgentFile } from "~/lib/agents/agent-file";
import { starterDefinition } from "~/lib/agents/starter-agents";
import { resolveChatTurn } from "~/lib/agents/definition";
import { STARTER_AGENTS } from "~/lib/agents/starter-agents";
import type {
    AgentPersonaRecord,
    ChannelMessage,
    MeetingPhase,
    MeetingState,
} from "~/app/employer/documents/_workspace/collab/types";

interface SimMeeting {
    id: string;
    title: string;
    objective: string;
    agenda: string[];
    participants: AgentPersonaRecord[];
    turnPolicy: { kind: string; moderatorId?: string };
    maxTurns: number;
    phases: MeetingPhase[];
    workflowKey: string | null;
    workflowTitle: string | null;
    channelId: string;
    channelSlug: string;
    createdAt: string;
    state: MeetingState;
    messages: ChannelMessage[];
    cursors: Record<string, number>;
}

const LINES: Record<string, string[]> = {
    facilitator: [
        "Let's open. The objective is on the table; I'll keep us to it. @analyst, what do the sources actually say?",
        "Good. @critic, what's the strongest objection to what we've heard?",
        "Decision: we'll go with the option the room converged on. @engineer owns the rollout, @finance confirms the numbers by Friday.",
        "That closes it. MEETING_COMPLETE",
    ],
    analyst: [
        "From the Q2 pack: margin is 42%, list price unchanged for four quarters, and the Tier B model recovers to 44% within a quarter (p. 3). Nothing in the sources contradicts that.",
        "One caveat: the churn figure in the board deck is from March; I'd treat it as directional.",
    ],
    engineer: [
        "Two sprints for usage-based metering; the billing migration is the long pole and needs a rollback plan. I'll own the migration.",
        "Rollout is mine. Nothing else blocks us.",
    ],
    finance: [
        "The change costs roughly one quarter of margin dip before recovery; cash stays positive throughout. I'll take the model refresh.",
        "Numbers confirmed against the Tier B sheet.",
    ],
    critic: [
        "The assumption everyone skipped: that existing customers accept the new tiers without a discount. If a third negotiate, the recovery slips two quarters.",
        "Conceded on the model; I'd still add a churn trigger to the rollout.",
    ],
    counsel: [
        "Exposure sits in clause 7.2 — notice period on price changes is 60 days, so timing has to respect it.",
    ],
    product: [
        "Restating in the customer's words: they want predictable bills. Package the change as a cap, not a meter, and ship the smallest slice first.",
    ],
    marketing: [
        "The sentence a customer repeats: 'Same product, a bill you can predict.' LinkedIn and the changelog, not a launch.",
    ],
    sales: [
        "Three open deals asked about caps this month; two objected to overage. Pricing this way helps me close both.",
    ],
    support: [
        "Tickets say 'surprise invoice' 14 times this quarter. On day one, customers will look for the cap in settings — put it there.",
    ],
};

/** A string field of a loosely typed request body, or the fallback. */
function str(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}

function phaseAt(phases: MeetingPhase[], turnIndex: number) {
    let start = 0;
    for (let index = 0; index < phases.length; index++) {
        const turns = Math.max(1, phases[index]!.turns);
        if (turnIndex < start + turns || index === phases.length - 1) {
            return { index, phase: phases[index]!, offset: turnIndex - start };
        }
        start += turns;
    }
    return null;
}

export class CollabSimulator {
    personas: AgentPersonaRecord[];
    meetings = new Map<string, SimMeeting>();
    private seq = 0;

    constructor() {
        this.personas = STARTER_AGENTS.map(starterDefinition).map((agent, index) => ({
            dbId: `persona_${index}`,
            id: agent.key,
            displayName: agent.displayName,
            role: agent.role,
            systemPrompt: agent.systemPrompt,
            description: agent.description,
            mode: agent.mode,
            tools: agent.tools,
            style: agent.style,
            route: agent.route,
            temperature: agent.temperature ?? undefined,
            maxTurnChars: agent.maxTurnChars ?? undefined,
            accent: agent.accent,
            avatarUrl: agent.avatarUrl,
            autonomy: agent.autonomy,
            nodeId: null,
            archived: false,
            builtin: true,
        }));
    }

    private id(prefix: string): string {
        this.seq += 1;
        return `${prefix}_${this.seq}`;
    }

    agentsPayload(includeArchived: boolean) {
        return {
            personas: includeArchived ? this.personas : this.personas.filter(p => !p.archived),
            nodes: [],
            defaults: { autonomy: "full" },
            network: { enabled: false, hubId: null, hubPath: "/api/collab/hub" },
            slack: { canPost: false, canReceive: false, missing: ["SLACK_BOT_TOKEN"] },
        };
    }

    createPersona(
        input: Record<string, unknown>
    ): AgentPersonaRecord | { error: string; status: number } {
        const key = str(input.key);
        if (this.personas.some(p => p.id === key)) {
            return { error: `An agent with the handle "${key}" already exists`, status: 409 };
        }
        const persona: AgentPersonaRecord = {
            dbId: this.id("persona"),
            id: key,
            displayName: str(input.displayName, key),
            role: str(input.role),
            systemPrompt: str(input.systemPrompt),
            description: typeof input.description === "string" ? input.description : "",
            mode: (input.mode as AgentPersonaRecord["mode"]) ?? "all",
            tools: (input.tools as AgentPersonaRecord["tools"]) ?? null,
            style: (input.style as AgentPersonaRecord["style"]) ?? null,
            route: (input.route as string | null) ?? null,
            temperature: typeof input.temperature === "number" ? input.temperature : undefined,
            maxTurnChars: typeof input.maxTurnChars === "number" ? input.maxTurnChars : undefined,
            accent: (input.accent as string | null) ?? null,
            avatarUrl: (input.avatarUrl as string | null) ?? null,
            autonomy: (input.autonomy as AgentPersonaRecord["autonomy"]) ?? null,
            nodeId: (input.nodeId as string | null) ?? null,
            archived: false,
            builtin: false,
        };
        this.personas.push(persona);
        return persona;
    }

    updatePersona(dbId: string, patch: Record<string, unknown>): AgentPersonaRecord | null {
        const persona = this.personas.find(p => p.dbId === dbId);
        if (!persona) return null;
        Object.assign(persona, {
            ...(patch.key !== undefined ? { id: patch.key } : {}),
            ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
            ...(patch.role !== undefined ? { role: patch.role } : {}),
            ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
            ...(patch.description !== undefined ? { description: patch.description ?? "" } : {}),
            ...(patch.mode !== undefined ? { mode: patch.mode ?? "all" } : {}),
            ...(patch.tools !== undefined ? { tools: patch.tools } : {}),
            ...(patch.style !== undefined ? { style: patch.style } : {}),
            ...(patch.route !== undefined ? { route: patch.route } : {}),
            ...(patch.temperature !== undefined
                ? { temperature: patch.temperature ?? undefined }
                : {}),
            ...(patch.accent !== undefined ? { accent: patch.accent } : {}),
            ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
            ...(patch.autonomy !== undefined ? { autonomy: patch.autonomy } : {}),
            ...(patch.nodeId !== undefined ? { nodeId: patch.nodeId } : {}),
            ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
        });
        return persona;
    }

    resetPersona(dbId: string): AgentPersonaRecord | null {
        const persona = this.personas.find(p => p.dbId === dbId);
        const starter = persona && STARTER_AGENTS.find(a => a.key === persona.id);
        if (!persona || !starter) return null;
        Object.assign(persona, {
            displayName: starter.displayName,
            role: starter.role,
            systemPrompt: starter.systemPrompt,
            description: starter.description,
            mode: starter.mode,
            tools: starter.tools,
            style: starter.style,
            route: starter.route,
            temperature: starter.temperature ?? undefined,
            accent: starter.accent,
            avatarUrl: starter.avatarUrl,
            archived: false,
        });
        return persona;
    }

    importPersona(file: string, replace: boolean) {
        const { definition, unknownKeys } = parseAgentFile(file);
        const existing = this.personas.find(p => p.id === definition.key);
        if (existing && !replace) {
            return {
                status: 409,
                body: {
                    error: `An agent with the handle "${definition.key}" already exists`,
                    conflict: { dbId: existing.dbId, displayName: existing.displayName },
                },
            };
        }
        const fields = { ...definition, key: definition.key } as unknown as Record<string, unknown>;
        const persona = existing
            ? this.updatePersona(existing.dbId, { ...fields, archived: false })
            : this.createPersona(fields);
        return {
            status: existing ? 200 : 201,
            body: { persona, replaced: Boolean(existing), unknownKeys },
        };
    }

    // ------------------------------------------------------------------ meetings

    createMeeting(input: Record<string, unknown>): SimMeeting {
        const keys = (input.participantKeys as string[]) ?? [];
        const participants = keys
            .map(key => this.personas.find(p => p.id === key))
            .filter((p): p is AgentPersonaRecord => Boolean(p));
        const phases = ((input.phases as MeetingPhase[] | undefined) ?? []).map(p => ({ ...p }));
        const slug = str(input.title, "meeting")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        const meeting: SimMeeting = {
            id: this.id("mtg"),
            title: str(input.title, "Meeting"),
            objective: str(input.objective),
            agenda: (input.agenda as string[]) ?? [],
            participants,
            turnPolicy: {
                kind: str(input.turnPolicy, "round_robin"),
                moderatorId: input.moderatorKey as string | undefined,
            },
            maxTurns: Number(input.maxTurns ?? 10),
            phases,
            workflowKey: (input.workflowKey as string) ?? null,
            workflowTitle: null,
            channelId: this.id("chan"),
            channelSlug: slug,
            createdAt: new Date().toISOString(),
            state: { meetingId: "", status: "scheduled", turnIndex: 0, nextSpeakerId: null },
            messages: [],
            cursors: {},
        };
        meeting.state.meetingId = meeting.id;
        this.meetings.set(meeting.id, meeting);
        if (input.autoStart) this.start(meeting);
        return meeting;
    }

    private append(
        meeting: SimMeeting,
        input: Omit<ChannelMessage, "id" | "channelId" | "seq" | "ts">
    ): ChannelMessage {
        const message: ChannelMessage = {
            id: this.id("msg"),
            channelId: meeting.channelId,
            seq: meeting.messages.length + 1,
            ts: new Date().toISOString(),
            ...input,
        };
        meeting.messages.push(message);
        return message;
    }

    private system(meeting: SimMeeting, text: string, meta: Record<string, unknown> = {}) {
        this.append(meeting, {
            author: { kind: "agent", id: "system", displayName: "Launchstack" },
            kind: "system",
            text,
            meta: { meetingId: meeting.id, ...meta },
        });
    }

    private announcePhase(meeting: SimMeeting, index: number) {
        const phase = meeting.phases[index];
        if (!phase) return;
        const speakers = phase.speakerIds?.length
            ? ` Speaking: ${phase.speakerIds.map(id => `@${id}`).join(", ")}.`
            : "";
        this.system(
            meeting,
            `Phase ${index + 1} of ${meeting.phases.length} — ${phase.title}: ${phase.goal}${speakers}`,
            { event: "phase", phaseIndex: index }
        );
    }

    private eligible(meeting: SimMeeting) {
        const position = phaseAt(meeting.phases, meeting.state.turnIndex);
        const speakers = position?.phase.speakerIds;
        const subset = speakers?.length
            ? meeting.participants.filter(p => speakers.includes(p.id))
            : meeting.participants;
        const room = subset.length > 0 ? subset : meeting.participants;
        const offset = position ? position.offset : meeting.state.turnIndex;
        return room[offset % room.length] ?? null;
    }

    start(meeting: SimMeeting) {
        if (meeting.state.status !== "scheduled") return;
        const agenda = meeting.agenda.length
            ? `\nAgenda:\n${meeting.agenda.map((a, i) => `${i + 1}. ${a}`).join("\n")}`
            : "";
        this.system(
            meeting,
            `*${meeting.title}* started.\nObjective: ${meeting.objective}${agenda}\nParticipants: ${meeting.participants.map(p => `${p.displayName} (@${p.id})`).join(", ")}`,
            { event: "started" }
        );
        const opening = phaseAt(meeting.phases, 0);
        if (opening) this.announcePhase(meeting, opening.index);
        meeting.state = {
            ...meeting.state,
            status: "running",
            startedAt: new Date().toISOString(),
            phaseIndex: opening?.index,
            nextSpeakerId: this.eligible(meeting)?.id ?? null,
        };
    }

    step(meeting: SimMeeting): boolean {
        if (meeting.state.status === "scheduled") this.start(meeting);
        if (meeting.state.status !== "running") return false;
        if (meeting.state.turnIndex >= meeting.maxTurns) {
            this.finish(meeting, "max turns reached");
            return false;
        }
        const speaker = this.eligible(meeting);
        if (!speaker) {
            this.finish(meeting, "no eligible speaker");
            return false;
        }
        const lines = LINES[speaker.id] ?? [
            `${speaker.displayName} weighs in from the ${speaker.role.toLowerCase()} seat.`,
        ];
        const cursor = meeting.cursors[speaker.id] ?? 0;
        meeting.cursors[speaker.id] = cursor + 1;
        const raw = lines[Math.min(cursor, lines.length - 1)]!;
        const done = raw.includes("MEETING_COMPLETE");
        const text = raw.replace("MEETING_COMPLETE", "").trim();
        this.append(meeting, {
            author: { kind: "agent", id: speaker.id, displayName: speaker.displayName },
            kind: "chat",
            text,
            meta: {
                meetingId: meeting.id,
                turnIndex: meeting.state.turnIndex,
                servedByNode: "local",
                latencyMs: 420,
            },
        });
        meeting.state = { ...meeting.state, turnIndex: meeting.state.turnIndex + 1 };
        if (done) {
            this.finish(meeting, "objective met", speaker.id);
            return false;
        }
        if (meeting.state.turnIndex >= meeting.maxTurns) {
            this.finish(meeting, "max turns reached");
            return false;
        }
        const position = phaseAt(meeting.phases, meeting.state.turnIndex);
        if (position && position.index !== meeting.state.phaseIndex) {
            this.announcePhase(meeting, position.index);
            meeting.state = { ...meeting.state, phaseIndex: position.index };
        }
        meeting.state = { ...meeting.state, nextSpeakerId: this.eligible(meeting)?.id ?? null };
        return true;
    }

    finish(meeting: SimMeeting, reason: string, by?: string) {
        meeting.state = {
            ...meeting.state,
            status: "completed",
            nextSpeakerId: null,
            endedAt: new Date().toISOString(),
            controller: undefined,
        };
        this.system(
            meeting,
            `Meeting ended — ${reason}${by ? ` (@${by})` : ""}. ${meeting.state.turnIndex} turns taken.`,
            { event: "completed", reason }
        );
    }

    control(
        meeting: SimMeeting,
        action: string,
        options: { limit?: number; asPersonaId?: string; reason?: string }
    ) {
        switch (action) {
            case "start":
                this.start(meeting);
                break;
            case "step":
                this.step(meeting);
                break;
            case "run":
                for (let i = 0; i < (options.limit ?? 3); i++) if (!this.step(meeting)) break;
                break;
            case "pause":
                if (meeting.state.status === "running") {
                    meeting.state = { ...meeting.state, status: "paused" };
                    this.system(meeting, "Meeting paused.");
                }
                break;
            case "resume":
                if (meeting.state.status === "paused" || meeting.state.status === "human_control") {
                    meeting.state = { ...meeting.state, status: "running", controller: undefined };
                    this.system(meeting, "Agents resumed.");
                }
                break;
            case "takeover":
                meeting.state = {
                    ...meeting.state,
                    status: "human_control",
                    controller: {
                        humanId: "you",
                        displayName: "You",
                        asPersonaId: options.asPersonaId,
                        since: new Date().toISOString(),
                    },
                };
                this.system(meeting, "You took the floor. Agents are on hold.");
                break;
            case "release":
                meeting.state = { ...meeting.state, status: "running", controller: undefined };
                this.system(meeting, "You handed control back to the agents.");
                break;
            case "complete":
                this.finish(meeting, options.reason ?? "closed by facilitator");
                break;
        }
        return meeting.state;
    }

    postHuman(meeting: SimMeeting, text: string, asPersonaId?: string) {
        const message = this.append(meeting, {
            author: {
                kind: "human",
                id: "you",
                displayName: "You",
                onBehalfOfPersonaId: asPersonaId,
            },
            kind: "chat",
            text,
            meta: { meetingId: meeting.id, humanIntervention: true },
        });
        if (asPersonaId)
            meeting.state = { ...meeting.state, turnIndex: meeting.state.turnIndex + 1 };
        meeting.state = { ...meeting.state, nextSpeakerId: this.eligible(meeting)?.id ?? null };
        return message;
    }

    minutes(meeting: SimMeeting) {
        const chat = meeting.messages.filter(m => m.kind === "chat");
        const decisions = chat
            .filter(m => /decision:|we'll go with/i.test(m.text))
            .map(m => ({ text: m.text, sourceSeq: m.seq, author: m.author.displayName }));
        const actionItems = chat
            .filter(m => /i'll (own|take)|owns the/i.test(m.text))
            .map(m => ({
                text: m.text,
                owner: m.author.kind === "agent" ? m.author.id : undefined,
                sourceSeq: m.seq,
            }));
        return {
            meetingId: meeting.id,
            title: meeting.title,
            objective: meeting.objective,
            status: meeting.state.status,
            turnsTaken: meeting.state.turnIndex,
            participants: meeting.participants.map(p => ({
                id: p.id,
                displayName: p.displayName,
                role: p.role,
                messages: chat.filter(m => m.author.id === p.id).length,
            })),
            decisions,
            actionItems,
            summary: chat
                .slice(0, 3)
                .map(m => `• ${m.text.slice(0, 120)}`)
                .join("\n"),
            humanInterventions: chat.filter(m => m.author.kind === "human").length,
        };
    }

    summary(meeting: SimMeeting) {
        return {
            id: meeting.id,
            title: meeting.title,
            objective: meeting.objective,
            status: meeting.state.status,
            turnIndex: meeting.state.turnIndex,
            maxTurns: meeting.maxTurns,
            channelId: meeting.channelId,
            channelSlug: meeting.channelSlug,
            participants: meeting.participants.map(p => ({
                id: p.id,
                displayName: p.displayName,
                role: p.role,
                nodeId: null,
                accent: p.accent ?? null,
                avatarUrl: p.avatarUrl ?? null,
            })),
            workflowKey: meeting.workflowKey,
            workflowTitle: meeting.workflowTitle,
            phases: meeting.phases.map(p => ({ id: p.id, title: p.title, turns: p.turns })),
            slackChannelId: null,
            slackMirrorEnabled: false,
            createdAt: meeting.createdAt,
            startedAt: meeting.state.startedAt ?? null,
            endedAt: meeting.state.endedAt ?? null,
        };
    }

    detail(meeting: SimMeeting, afterSeq: number) {
        return {
            meeting: {
                id: meeting.id,
                title: meeting.title,
                objective: meeting.objective,
                agenda: meeting.agenda,
                participants: meeting.participants,
                turnPolicy: meeting.turnPolicy,
                maxTurns: meeting.maxTurns,
                phases: meeting.phases,
                workflowKey: meeting.workflowKey,
                workflowTitle: meeting.workflowTitle,
                channelId: meeting.channelId,
                channelSlug: meeting.channelSlug,
                slack: null,
                createdAt: meeting.createdAt,
            },
            state: meeting.state,
            messages: meeting.messages.filter(m => m.seq > afterSeq),
            latestSeq: meeting.messages.length,
            minutes: this.minutes(meeting),
        };
    }

    /** The chat route, answered by the agent's first scripted line. */
    chat(body: {
        question: string;
        agentKey?: string | null;
        enableWebSearch?: boolean;
        thinkingMode?: boolean;
    }) {
        const persona = body.agentKey ? this.personas.find(p => p.id === body.agentKey) : null;
        if (body.agentKey && !persona)
            return {
                status: 404,
                body: {
                    success: false,
                    message: `No agent with the handle "@${body.agentKey}" in this workspace`,
                },
            };
        const turn = persona
            ? resolveChatTurn(
                  { tools: persona.tools, route: null, style: persona.style, temperature: null },
                  {
                      webSearch: Boolean(body.enableWebSearch),
                      thinking: Boolean(body.thinkingMode),
                      hasAttachments: false,
                  }
              )
            : null;
        const line = persona
            ? (LINES[persona.id]?.[0] ?? `${persona.displayName} here.`)
            : "Here is what your sources say about that (p. 3).";
        return {
            status: 200,
            body: {
                success: true,
                summarizedAnswer: `${line}\n\nYou asked: "${body.question}"`,
                references: [],
                chunksAnalyzed: 4,
                tokenUsage: { inputTokens: 900, outputTokens: 160, totalTokens: 1060 },
                aiModel: "preview-model",
                agent: persona
                    ? {
                          key: persona.id,
                          displayName: persona.displayName,
                          role: persona.role,
                          accent: persona.accent ?? null,
                          avatarUrl: persona.avatarUrl ?? null,
                          notes: turn?.notes ?? [],
                      }
                    : null,
            },
        };
    }
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

/** Installs the stub on `window.fetch`; returns the restore function. */
export function installCollabStub(
    sim: CollabSimulator,
    options: { seedMeetings?: boolean } = {}
): () => void {
    const original = window.fetch.bind(window);
    if (options.seedMeetings && sim.meetings.size === 0) {
        const done = sim.createMeeting({
            title: "Q3 pricing review",
            objective: "Agree a Q3 price change and name who ships it",
            agenda: ["Current margin", "Proposed change", "Owner and timing"],
            participantKeys: ["facilitator", "finance", "sales", "product", "engineer"],
            turnPolicy: "moderated",
            moderatorKey: "facilitator",
            maxTurns: 9,
            workflowKey: "pricing-review",
            phases: [
                {
                    id: "numbers",
                    title: "The numbers",
                    goal: "Current margin, price history and what the change does to both.",
                    turns: 2,
                    speakerIds: ["facilitator", "finance"],
                },
                {
                    id: "market",
                    title: "The market",
                    goal: "What buyers asked for and what the change does to open deals.",
                    turns: 3,
                    speakerIds: ["facilitator", "sales", "product"],
                },
                {
                    id: "deliver",
                    title: "Delivery",
                    goal: "What it costs to build and ship.",
                    turns: 1,
                    speakerIds: ["facilitator", "engineer"],
                },
                {
                    id: "decide",
                    title: "Decide",
                    goal: "One change, one owner, one date.",
                    turns: 3,
                },
            ],
            autoStart: true,
        });
        done.workflowTitle = "Pricing review";
        sim.control(done, "run", { limit: 9 });
        const live = sim.createMeeting({
            title: "PickBot v3 pre-mortem",
            objective: "Find the ways the v3 launch fails and assign a mitigation to each",
            agenda: ["The plan", "How it failed", "Mitigations"],
            participantKeys: ["facilitator", "engineer", "finance", "sales", "critic"],
            turnPolicy: "moderated",
            moderatorKey: "facilitator",
            maxTurns: 11,
            workflowKey: "premortem",
            phases: [
                {
                    id: "imagine",
                    title: "Imagine the failure",
                    goal: "Each of you: say how it failed, from your seat.",
                    turns: 5,
                },
                {
                    id: "rank",
                    title: "Rank the causes",
                    goal: "Agree the top three.",
                    turns: 3,
                    speakerIds: ["facilitator", "critic", "finance"],
                },
                {
                    id: "mitigate",
                    title: "Mitigate",
                    goal: "One mitigation per cause, with an owner.",
                    turns: 3,
                },
            ],
            autoStart: true,
        });
        live.workflowTitle = "Pre-mortem";
        sim.control(live, "run", { limit: 4 });
    }

    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = (init?.method ?? "GET").toUpperCase();
        const body =
            typeof init?.body === "string"
                ? (JSON.parse(init.body) as Record<string, unknown>)
                : {};
        await new Promise(resolve => setTimeout(resolve, 120));

        if (url.startsWith("/api/config/ai-models")) {
            return json({
                routes: {
                    default: { available: true, model: "preview" },
                    fast: { available: true, model: "preview" },
                    reasoning: {
                        available: true,
                        model: "preview",
                        reasoning: { mode: "toggle", controllable: true },
                    },
                    vision: { available: false },
                },
            });
        }
        if (url.startsWith("/api/agents/documentQ&A/AIChat/query")) {
            const result = sim.chat(body as { question: string; agentKey?: string | null });
            return json(result.body, result.status);
        }
        if (url.startsWith("/api/collab/agents/import")) {
            try {
                const result = sim.importPersona(String(body.file), Boolean(body.replace));
                return json(result.body, result.status);
            } catch (err) {
                return json(
                    { error: err instanceof Error ? err.message : "Could not read that file" },
                    400
                );
            }
        }
        const personaMatch = /^\/api\/collab\/agents\/([^/?]+)(?:\/(reset|file))?/.exec(url);
        if (personaMatch) {
            const [, dbId, sub] = personaMatch;
            if (sub === "reset") {
                const persona = sim.resetPersona(dbId!);
                return persona ? json({ persona }) : json({ error: "Not a starter agent" }, 409);
            }
            if (sub === "file")
                return new Response("---\nname: preview\n---\nPreview.", {
                    headers: { "Content-Type": "text/markdown" },
                });
            if (method === "PATCH") {
                const persona = sim.updatePersona(dbId!, body);
                return persona ? json({ persona }) : json({ error: "Agent not found" }, 404);
            }
            if (method === "DELETE") {
                const persona = sim.updatePersona(dbId!, { archived: true });
                return persona
                    ? json({ persona, archived: true })
                    : json({ error: "Agent not found" }, 404);
            }
            const persona = sim.personas.find(p => p.dbId === dbId);
            return persona ? json({ persona }) : json({ error: "Agent not found" }, 404);
        }
        if (url.startsWith("/api/collab/agents")) {
            if (method === "POST") {
                const result = sim.createPersona(body);
                return "error" in result
                    ? json({ error: result.error }, result.status)
                    : json({ persona: result }, 201);
            }
            return json(sim.agentsPayload(url.includes("archived=1")));
        }
        const meetingMatch =
            /^\/api\/collab\/meetings\/([^/?]+)(?:\/(control|messages))?(?:\?afterSeq=(\d+))?/.exec(
                url
            );
        if (meetingMatch) {
            const [, id, sub, after] = meetingMatch;
            const meeting = sim.meetings.get(id!);
            if (!meeting) return json({ error: "Meeting not found" }, 404);
            if (sub === "control") {
                const state = sim.control(meeting, String(body.action), body as { limit?: number });
                return json({ state });
            }
            if (sub === "messages") {
                const message = sim.postHuman(
                    meeting,
                    String(body.text),
                    body.asPersonaId as string | undefined
                );
                return json({ message, state: meeting.state }, 201);
            }
            return json(sim.detail(meeting, Number(after ?? 0)));
        }
        if (url.startsWith("/api/collab/meetings")) {
            if (method === "POST") {
                const meeting = sim.createMeeting(body);
                return json(
                    {
                        meeting: {
                            id: meeting.id,
                            channelId: meeting.channelId,
                            title: meeting.title,
                            objective: meeting.objective,
                            state: meeting.state,
                        },
                    },
                    201
                );
            }
            const meetings = [...sim.meetings.values()]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map(m => sim.summary(m));
            return json({ meetings });
        }
        if (url.startsWith("/api/")) return json({ error: `No stub for ${method} ${url}` }, 404);
        return original(input, init);
    }) as typeof window.fetch;

    return () => {
        window.fetch = original;
    };
}
