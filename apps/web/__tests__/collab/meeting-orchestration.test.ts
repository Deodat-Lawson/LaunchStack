/**
 * Meeting orchestration — turn policies, human takeover, termination, minutes.
 *
 * Every agent here is scripted, so these assertions are about the *engine*:
 * who speaks when, what a human interjection does to the rotation, and what
 * the transcript looks like afterwards. Model quality is scored separately by
 * the eval harness.
 */

import {
    buildMinutes,
    createMeeting,
    fixedClock,
    InMemoryChannelStore,
    MeetingOrchestrator,
    ScriptedAgentRuntime,
    selectNextSpeaker,
    sequentialIdFactory,
    type AgentPersona,
    type ChannelMessage,
} from "@launchstack/collab";

const PM: AgentPersona = {
    id: "pm",
    displayName: "Priya",
    role: "Product lead",
    systemPrompt: "Drive the agenda.",
};
const ENG: AgentPersona = {
    id: "eng",
    displayName: "Sam",
    role: "Engineering lead",
    systemPrompt: "Assess feasibility.",
};
const FIN: AgentPersona = {
    id: "fin",
    displayName: "Dana",
    role: "Finance partner",
    systemPrompt: "Guard the margin.",
};

function harness(options: {
    participants?: AgentPersona[];
    script: Record<string, string[]>;
    turnPolicy?: { kind: "round_robin" | "moderated" | "reactive"; moderatorId?: string };
    maxTurns?: number;
}) {
    const clock = fixedClock(1_700_000_000_000, 1_000);
    const store = new InMemoryChannelStore(clock, sequentialIdFactory());
    const participants = options.participants ?? [PM, ENG, FIN];
    return { clock, store, participants, script: options.script, options };
}

async function buildMeeting(h: ReturnType<typeof harness>) {
    return createMeeting({
        store: h.store,
        workspaceId: "ws_1",
        title: "Q3 pricing review",
        objective: "Agree a Q3 price change and who ships it",
        agenda: ["Current margin", "Proposed change", "Owner"],
        participants: h.participants,
        runtimes: [new ScriptedAgentRuntime(h.script)],
        turnPolicy: h.options.turnPolicy ?? { kind: "round_robin" },
        maxTurns: h.options.maxTurns ?? 9,
        clock: h.clock,
        newId: sequentialIdFactory(),
    });
}

function chatOf(transcript: ChannelMessage[]) {
    return transcript.filter(m => m.kind === "chat");
}

describe("meeting orchestration", () => {
    it("runs a round-robin meeting and ends on the completion marker", async () => {
        const h = harness({
            script: {
                pm: [
                    "Margin is 42%. @eng can we ship a tiered plan?",
                    "Decision: we'll go with tier B.",
                ],
                eng: ["Tiered pricing is two sprints. I'll own the billing migration."],
                fin: ["Tier B holds margin at 44%. Agreed: tier B. MEETING_COMPLETE"],
            },
        });
        const { orchestrator, config } = await buildMeeting(h);

        const state = await orchestrator.run();

        expect(state.status).toBe("completed");
        const transcript = await h.store.read(config.channelId);
        const speakers = chatOf(transcript).map(m => m.author.id);
        expect(speakers).toEqual(["pm", "eng", "fin"]);

        // The marker is control flow and must never reach the transcript.
        expect(transcript.some(m => m.text.includes("MEETING_COMPLETE"))).toBe(false);
        expect(transcript[0]!.kind).toBe("system");
        expect(transcript.at(-1)!.text).toContain("Meeting ended");
    });

    it("stops at maxTurns when no agent proposes completion", async () => {
        const h = harness({
            script: { pm: ["Point."], eng: ["Counterpoint."], fin: ["Cost note."] },
            maxTurns: 4,
        });
        const { orchestrator, config } = await buildMeeting(h);

        const state = await orchestrator.run();

        expect(state.status).toBe("completed");
        expect(state.turnIndex).toBe(4);
        expect(chatOf(await h.store.read(config.channelId))).toHaveLength(4);
    });

    it("follows @mentions under the reactive policy", async () => {
        const h = harness({
            turnPolicy: { kind: "reactive" },
            script: {
                pm: ["@fin what does a 10% cut do to margin?"],
                fin: ["It costs 4 points. @eng can we offset with usage-based billing?"],
                eng: ["Yes, one sprint. MEETING_COMPLETE"],
            },
        });
        const { orchestrator, config } = await buildMeeting(h);

        await orchestrator.run();

        expect(chatOf(await h.store.read(config.channelId)).map(m => m.author.id)).toEqual([
            "pm",
            "fin",
            "eng",
        ]);
    });

    it("returns the floor to the moderator when no one is nominated", async () => {
        const h = harness({
            turnPolicy: { kind: "moderated", moderatorId: "pm" },
            script: {
                pm: [
                    "Opening. @eng start us off.",
                    "Thanks. @fin your read?",
                    "Wrapping. MEETING_COMPLETE",
                ],
                eng: ["Two sprints, no blockers."],
                fin: ["Margin holds."],
            },
        });
        const { orchestrator, config } = await buildMeeting(h);

        await orchestrator.run();

        const speakers = chatOf(await h.store.read(config.channelId)).map(m => m.author.id);
        expect(speakers[0]).toBe("pm");
        expect(speakers[1]).toBe("eng");
        // eng nominated nobody, so control returns to the moderator.
        expect(speakers[2]).toBe("pm");
        expect(speakers[3]).toBe("fin");
    });

    describe("human takeover", () => {
        it("suspends agent turns until control is released", async () => {
            const h = harness({
                script: { pm: ["A"], eng: ["B"], fin: ["C"] },
                maxTurns: 6,
            });
            const { orchestrator, config } = await buildMeeting(h);

            await orchestrator.start();
            await orchestrator.step();
            await orchestrator.takeOver({ humanId: "u_1", displayName: "Alex" });

            const blocked = await orchestrator.step();
            expect(blocked.skipped).toBe("human_control");
            expect(blocked.message).toBeUndefined();

            await orchestrator.postHumanMessage({
                humanId: "u_1",
                displayName: "Alex",
                text: "Hold on — legal flagged the tier names.",
            });
            await orchestrator.release();

            const resumed = await orchestrator.step();
            expect(resumed.message?.author.kind).toBe("agent");

            const transcript = await h.store.read(config.channelId);
            const human = transcript.find(m => m.author.kind === "human");
            expect(human?.text).toContain("legal flagged");
            expect(
                transcript.some(m => m.kind === "system" && m.text.includes("took the floor"))
            ).toBe(true);
            expect(
                transcript.some(m => m.kind === "system" && m.text.includes("handed control back"))
            ).toBe(true);
        });

        it("consumes the agent's turn when a human speaks through its seat", async () => {
            const h = harness({ script: { pm: ["A"], eng: ["B"], fin: ["C"] }, maxTurns: 6 });
            const { orchestrator, config } = await buildMeeting(h);

            await orchestrator.start();
            await orchestrator.takeOver({ humanId: "u_1", displayName: "Alex", asPersonaId: "pm" });
            await orchestrator.postHumanMessage({
                humanId: "u_1",
                displayName: "Alex",
                text: "Speaking for product: we are not raising list price.",
            });
            await orchestrator.release();
            const next = await orchestrator.step();

            // pm's seat was used, so the rotation moves on rather than looping back.
            expect(next.message?.author.id).toBe("eng");

            const human = (await h.store.read(config.channelId)).find(
                m => m.author.kind === "human"
            );
            expect(human?.author.onBehalfOfPersonaId).toBe("pm");
        });

        it("lets a human chime in without taking control", async () => {
            const h = harness({ script: { pm: ["A"], eng: ["B"], fin: ["C"] }, maxTurns: 6 });
            const { orchestrator } = await buildMeeting(h);

            await orchestrator.start();
            await orchestrator.postHumanMessage({
                humanId: "u_2",
                displayName: "Jo",
                text: "FYI churn is up 2%.",
            });

            expect(orchestrator.getState().status).toBe("running");
            const next = await orchestrator.step();
            expect(next.message?.author.kind).toBe("agent");
        });

        it("rejects a takeover of an unknown persona", async () => {
            const h = harness({ script: { pm: ["A"] }, participants: [PM] });
            const { orchestrator } = await buildMeeting(h);
            await orchestrator.start();

            await expect(
                orchestrator.takeOver({ humanId: "u", displayName: "U", asPersonaId: "nope" })
            ).rejects.toThrow(/Unknown persona/);
        });
    });

    it("pause and resume gate agent turns", async () => {
        const h = harness({ script: { pm: ["A"], eng: ["B"], fin: ["C"] }, maxTurns: 6 });
        const { orchestrator } = await buildMeeting(h);

        await orchestrator.start();
        await orchestrator.pause();
        expect((await orchestrator.step()).skipped).toBe("paused");

        await orchestrator.resume();
        expect((await orchestrator.step()).message).toBeDefined();
    });

    it("fails the meeting when no runtime serves a persona", async () => {
        const store = new InMemoryChannelStore();
        const channel = await store.createChannel({
            id: "chan_x",
            slug: "x",
            name: "X",
            workspaceId: "ws",
        });
        const orchestrator = new MeetingOrchestrator({
            store,
            config: {
                id: "mtg_x",
                channelId: channel.id,
                workspaceId: "ws",
                title: "T",
                objective: "O",
                agenda: [],
                participants: [{ ...PM, nodeId: "worker-that-never-connected" }],
                turnPolicy: { kind: "round_robin" },
                maxTurns: 3,
            },
            runtimes: [new ScriptedAgentRuntime({ pm: ["A"] })],
        });

        const state = await orchestrator.run();
        expect(state.status).toBe("failed");
        expect(state.error).toMatch(/No runtime serves persona "pm"/);
    });

    it("survives a single failing turn and ends after repeated failures", async () => {
        const store = new InMemoryChannelStore();
        const channel = await store.createChannel({
            id: "c",
            slug: "s",
            name: "n",
            workspaceId: "ws",
        });
        let calls = 0;
        const flaky = {
            nodeId: "local",
            serves: () => true,
            takeTurn: async () => {
                calls++;
                if (calls === 1) throw new Error("model timeout");
                return { text: "Recovered answer." };
            },
        };
        const orchestrator = new MeetingOrchestrator({
            store,
            config: {
                id: "m",
                channelId: channel.id,
                workspaceId: "ws",
                title: "T",
                objective: "O",
                agenda: [],
                participants: [PM, ENG],
                turnPolicy: { kind: "round_robin" },
                maxTurns: 3,
            },
            runtimes: [flaky],
        });

        const state = await orchestrator.run();
        expect(state.status).toBe("completed");
        const transcript = await store.read(channel.id);
        expect(transcript.some(m => m.text.includes("could not respond"))).toBe(true);
        expect(transcript.some(m => m.text === "Recovered answer.")).toBe(true);
    });

    it("serializes concurrent steps so no turn index is claimed twice", async () => {
        const h = harness({ script: { pm: ["A"], eng: ["B"], fin: ["C"] }, maxTurns: 3 });
        const { orchestrator, config } = await buildMeeting(h);
        await orchestrator.start();

        await Promise.all([orchestrator.step(), orchestrator.step(), orchestrator.step()]);

        const speakers = chatOf(await h.store.read(config.channelId)).map(m => m.author.id);
        expect(speakers).toEqual(["pm", "eng", "fin"]);
    });
});

describe("selectNextSpeaker", () => {
    const participants = [PM, ENG, FIN];

    it("round-robins independent of the transcript", () => {
        for (let i = 0; i < 6; i++) {
            expect(
                selectNextSpeaker({
                    participants,
                    transcript: [],
                    turnIndex: i,
                    policy: { kind: "round_robin" },
                })!.id
            ).toBe(participants[i % 3]!.id);
        }
    });

    it("returns null with no participants", () => {
        expect(
            selectNextSpeaker({
                participants: [],
                transcript: [],
                turnIndex: 0,
                policy: { kind: "reactive" },
            })
        ).toBeNull();
    });

    it("never hands a reactive turn straight back to the last speaker", () => {
        const transcript: ChannelMessage[] = [
            {
                id: "m1",
                channelId: "c",
                seq: 1,
                ts: "2026-01-01T00:00:00.000Z",
                author: { kind: "agent", id: "pm", displayName: "Priya" },
                text: "Something entirely unrelated to anyone's role.",
                kind: "chat",
            },
        ];
        const next = selectNextSpeaker({
            participants,
            transcript,
            turnIndex: 1,
            policy: { kind: "reactive" },
        });
        expect(next!.id).not.toBe("pm");
    });
});

describe("minutes", () => {
    it("extracts decisions and action items from the transcript only", async () => {
        const h = harness({
            script: {
                pm: ["Decision: we'll go with tier B for Q3."],
                eng: ["I'll own the billing migration by Friday."],
                fin: ["Margin holds at 44%. MEETING_COMPLETE"],
            },
        });
        const { orchestrator, config } = await buildMeeting(h);
        await orchestrator.run();

        const minutes = buildMinutes(
            config,
            orchestrator.getState(),
            await h.store.read(config.channelId)
        );

        expect(minutes.decisions.map(d => d.text).join(" ")).toContain("tier B");
        expect(minutes.actionItems).toHaveLength(1);
        expect(minutes.actionItems[0]!.owner).toBe("eng");
        expect(minutes.participants.find(p => p.id === "pm")!.messages).toBe(1);
        expect(minutes.summary.split("\n")).toHaveLength(3);
        expect(minutes.status).toBe("completed");
    });

    it("counts human interventions", async () => {
        const h = harness({ script: { pm: ["A"], eng: ["B"], fin: ["C"] }, maxTurns: 2 });
        const { orchestrator, config } = await buildMeeting(h);
        await orchestrator.start();
        await orchestrator.postHumanMessage({ humanId: "u", displayName: "Alex", text: "Note." });
        await orchestrator.run();

        const minutes = buildMinutes(
            config,
            orchestrator.getState(),
            await h.store.read(config.channelId)
        );
        expect(minutes.humanInterventions).toBe(1);
    });
});
