/**
 * Phases — the workflow inside a meeting.
 *
 * Scripted agents, so what is under test is the engine: who may speak in
 * which phase, that the rotation restarts per phase, that the change is
 * announced in the channel, and that a meeting without phases is untouched.
 */

import {
    createMeeting,
    fixedClock,
    InMemoryChannelStore,
    phaseAt,
    phaseParticipants,
    phasePlanProblems,
    ScriptedAgentRuntime,
    sequentialIdFactory,
    type AgentPersona,
    type MeetingPhase,
} from "@launchstack/collab";

const CHAIR: AgentPersona = {
    id: "chair",
    displayName: "Ada",
    role: "Facilitator",
    systemPrompt: "",
};
const ANALYST: AgentPersona = {
    id: "analyst",
    displayName: "Ravi",
    role: "Analyst",
    systemPrompt: "",
};
const CRITIC: AgentPersona = {
    id: "critic",
    displayName: "Vera",
    role: "Critic",
    systemPrompt: "",
};

const PHASES: MeetingPhase[] = [
    { id: "frame", title: "Frame", goal: "State the question.", turns: 1, speakerIds: ["chair"] },
    {
        id: "analyse",
        title: "Analyse",
        goal: "Build the case.",
        turns: 2,
        speakerIds: ["chair", "analyst"],
    },
    { id: "challenge", title: "Challenge", goal: "Attack it.", turns: 1, speakerIds: ["critic"] },
    { id: "decide", title: "Decide", goal: "Land it.", turns: 2 },
];

describe("phaseAt", () => {
    it("maps turn indexes onto phases and keeps overflow in the last one", () => {
        expect(phaseAt(PHASES, 0)).toMatchObject({ index: 0, offset: 0, last: false });
        expect(phaseAt(PHASES, 1)).toMatchObject({ index: 1, offset: 0 });
        expect(phaseAt(PHASES, 2)).toMatchObject({ index: 1, offset: 1 });
        expect(phaseAt(PHASES, 3)).toMatchObject({ index: 2, offset: 0 });
        expect(phaseAt(PHASES, 5)).toMatchObject({ index: 3, offset: 1, last: true });
        expect(phaseAt(PHASES, 40)).toMatchObject({ index: 3, offset: 36, last: true });
        expect(phaseAt([], 0)).toBeNull();
        expect(phaseAt(undefined, 3)).toBeNull();
    });

    it("narrows the room to the phase's speakers, falling back to everyone", () => {
        const room = [CHAIR, ANALYST, CRITIC];
        expect(phaseParticipants(room, PHASES[2]).map(p => p.id)).toEqual(["critic"]);
        expect(phaseParticipants(room, PHASES[3]).map(p => p.id)).toEqual([
            "chair",
            "analyst",
            "critic",
        ]);
        expect(
            phaseParticipants(room, {
                id: "x",
                title: "x",
                goal: "x",
                turns: 1,
                speakerIds: ["nobody"],
            }).map(p => p.id)
        ).toEqual(["chair", "analyst", "critic"]);
    });

    it("names what is wrong with a plan", () => {
        expect(phasePlanProblems(PHASES, [CHAIR, ANALYST, CRITIC])).toEqual([]);
        const problems = phasePlanProblems(
            [
                { id: "a", title: "", goal: "g", turns: 0 },
                { id: "b", title: "Ghosts", goal: "g", turns: 1, speakerIds: ["nobody"] },
            ],
            [CHAIR]
        );
        expect(problems).toHaveLength(3);
        expect(problems.join(" ")).toMatch(/title/);
        expect(problems.join(" ")).toMatch(/not in the room/);
    });
});

describe("a meeting with phases", () => {
    async function run() {
        const clock = fixedClock(1_700_000_000_000, 1_000);
        const store = new InMemoryChannelStore(clock, sequentialIdFactory());
        const script = {
            chair: ["Framing.", "Chair in analyse.", "Chair decides.", "Chair again."],
            analyst: ["Analyst analyses.", "Analyst decides."],
            critic: ["Critic attacks.", "Critic decides."],
        };
        const meeting = await createMeeting({
            store,
            workspaceId: "ws",
            title: "Decision",
            objective: "Decide",
            participants: [CHAIR, ANALYST, CRITIC],
            runtimes: [new ScriptedAgentRuntime(script)],
            turnPolicy: { kind: "round_robin" },
            maxTurns: 6,
            phases: PHASES,
            workflowKey: "decision-review",
            clock,
        });
        return { ...meeting, store };
    }

    it("lets only the phase's speakers talk and restarts the rotation per phase", async () => {
        const { orchestrator, store, config } = await run();
        await orchestrator.run();
        const transcript = await store.read(config.channelId);
        const speakers = transcript.filter(m => m.kind === "chat").map(m => m.author.id);
        // frame: chair · analyse: chair, analyst · challenge: critic · decide: chair, analyst
        expect(speakers).toEqual(["chair", "chair", "analyst", "critic", "chair", "analyst"]);
        expect(orchestrator.getState().status).toBe("completed");
    });

    it("announces every phase change in the channel, as a system message", async () => {
        const { orchestrator, store, config } = await run();
        await orchestrator.run();
        const notes = (await store.read(config.channelId)).filter(m => m.meta?.event === "phase");
        expect(notes.map(m => m.meta?.phaseIndex)).toEqual([0, 1, 2, 3]);
        expect(notes[1]!.text).toContain("Phase 2 of 4 — Analyse");
        expect(notes[1]!.text).toContain("@chair, @analyst");
        expect(orchestrator.getState().phaseIndex).toBe(3);
    });

    it("reports the phase index as the meeting advances", async () => {
        const { orchestrator } = await run();
        await orchestrator.start();
        expect(orchestrator.getState().phaseIndex).toBe(0);
        await orchestrator.step();
        expect(orchestrator.getState().phaseIndex).toBe(1);
        await orchestrator.step();
        expect(orchestrator.getState().phaseIndex).toBe(1);
        await orchestrator.step();
        expect(orchestrator.getState().phaseIndex).toBe(2);
    });

    it("a human speaking through a seat consumes that phase's turn", async () => {
        const { orchestrator, store, config } = await run();
        await orchestrator.start();
        await orchestrator.postHumanMessage({
            humanId: "u",
            displayName: "Alex",
            text: "I'll frame it.",
            asPersonaId: "chair",
        });
        expect(orchestrator.getState().phaseIndex).toBe(1);
        await orchestrator.step();
        const chat = (await store.read(config.channelId)).filter(m => m.kind === "chat");
        expect(chat.at(-1)!.author.id).toBe("chair");
        expect(chat.at(-1)!.text).toBe("Framing.");
    });
});

describe("a meeting without phases", () => {
    it("still rotates through everyone and never announces a phase", async () => {
        const clock = fixedClock(1_700_000_000_000, 1_000);
        const store = new InMemoryChannelStore(clock, sequentialIdFactory());
        const meeting = await createMeeting({
            store,
            workspaceId: "ws",
            title: "Open",
            objective: "Talk",
            participants: [CHAIR, ANALYST, CRITIC],
            runtimes: [new ScriptedAgentRuntime({ chair: ["a"], analyst: ["b"], critic: ["c"] })],
            maxTurns: 3,
            clock,
        });
        await meeting.orchestrator.run();
        const transcript = await store.read(meeting.config.channelId);
        expect(transcript.filter(m => m.kind === "chat").map(m => m.author.id)).toEqual([
            "chair",
            "analyst",
            "critic",
        ]);
        expect(transcript.some(m => m.meta?.event === "phase")).toBe(false);
        expect(meeting.orchestrator.getState().phaseIndex).toBeUndefined();
    });
});
