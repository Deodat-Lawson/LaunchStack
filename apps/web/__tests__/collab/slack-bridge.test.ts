/**
 * Slack bridge — a meeting held in a Slack channel.
 *
 * The two failure modes that matter are echo loops (we re-ingest our own
 * mirrored posts and the channel doubles every turn) and duplicate delivery
 * (Slack retries an event and the transcript grows a phantom message). Both
 * get explicit coverage here, alongside the human-control commands.
 */

import {
  createMeeting,
  InMemoryChannelStore,
  InMemorySlackClient,
  ScriptedAgentRuntime,
  signSlackRequest,
  SlackChannelBridge,
  verifySlackRequest,
  type AgentPersona,
  type SlackEventEnvelope,
} from "@launchstack/core/collab";

const PM: AgentPersona = { id: "pm", displayName: "Priya", role: "Product lead", systemPrompt: "Lead." };
const ENG: AgentPersona = { id: "eng", displayName: "Sam", role: "Engineering lead", systemPrompt: "Build." };

const SLACK_CHANNEL = "C_PRICING";

async function rig(options: { script?: Record<string, string[]>; useAgentIdentity?: boolean } = {}) {
  const store = new InMemoryChannelStore();
  const slack = new InMemorySlackClient({
    U_ALEX: { id: "U_ALEX", displayName: "Alex Chen", isBot: false },
  });
  const created = await createMeeting({
    store,
    workspaceId: "ws_1",
    title: "Q3 pricing review",
    objective: "Agree a Q3 price change",
    participants: [PM, ENG],
    runtimes: [
      new ScriptedAgentRuntime(
        options.script ?? {
          pm: ["Margin is 42%. @eng feasibility?", "Decision: we'll go with tier B."],
          eng: ["Two sprints. I'll own it.", "Confirmed. MEETING_COMPLETE"],
        },
      ),
    ],
    maxTurns: 4,
    slack: {
      client: slack,
      config: { channelId: SLACK_CHANNEL, enabled: true, useAgentIdentity: options.useAgentIdentity },
    },
  });
  return { store, slack, ...created };
}

function messageEvent(overrides: Partial<NonNullable<SlackEventEnvelope["event"]>>): SlackEventEnvelope {
  return {
    type: "event_callback",
    event: { type: "message", channel: SLACK_CHANNEL, user: "U_ALEX", ts: "1700000500.000100", ...overrides },
  };
}

describe("Slack mirroring (channel → Slack)", () => {
  it("mirrors every meeting message, in transcript order", async () => {
    const { orchestrator, slackBridge, slack } = await rig();
    await orchestrator.run();
    await slackBridge!.drain();

    const texts = slack.posted.map((p) => p.text);
    expect(texts[0]).toContain("Q3 pricing review* started");
    expect(texts.some((t) => t.includes("*Priya*: Margin is 42%"))).toBe(true);
    expect(texts.some((t) => t.includes("*Sam*: Two sprints"))).toBe(true);
    expect(texts.at(-1)).toContain("Meeting ended");
    // Order preserved despite the posts being queued asynchronously.
    expect(texts.findIndex((t) => t.includes("Margin is 42%"))).toBeLessThan(
      texts.findIndex((t) => t.includes("Two sprints")),
    );
  });

  it("posts under each agent's own identity when configured", async () => {
    const { orchestrator, slackBridge, slack } = await rig({ useAgentIdentity: true });
    await orchestrator.run();
    await slackBridge!.drain();

    const priya = slack.posted.find((p) => p.username === "Priya");
    expect(priya).toBeDefined();
    expect(priya!.text).toBe("Margin is 42%. @eng feasibility?");
    expect(priya!.iconEmoji).toBe(":robot_face:");
    // System notices stay clearly attributed to the product, not to an agent.
    expect(slack.posted[0]!.username).toBeUndefined();
  });

  it("labels a human speaking through an agent's seat", async () => {
    const { orchestrator, slackBridge, slack } = await rig();
    await orchestrator.start();
    await orchestrator.takeOver({ humanId: "u_1", displayName: "Alex", asPersonaId: "pm" });
    await orchestrator.postHumanMessage({ humanId: "u_1", displayName: "Alex", text: "Product says no." });
    await slackBridge!.drain();

    expect(slack.posted.some((p) => p.text.includes("*Alex (for @pm)*: Product says no."))).toBe(true);
  });

  it("surfaces a Slack rejection instead of failing silently", async () => {
    const store = new InMemoryChannelStore();
    const channel = await store.createChannel({ id: "c", slug: "s", name: "n", workspaceId: "ws" });
    const errors: string[] = [];
    const bridge = new SlackChannelBridge({
      slack: {
        postMessage: async () => ({ ok: false, error: "channel_not_found" }),
        createChannel: async () => ({ ok: true }),
        history: async () => [],
        userInfo: async () => null,
      },
      store,
      channelId: channel.id,
      slackChannelId: SLACK_CHANNEL,
      onError: (err) => errors.push(err.message),
    });
    bridge.start();

    await store.append({
      channelId: channel.id,
      author: { kind: "agent", id: "pm", displayName: "Priya" },
      text: "hello",
    });
    await bridge.drain();

    expect(errors[0]).toContain("channel_not_found");
  });
});

describe("Slack ingestion (Slack → channel)", () => {
  it("appends a human Slack message into the meeting", async () => {
    const { orchestrator, slackBridge, store, config } = await rig();
    await orchestrator.start();

    const result = await slackBridge!.handleEvent(messageEvent({ text: "Hold on — legal is reviewing." }));

    expect(result.ingested?.author).toMatchObject({ kind: "human", id: "U_ALEX", displayName: "Alex Chen" });
    const transcript = await store.read(config.channelId);
    expect(transcript.some((m) => m.text === "Hold on — legal is reviewing.")).toBe(true);
  });

  it("does not mirror an ingested Slack message back to Slack", async () => {
    const { orchestrator, slackBridge, slack } = await rig();
    await orchestrator.start();
    await slackBridge!.drain();
    const before = slack.posted.length;

    await slackBridge!.handleEvent(messageEvent({ text: "Ship it." }));
    await slackBridge!.drain();

    expect(slack.posted.slice(before).some((p) => p.text.includes("Ship it."))).toBe(false);
  });

  it("echoes the URL verification challenge", async () => {
    const { slackBridge } = await rig();
    const result = await slackBridge!.handleEvent({ type: "url_verification", challenge: "abc123" });
    expect(result.responseBody).toEqual({ challenge: "abc123" });
  });

  it("ignores its own mirrored posts so the channel cannot echo", async () => {
    const { orchestrator, slackBridge, store, config, slack } = await rig();
    await orchestrator.start();
    await orchestrator.step();
    await slackBridge!.drain();

    const before = (await store.read(config.channelId)).length;

    // Replay every message Slack now holds back at the bridge, exactly as the
    // Events API would deliver them.
    for (const entry of await slack.history(SLACK_CHANNEL)) {
      const result = await slackBridge!.handleEvent(
        messageEvent({ text: entry.text, ts: entry.ts, bot_id: entry.bot_id }),
      );
      expect(result.ignored).toBe("own_message");
    }

    expect((await store.read(config.channelId)).length).toBe(before);
  });

  it("drops a duplicate delivery of the same Slack ts", async () => {
    const { orchestrator, slackBridge, store, config } = await rig();
    await orchestrator.start();

    const event = messageEvent({ text: "Ship it.", ts: "1700009999.000100" });
    await slackBridge!.handleEvent(event);
    const second = await slackBridge!.handleEvent(event);

    expect(second.ignored).toBe("duplicate");
    expect((await store.read(config.channelId)).filter((m) => m.text === "Ship it.")).toHaveLength(1);
  });

  it("ignores messages from other channels and empty messages", async () => {
    const { orchestrator, slackBridge } = await rig();
    await orchestrator.start();

    expect((await slackBridge!.handleEvent(messageEvent({ channel: "C_OTHER", text: "hi" }))).ignored).toBe(
      "other_channel",
    );
    expect((await slackBridge!.handleEvent(messageEvent({ text: "   " }))).ignored).toBe("empty");
    expect(
      (await slackBridge!.handleEvent({ type: "event_callback", event: { type: "reaction_added" } })).ignored,
    ).toBe("not_a_message");
  });

  it("backfills messages posted while the bridge was down", async () => {
    const { slackBridge, slack, store, config } = await rig();
    slack.channels.set(SLACK_CHANNEL, [
      { ts: "1700001000.000100", text: "Missed this one", user: "U_ALEX" },
      { ts: "1700001001.000100", text: "And this", user: "U_ALEX" },
      { ts: "1700001002.000100", text: "Bot noise", bot_id: "B1" },
    ]);

    const appended = await slackBridge!.backfill();

    expect(appended.map((m) => m.text)).toEqual(["Missed this one", "And this"]);
    expect(appended[0]!.slackTs).toBe("1700001000.000100");
    expect((await store.read(config.channelId)).some((m) => m.text === "Bot noise")).toBe(false);
  });
});

describe("Slack meeting controls", () => {
  it("!takeover pauses the agents and !release resumes them", async () => {
    const { orchestrator, slackBridge } = await rig();
    await orchestrator.start();

    expect((await slackBridge!.handleEvent(messageEvent({ text: "!takeover" }))).command).toBe("takeover");
    expect(orchestrator.getState().status).toBe("human_control");
    expect((await orchestrator.step()).skipped).toBe("human_control");

    expect((await slackBridge!.handleEvent(messageEvent({ text: "!release", ts: "1.2" }))).command).toBe("release");
    expect(orchestrator.getState().status).toBe("running");
  });

  it("!takeover @persona occupies that agent's seat", async () => {
    const { orchestrator, slackBridge } = await rig();
    await orchestrator.start();

    await slackBridge!.handleEvent(messageEvent({ text: "!takeover @eng" }));

    expect(orchestrator.getState().controller).toMatchObject({ asPersonaId: "eng", displayName: "Alex Chen" });
  });

  it("!pause, !resume, !run and !end drive the meeting", async () => {
    const { orchestrator, slackBridge } = await rig();
    await orchestrator.start();

    await slackBridge!.handleEvent(messageEvent({ text: "!pause", ts: "2.1" }));
    expect(orchestrator.getState().status).toBe("paused");

    await slackBridge!.handleEvent(messageEvent({ text: "!resume", ts: "2.2" }));
    await slackBridge!.handleEvent(messageEvent({ text: "!run 2", ts: "2.3" }));
    expect(orchestrator.getState().turnIndex).toBe(2);

    await slackBridge!.handleEvent(messageEvent({ text: "!end", ts: "2.4" }));
    expect(orchestrator.getState().status).toBe("completed");
  });

  it("!help posts the command reference without touching the transcript", async () => {
    const { orchestrator, slackBridge, slack, store, config } = await rig();
    await orchestrator.start();
    const before = (await store.read(config.channelId)).length;

    const result = await slackBridge!.handleEvent(messageEvent({ text: "!help" }));

    expect(result.command).toBe("help");
    expect(slack.posted.at(-1)!.text).toContain("!takeover");
    expect((await store.read(config.channelId)).length).toBe(before);
  });

  it("treats an unknown ! command as ordinary chat", async () => {
    const { orchestrator, slackBridge } = await rig();
    await orchestrator.start();

    const result = await slackBridge!.handleEvent(messageEvent({ text: "!lgtm ship it" }));

    expect(result.command).toBeUndefined();
    expect(result.ingested?.text).toBe("!lgtm ship it");
  });
});

describe("Slack request signatures", () => {
  const SIGNING_SECRET = "slack-signing-secret";
  const body = JSON.stringify({ type: "event_callback", event: { type: "message", text: "hi" } });
  const now = 1_700_000_000;

  it("accepts a correctly signed request", () => {
    const headers = signSlackRequest(SIGNING_SECRET, body, now);
    expect(verifySlackRequest({ signingSecret: SIGNING_SECRET, rawBody: body, headers, nowSeconds: now }).ok).toBe(
      true,
    );
  });

  it("rejects a modified body", () => {
    const headers = signSlackRequest(SIGNING_SECRET, body, now);
    const result = verifySlackRequest({
      signingSecret: SIGNING_SECRET,
      rawBody: `${body} `,
      headers,
      nowSeconds: now,
    });
    expect(result.reason).toBe("bad_signature");
  });

  it("rejects a stale request", () => {
    const headers = signSlackRequest(SIGNING_SECRET, body, now - 600);
    expect(
      verifySlackRequest({ signingSecret: SIGNING_SECRET, rawBody: body, headers, nowSeconds: now }).reason,
    ).toBe("stale_timestamp");
  });

  it("rejects missing headers", () => {
    expect(
      verifySlackRequest({ signingSecret: SIGNING_SECRET, rawBody: body, headers: {}, nowSeconds: now }).reason,
    ).toBe("missing_headers");
  });

  it("rejects the wrong signing secret", () => {
    const headers = signSlackRequest("other-secret", body, now);
    expect(
      verifySlackRequest({ signingSecret: SIGNING_SECRET, rawBody: body, headers, nowSeconds: now }).reason,
    ).toBe("bad_signature");
  });
});
