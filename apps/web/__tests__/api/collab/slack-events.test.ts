/**
 * Slack Events API receiver.
 *
 * The route is the trust boundary: it verifies the signature over the raw body,
 * finds the meeting mirroring that Slack channel, and hands the event to the
 * bridge. Everything downstream of the bridge is covered by the bridge tests;
 * what matters here is that an unsigned or replayed delivery never reaches it.
 */

import {
    createMeeting,
    InMemoryChannelStore,
    InMemorySlackClient,
    ScriptedAgentRuntime,
    signSlackRequest,
    type SlackChannelBridge,
} from "@launchstack/collab";

const SIGNING_SECRET = "slack-signing-secret";
const SLACK_CHANNEL = "C_PRICING";

const mockCtx: {
    signingSecret: string | null;
    meetingRow: { id: string; companyId: bigint } | null;
    bridge: SlackChannelBridge | null;
    store: InMemoryChannelStore;
    slack: InMemorySlackClient;
    channelId: string;
    loadedMeetings: string[];
} = {
    signingSecret: SIGNING_SECRET,
    meetingRow: null,
    bridge: null,
    store: new InMemoryChannelStore(),
    slack: new InMemorySlackClient(),
    channelId: "",
    loadedMeetings: [],
};

jest.mock("~/server/db", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => ({
                    orderBy: () => ({
                        limit: () =>
                            Promise.resolve(mockCtx.meetingRow ? [mockCtx.meetingRow] : []),
                    }),
                }),
            }),
        }),
    },
}));

jest.mock("~/server/collab/slack", () => ({
    getSlackSigningSecret: () => mockCtx.signingSecret,
}));

jest.mock("~/server/collab/runtime", () => ({
    getMeetingRuntime: (meetingId: string) => {
        mockCtx.loadedMeetings.push(meetingId);
        return Promise.resolve(null);
    },
    getMeetingBridge: () => mockCtx.bridge,
}));

import { POST } from "~/app/api/collab/slack/events/route";

function slackRequest(body: unknown, options: { sign?: boolean; timestamp?: number } = {}) {
    const raw = JSON.stringify(body);
    const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.sign !== false) {
        Object.assign(headers, signSlackRequest(SIGNING_SECRET, raw, timestamp));
    }
    return new Request("https://app.example.com/api/collab/slack/events", {
        method: "POST",
        headers,
        body: raw,
    });
}

function messageEvent(text: string, ts = "1700000500.000100") {
    return {
        type: "event_callback",
        event: { type: "message", channel: SLACK_CHANNEL, user: "U_ALEX", text, ts },
    };
}

describe("POST /api/collab/slack/events", () => {
    beforeEach(async () => {
        mockCtx.signingSecret = SIGNING_SECRET;
        mockCtx.store = new InMemoryChannelStore();
        mockCtx.slack = new InMemorySlackClient({
            U_ALEX: { id: "U_ALEX", displayName: "Alex Chen", isBot: false },
        });
        mockCtx.loadedMeetings = [];

        const created = await createMeeting({
            store: mockCtx.store,
            workspaceId: "7",
            title: "Q3 pricing review",
            objective: "Agree a Q3 price change",
            participants: [
                { id: "pm", displayName: "Priya", role: "Product lead", systemPrompt: "Lead." },
            ],
            runtimes: [new ScriptedAgentRuntime({ pm: ["Opening."] })],
            maxTurns: 4,
            slack: {
                client: mockCtx.slack,
                config: { channelId: SLACK_CHANNEL, enabled: true },
            },
        });
        await created.orchestrator.start();
        await created.slackBridge!.drain();

        mockCtx.channelId = created.config.channelId;
        mockCtx.bridge = created.slackBridge;
        mockCtx.meetingRow = { id: created.config.id, companyId: 7n };
    });

    it("ingests a human Slack message into the meeting channel", async () => {
        const response = await POST(slackRequest(messageEvent("Hold on — legal is reviewing.")));

        expect(response.status).toBe(200);
        const transcript = await mockCtx.store.read(mockCtx.channelId);
        expect(transcript.some(m => m.text === "Hold on — legal is reviewing.")).toBe(true);
        // The route must load the meeting so the bridge is attached in-process.
        expect(mockCtx.loadedMeetings).toContain(mockCtx.meetingRow!.id);
    });

    it("echoes the URL verification challenge", async () => {
        const response = await POST(
            slackRequest({ type: "url_verification", challenge: "abc123" })
        );
        expect(await response.json()).toEqual({ challenge: "abc123" });
    });

    it("rejects an unsigned delivery", async () => {
        const response = await POST(slackRequest(messageEvent("spoofed"), { sign: false }));

        expect(response.status).toBe(401);
        const transcript = await mockCtx.store.read(mockCtx.channelId);
        expect(transcript.some(m => m.text === "spoofed")).toBe(false);
    });

    it("rejects a replayed delivery outside Slack's timestamp window", async () => {
        const response = await POST(
            slackRequest(messageEvent("stale"), { timestamp: Math.floor(Date.now() / 1000) - 600 })
        );
        expect(response.status).toBe(401);
        expect(((await response.json()) as { error: string }).error).toMatch(/stale_timestamp/);
    });

    it("rejects a body modified after signing", async () => {
        const raw = JSON.stringify(messageEvent("original"));
        const timestamp = Math.floor(Date.now() / 1000);
        const headers = {
            "content-type": "application/json",
            ...signSlackRequest(SIGNING_SECRET, raw, timestamp),
        };
        const tampered = new Request("https://app.example.com/api/collab/slack/events", {
            method: "POST",
            headers,
            body: JSON.stringify(messageEvent("tampered")),
        });

        expect((await POST(tampered)).status).toBe(401);
    });

    it("answers 503 when Slack events are not configured", async () => {
        mockCtx.signingSecret = null;
        const response = await POST(slackRequest(messageEvent("hi")));

        expect(response.status).toBe(503);
        expect(((await response.json()) as { error: string }).error).toMatch(
            /SLACK_SIGNING_SECRET/
        );
    });

    it("ignores an event for a Slack channel with no meeting", async () => {
        mockCtx.meetingRow = null;
        const response = await POST(slackRequest(messageEvent("nobody home")));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true, ignored: "no_meeting_for_channel" });
    });

    it("drives the meeting from an in-channel command", async () => {
        const response = await POST(slackRequest(messageEvent("!pause", "1700000600.000100")));

        expect(response.status).toBe(200);
        const transcript = await mockCtx.store.read(mockCtx.channelId);
        expect(transcript.some(m => m.kind === "system" && m.text.includes("paused"))).toBe(true);
        // A command is control flow, not conversation.
        expect(transcript.some(m => m.text === "!pause")).toBe(false);
    });

    it("survives a bridge failure without asking Slack to retry forever", async () => {
        const failing = {
            handleEvent: () => Promise.reject(new Error("boom")),
        } as unknown as SlackChannelBridge;
        mockCtx.bridge = failing;

        const response = await POST(slackRequest(messageEvent("whatever")));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true, error: "handler_failed" });
    });
});
