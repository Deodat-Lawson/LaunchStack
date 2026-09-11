/**
 * Hub ↔ worker over real HTTP.
 *
 * The hub runs on a real TCP socket and the worker talks to it with real
 * `fetch` — no in-memory shortcut, no shared object graph beyond the secret.
 * This is the same code path a second machine uses; only the host in the URL
 * differs. `two-machine.test.ts` proves that by putting the worker in its own
 * OS process.
 */

import {
    createMeeting,
    AgentWorker,
    HubClient,
    InMemoryChannelStore,
    MeetingHub,
    ScriptedAgentRuntime,
    startHubServer,
    type AgentPersona,
    type HubServerHandle,
} from "@launchstack/collab";

const SECRET = "integration-secret";

const LOCAL_PM: AgentPersona = {
    id: "pm",
    displayName: "Priya",
    role: "Product lead",
    systemPrompt: "Drive the agenda.",
};
const REMOTE_ENG: AgentPersona = {
    id: "eng",
    displayName: "Sam",
    role: "Engineering lead",
    systemPrompt: "Assess feasibility.",
    nodeId: "worker-b",
};
const REMOTE_FIN: AgentPersona = {
    id: "fin",
    displayName: "Dana",
    role: "Finance partner",
    systemPrompt: "Guard the margin.",
    nodeId: "worker-b",
};

interface Rig {
    hub: MeetingHub;
    server: HubServerHandle;
    store: InMemoryChannelStore;
    close(): Promise<void>;
}

async function startRig(): Promise<Rig> {
    const store = new InMemoryChannelStore();
    const hub = new MeetingHub({ store, secret: SECRET, hubId: "hub-a", turnTimeoutMs: 5_000 });
    const server = await startHubServer(hub, { host: "127.0.0.1" });
    return {
        hub,
        server,
        store,
        close: async () => {
            hub.close();
            await server.close();
        },
    };
}

function workerClient(rig: Rig, nodeId = "worker-b") {
    return new HubClient({ hubUrl: rig.server.url, nodeId, secret: SECRET });
}

jest.setTimeout(30_000);

describe("meeting hub over HTTP", () => {
    let rig: Rig;

    beforeEach(async () => {
        rig = await startRig();
    });

    afterEach(async () => {
        await rig.close();
    });

    it("serves an unauthenticated health probe", async () => {
        const response = await fetch(`${rig.server.url}/collab/v1/health`);
        const body = (await response.json()) as { ok: boolean; hubId: string };
        expect(response.status).toBe(200);
        expect(body).toMatchObject({ ok: true, hubId: "hub-a" });
    });

    it("rejects an unsigned request with 401", async () => {
        const response = await fetch(`${rig.server.url}/collab/v1/nodes/register`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ nodeId: "worker-b", personaIds: [] }),
        });
        expect(response.status).toBe(401);
    });

    it("rejects a request signed with the wrong secret", async () => {
        const client = new HubClient({
            hubUrl: rig.server.url,
            nodeId: "worker-b",
            secret: "wrong-secret",
        });
        await expect(client.register({ personaIds: [] })).rejects.toMatchObject({ status: 401 });
    });

    it("rejects a node registering under someone else's id", async () => {
        const client = workerClient(rig, "worker-b");
        await expect(
            client.request("POST", "/collab/v1/nodes/register", {
                nodeId: "worker-c",
                personaIds: [],
            })
        ).rejects.toMatchObject({ status: 401 });
    });

    it("runs a meeting whose agents live behind the network", async () => {
        const client = workerClient(rig);
        const worker = new AgentWorker({
            client,
            personaIds: ["eng", "fin"],
            label: "remote pod",
            pollWaitMs: 2_000,
            runtimes: [
                new ScriptedAgentRuntime(
                    {
                        eng: ["Two sprints, no blockers. I'll own the billing migration."],
                        fin: ["Tier B holds margin at 44%. Agreed: tier B. MEETING_COMPLETE"],
                    },
                    { nodeId: "worker-b" }
                ),
            ],
        });
        await worker.start();

        try {
            const { orchestrator, config } = await createMeeting({
                store: rig.store,
                workspaceId: "ws_1",
                title: "Q3 pricing review",
                objective: "Agree a Q3 price change",
                participants: [LOCAL_PM, REMOTE_ENG, REMOTE_FIN],
                runtimes: [new ScriptedAgentRuntime({ pm: ["Margin is 42%. @eng feasibility?"] })],
                hub: rig.hub,
                maxTurns: 6,
            });

            const state = await orchestrator.run();

            expect(state.status).toBe("completed");
            const transcript = await rig.store.read(config.channelId);
            const chat = transcript.filter(m => m.kind === "chat");
            expect(chat.map(m => m.author.id)).toEqual(["pm", "eng", "fin"]);

            // Turns produced remotely are stamped with the node that served them —
            // the audit trail for a distributed meeting.
            expect(chat.find(m => m.author.id === "eng")!.meta).toMatchObject({
                servedByNode: "worker-b",
                nodeId: "worker-b",
            });
            expect(chat.find(m => m.author.id === "pm")!.meta).toMatchObject({ nodeId: "local" });
        } finally {
            await worker.stop();
        }
    });

    it("reports connected nodes and the personas they claim", async () => {
        const worker = new AgentWorker({
            client: workerClient(rig),
            personaIds: ["eng"],
            label: "remote pod",
            pollWaitMs: 500,
            runtimes: [new ScriptedAgentRuntime({ eng: ["hi"] }, { nodeId: "worker-b" })],
        });
        await worker.start();
        try {
            const nodes = rig.hub.listNodes();
            expect(nodes).toHaveLength(1);
            expect(nodes[0]).toMatchObject({
                nodeId: "worker-b",
                personaIds: ["eng"],
                connected: true,
            });
        } finally {
            await worker.stop();
        }
        expect(rig.hub.listNodes()).toHaveLength(0);
    });

    it("fails the turn — not the process — when the owning node never connected", async () => {
        const { orchestrator } = await createMeeting({
            store: rig.store,
            workspaceId: "ws_1",
            title: "Orphaned",
            objective: "Nobody is home",
            participants: [{ ...REMOTE_ENG, nodeId: "node-that-does-not-exist" }],
            runtimes: [],
            hub: rig.hub,
            maxTurns: 2,
        });

        const state = await orchestrator.run();
        expect(state.status).toBe("failed");
        expect(state.error).toMatch(/No runtime serves persona/);
    });

    it("times out a remote turn and keeps the meeting alive", async () => {
        const store = new InMemoryChannelStore();
        const hub = new MeetingHub({ store, secret: SECRET, hubId: "hub-t", turnTimeoutMs: 300 });
        const server = await startHubServer(hub, { host: "127.0.0.1" });
        const client = new HubClient({ hubUrl: server.url, nodeId: "worker-b", secret: SECRET });

        const stalling = {
            nodeId: "worker-b",
            serves: () => true,
            takeTurn: () => new Promise<never>(() => undefined),
        };
        const worker = new AgentWorker({
            client,
            personaIds: ["eng"],
            pollWaitMs: 1_000,
            runtimes: [stalling],
        });
        await worker.start();

        try {
            const { orchestrator, config } = await createMeeting({
                store,
                workspaceId: "ws_1",
                title: "Stalling agent",
                objective: "Survive a hung worker",
                participants: [REMOTE_ENG, LOCAL_PM],
                runtimes: [
                    new ScriptedAgentRuntime({ pm: ["Carrying on without Sam. MEETING_COMPLETE"] }),
                ],
                hub,
                maxTurns: 4,
            });

            const state = await orchestrator.run();
            expect(state.status).toBe("completed");
            const transcript = await store.read(config.channelId);
            expect(transcript.some(m => m.text.includes("could not respond"))).toBe(true);
            expect(transcript.some(m => m.text.startsWith("Carrying on"))).toBe(true);
        } finally {
            await worker.stop();
            hub.close();
            await server.close();
        }
    });

    it("lets a remote client post a human message and drive meeting control", async () => {
        const { orchestrator, config } = await createMeeting({
            store: rig.store,
            workspaceId: "ws_1",
            title: "Remote control",
            objective: "Drive the meeting from another host",
            participants: [LOCAL_PM],
            runtimes: [new ScriptedAgentRuntime({ pm: ["A", "B", "C"] })],
            hub: rig.hub,
            maxTurns: 5,
        });
        await orchestrator.start();

        const remote = workerClient(rig, "operator-console");
        await remote.register({ personaIds: [] });

        const takeover = await remote.control(config.id, {
            action: "takeover",
            humanId: "u_9",
            displayName: "Alex",
        });
        expect(takeover.state.status).toBe("human_control");

        const posted = await remote.postHumanMessage(config.id, {
            humanId: "u_9",
            displayName: "Alex",
            text: "Skip item two — legal is still reviewing.",
        });
        expect(posted.message.author.kind).toBe("human");

        await remote.control(config.id, { action: "release" });
        const stepped = await remote.control(config.id, { action: "step" });
        expect(stepped.state.turnIndex).toBe(1);

        const { messages } = await remote.getMessages(config.channelId, 0);
        expect(messages.some(m => m.text.includes("legal is still reviewing"))).toBe(true);

        const detail = await remote.getMeeting(config.id);
        expect(detail.minutes.humanInterventions).toBe(1);
        expect(detail.config.title).toBe("Remote control");
    });

    it("broadcasts channel messages to every connected worker", async () => {
        const seen: string[] = [];
        const worker = new AgentWorker({
            client: workerClient(rig),
            personaIds: ["eng"],
            pollWaitMs: 1_000,
            runtimes: [new ScriptedAgentRuntime({ eng: ["ok"] }, { nodeId: "worker-b" })],
            onMessage: m => seen.push(m.text),
        });
        await worker.start();

        try {
            const { orchestrator } = await createMeeting({
                store: rig.store,
                workspaceId: "ws_1",
                title: "Broadcast",
                objective: "Remote agents observe the room",
                participants: [LOCAL_PM],
                runtimes: [new ScriptedAgentRuntime({ pm: ["Local turn."] })],
                hub: rig.hub,
                maxTurns: 1,
            });
            await orchestrator.start();
            await orchestrator.step();

            await waitFor(() => seen.some(t => t === "Local turn."), 5_000);
        } finally {
            await worker.stop();
        }
    });

    it("recovers when a worker restarts mid-meeting", async () => {
        const { orchestrator, config } = await createMeeting({
            store: rig.store,
            workspaceId: "ws_1",
            title: "Restart",
            objective: "Survive a worker bounce",
            participants: [LOCAL_PM, REMOTE_ENG],
            runtimes: [new ScriptedAgentRuntime({ pm: ["Opening.", "Continuing."] })],
            hub: rig.hub,
            maxTurns: 4,
        });

        await orchestrator.start();
        await orchestrator.step(); // pm speaks locally

        const first = new AgentWorker({
            client: workerClient(rig),
            personaIds: ["eng"],
            pollWaitMs: 500,
            runtimes: [
                new ScriptedAgentRuntime(
                    { eng: ["From the first worker."] },
                    { nodeId: "worker-b" }
                ),
            ],
        });
        await first.start();
        await first.stop();

        const second = new AgentWorker({
            client: workerClient(rig),
            personaIds: ["eng"],
            pollWaitMs: 500,
            runtimes: [
                new ScriptedAgentRuntime(
                    { eng: ["From the replacement worker."] },
                    { nodeId: "worker-b" }
                ),
            ],
        });
        await second.start();

        try {
            const result = await orchestrator.step();
            expect(result.message?.text).toBe("From the replacement worker.");
            const transcript = await rig.store.read(config.channelId);
            expect(transcript.some(m => m.text === "From the first worker.")).toBe(false);
        } finally {
            await second.stop();
        }
    });
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise(r => setTimeout(r, 25));
    }
    throw new Error("Timed out waiting for condition");
}
