/**
 * Cross-machine meeting: three separate OS processes, one TCP socket each way.
 *
 *   process 1 — the hub, holding the channel and the orchestrator
 *   process 2 — an agent worker serving one persona
 *   process 3 — an agent worker serving a different persona
 *   this test — the operator console, driving the meeting over signed HTTP
 *
 * Nothing is shared between them: no module instance, no memory, no database.
 * They agree only on a URL and a secret, which is exactly what two physical
 * machines have. The hub binds `0.0.0.0` and the workers dial the host's
 * routable LAN address rather than loopback, so the traffic takes the same
 * path it would between hosts.
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";

import { HubClient, type ChannelMessage, type MeetingState } from "@launchstack/collab";

const SECRET = "two-machine-shared-secret";
// Jest transpiles to CJS, so `__dirname` is the reliable anchor here.
const APP_ROOT = resolve(__dirname, "../..");
const TSX = resolve(APP_ROOT, "node_modules/.bin/tsx");

/**
 * A non-loopback IPv4 address of this host. Dialing it proves the hub is
 * reachable over the machine's real network stack, not just 127.0.0.1.
 */
function routableAddress(): { host: string; loopbackOnly: boolean } {
    for (const addresses of Object.values(networkInterfaces())) {
        for (const address of addresses ?? []) {
            if (address.family === "IPv4" && !address.internal) {
                return { host: address.address, loopbackOnly: false };
            }
        }
    }
    // CI containers are routinely loopback-only. The protocol path is identical;
    // only the route differs, so the test still means something — it just cannot
    // additionally prove routability.
    return { host: "127.0.0.1", loopbackOnly: true };
}

const PARTICIPANTS = [
    {
        id: "pm",
        displayName: "Priya",
        role: "Product lead",
        systemPrompt: "Drive the agenda.",
        nodeId: "machine-b",
    },
    {
        id: "eng",
        displayName: "Sam",
        role: "Engineering lead",
        systemPrompt: "Assess feasibility.",
        nodeId: "machine-c",
    },
];

class Process {
    readonly stdout: string[] = [];
    readonly stderr: string[] = [];

    constructor(
        readonly name: string,
        readonly child: ChildProcessByStdio<null, Readable, Readable>
    ) {
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => this.stdout.push(chunk));
        child.stderr.on("data", (chunk: string) => this.stderr.push(chunk));
    }

    output(): string {
        return this.stdout.join("");
    }

    /** Resolves with the first stdout line matching `pattern`. */
    async waitForLine(pattern: RegExp, timeoutMs: number): Promise<string> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (this.child.exitCode !== null) {
                throw new Error(
                    `${this.name} exited with ${this.child.exitCode}\nstdout: ${this.output()}\nstderr: ${this.stderr.join("")}`
                );
            }
            const match = pattern.exec(this.output());
            if (match) return match[0];
            await sleep(50);
        }
        throw new Error(
            `${this.name} never printed ${pattern}\nstdout: ${this.output()}\nstderr: ${this.stderr.join("")}`
        );
    }

    async stop(): Promise<void> {
        if (this.child.exitCode !== null) return;
        this.child.kill("SIGTERM");
        const exited = new Promise<void>(r => this.child.once("exit", () => r()));
        await Promise.race([exited, sleep(4_000).then(() => this.child.kill("SIGKILL"))]);
    }
}

function spawnNode(name: string, script: string, env: Record<string, string>): Process {
    const child = spawn(TSX, [resolve(APP_ROOT, "scripts", script)], {
        cwd: APP_ROOT,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
    });
    return new Process(name, child);
}

jest.setTimeout(120_000);

describe("meeting across separate machines", () => {
    const processes: Process[] = [];
    const { host, loopbackOnly } = routableAddress();

    afterEach(async () => {
        await Promise.all(processes.splice(0).map(p => p.stop()));
    });

    afterAll(async () => {
        // Node's built-in fetch keeps its connection pool warm. Closing it lets
        // the Jest worker exit immediately instead of waiting out keep-alive.
        const dispatcher = (
            globalThis as unknown as Record<symbol, { close?: () => Promise<void> }>
        )[Symbol.for("undici.globalDispatcher.1")];
        await dispatcher?.close?.();
    });

    it("runs one meeting with each agent hosted by a different process", async () => {
        const port = 4200 + (process.pid % 500);

        const hub = spawnNode("hub", "collab-hub.ts", {
            COLLAB_SECRET: SECRET,
            COLLAB_PORT: String(port),
            COLLAB_HOST: "0.0.0.0",
            COLLAB_HUB_ID: "machine-a",
            COLLAB_TURN_TIMEOUT_MS: "20000",
            COLLAB_MEETING: JSON.stringify({
                title: "Q3 pricing review",
                objective: "Agree a Q3 price change and name an owner",
                agenda: ["Current margin", "Proposed change", "Owner"],
                participants: PARTICIPANTS,
                maxTurns: 6,
            }),
        });
        processes.push(hub);

        const meetingLine = await hub.waitForLine(/\[collab-hub\] meeting \{.*\}/, 60_000);
        const { meetingId, channelId } = JSON.parse(
            meetingLine.slice(meetingLine.indexOf("{"))
        ) as { meetingId: string; channelId: string };
        await hub.waitForLine(/\[collab-hub\] listening/, 30_000);

        const hubUrl = `http://${host}:${port}`;

        // Sanity: the hub answers on its routable address before workers dial it.
        const health = await fetch(`${hubUrl}/collab/v1/health`);
        expect(health.status).toBe(200);
        expect((await health.json()) as { hubId: string }).toMatchObject({ hubId: "machine-a" });

        const workerB = spawnNode("worker-b", "collab-worker.ts", {
            COLLAB_HUB_URL: hubUrl,
            COLLAB_NODE_ID: "machine-b",
            COLLAB_SECRET: SECRET,
            COLLAB_PERSONAS: "pm",
            COLLAB_POLL_WAIT_MS: "5000",
            COLLAB_WORKER_SCRIPT: JSON.stringify({
                pm: [
                    "Margin is 42% and list price hasn't moved in four quarters. @eng what does tiering cost us?",
                    "Decision: we'll go with tier B. @eng owns the rollout.",
                ],
            }),
        });
        const workerC = spawnNode("worker-c", "collab-worker.ts", {
            COLLAB_HUB_URL: hubUrl,
            COLLAB_NODE_ID: "machine-c",
            COLLAB_SECRET: SECRET,
            COLLAB_PERSONAS: "eng",
            COLLAB_POLL_WAIT_MS: "5000",
            COLLAB_WORKER_SCRIPT: JSON.stringify({
                eng: [
                    "Tiering is two sprints; the billing migration is the long pole. I'll own the migration.",
                    "Rollout is mine. Nothing else blocks us. MEETING_COMPLETE",
                ],
            }),
        });
        processes.push(workerB, workerC);

        await workerB.waitForLine(/\[collab-worker\] ready node=machine-b/, 60_000);
        await workerC.waitForLine(/\[collab-worker\] ready node=machine-c/, 60_000);

        // This test process is a fourth participant: an operator console that
        // holds no meeting state and drives everything over the wire.
        const console_ = new HubClient({ hubUrl, nodeId: "operator-console", secret: SECRET });
        await console_.register({ personaIds: [], label: "integration test" });

        const nodes = (await console_.health()).nodes as Array<{
            nodeId: string;
            connected: boolean;
        }>;
        expect(nodes.map(n => n.nodeId).sort()).toEqual([
            "machine-b",
            "machine-c",
            "operator-console",
        ]);

        const finished = await console_.control(
            meetingId,
            { action: "run" },
            { timeoutMs: 90_000 }
        );
        expect(finished.state.status).toBe("completed");

        const { messages } = await console_.getMessages(channelId, 0);
        const chat = messages.filter((m: ChannelMessage) => m.kind === "chat");

        expect(chat.map(m => m.author.id)).toEqual(["pm", "eng", "pm", "eng"]);
        // Each turn is stamped with the process that actually produced it.
        expect(chat[0]!.meta).toMatchObject({ servedByNode: "machine-b" });
        expect(chat[1]!.meta).toMatchObject({ servedByNode: "machine-c" });
        expect(messages.some(m => m.text.includes("MEETING_COMPLETE"))).toBe(false);

        const detail = await console_.getMeeting(meetingId);
        expect(detail.minutes.decisions.map(d => d.text).join(" ")).toContain("tier B");
        expect(detail.minutes.actionItems.some(a => a.owner === "eng")).toBe(true);

        if (loopbackOnly) {
            console.warn("[two-machine] no non-loopback interface found; ran over 127.0.0.1");
        } else {
            expect(host).not.toBe("127.0.0.1");
        }
    });

    it("lets a human on a third machine take over mid-meeting", async () => {
        const port = 4700 + (process.pid % 200);

        const hub = spawnNode("hub", "collab-hub.ts", {
            COLLAB_SECRET: SECRET,
            COLLAB_PORT: String(port),
            COLLAB_HOST: "0.0.0.0",
            COLLAB_HUB_ID: "machine-a",
            COLLAB_MEETING: JSON.stringify({
                title: "Incident review",
                objective: "Decide whether to roll back",
                participants: [PARTICIPANTS[0]],
                maxTurns: 6,
            }),
        });
        processes.push(hub);

        const meetingLine = await hub.waitForLine(/\[collab-hub\] meeting \{.*\}/, 60_000);
        const { meetingId, channelId } = JSON.parse(
            meetingLine.slice(meetingLine.indexOf("{"))
        ) as {
            meetingId: string;
            channelId: string;
        };
        await hub.waitForLine(/\[collab-hub\] listening/, 30_000);

        const hubUrl = `http://${host}:${port}`;
        const worker = spawnNode("worker-b", "collab-worker.ts", {
            COLLAB_HUB_URL: hubUrl,
            COLLAB_NODE_ID: "machine-b",
            COLLAB_SECRET: SECRET,
            COLLAB_PERSONAS: "pm",
            COLLAB_POLL_WAIT_MS: "5000",
            COLLAB_WORKER_SCRIPT: JSON.stringify({
                pm: ["Error rate is 3%. I'd hold the release.", "Understood — holding."],
            }),
        });
        processes.push(worker);
        await worker.waitForLine(/\[collab-worker\] ready node=machine-b/, 60_000);

        const operator = new HubClient({ hubUrl, nodeId: "operator-console", secret: SECRET });
        await operator.register({ personaIds: [] });

        await operator.control(meetingId, { action: "step" }, { timeoutMs: 30_000 });

        const takeover = await operator.control(meetingId, {
            action: "takeover",
            humanId: "u_ops",
            displayName: "On-call",
        });
        expect(takeover.state.status).toBe("human_control");

        // While a human holds the floor the agents are genuinely blocked, even
        // though the worker is alive and polling on the other machine.
        const blocked: MeetingState = (await operator.control(meetingId, { action: "step" })).state;
        expect(blocked.status).toBe("human_control");
        expect(blocked.turnIndex).toBe(1);

        await operator.postHumanMessage(meetingId, {
            humanId: "u_ops",
            displayName: "On-call",
            text: "Rolling back now — I have the pager.",
        });
        await operator.control(meetingId, { action: "release" });
        await operator.control(meetingId, { action: "step" }, { timeoutMs: 30_000 });

        const { messages } = await operator.getMessages(channelId, 0);
        const human = messages.find(m => m.author.kind === "human");
        expect(human?.text).toContain("Rolling back now");
        expect(messages.some(m => m.kind === "system" && m.text.includes("took the floor"))).toBe(
            true
        );
        expect(messages.filter(m => m.kind === "chat" && m.author.kind === "agent")).toHaveLength(
            2
        );
    });
});

function sleep(ms: number): Promise<void> {
    return new Promise(r => {
        // Unref'd so a losing `Promise.race` branch cannot hold the event loop.
        setTimeout(r, ms).unref?.();
    });
}
