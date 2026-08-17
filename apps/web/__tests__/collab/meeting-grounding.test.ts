/**
 * Turn-level grounding — the retrieval port, its failure behaviour, and the
 * provenance it leaves on the transcript.
 *
 * The provider here is a stub, so these assertions are about the *engine*:
 * when it retrieves, what it does with what comes back, and what happens when
 * retrieval is broken. Whether the real retriever finds good passages is a
 * different question, answered by the RAG tests.
 */

import {
  buildGroundingQuery,
  createMeeting,
  evaluateMeeting,
  fixedClock,
  InMemoryChannelStore,
  MeetingOrchestrator,
  ScriptedAgentRuntime,
  sequentialIdFactory,
  toExcerpt,
  type AgentPersona,
  type AgentTurnRequest,
  type ChannelMessage,
  type TurnGrounding,
  type TurnGroundingProvider,
  type TurnGroundingRequest,
} from "@launchstack/core/collab";

const ANALYST: AgentPersona = {
  id: "data",
  displayName: "Tomas",
  role: "Data analyst",
  systemPrompt: "Check the numbers.",
};
const ENG: AgentPersona = {
  id: "eng",
  displayName: "Marcus",
  role: "Engineering lead",
  systemPrompt: "Price the work.",
};

/** Records what it was asked for, and answers with whatever it was handed. */
class StubProvider implements TurnGroundingProvider {
  readonly calls: TurnGroundingRequest[] = [];

  constructor(private readonly answer: (r: TurnGroundingRequest) => TurnGrounding) {}

  async retrieve(request: TurnGroundingRequest): Promise<TurnGrounding> {
    this.calls.push(request);
    return this.answer(request);
  }
}

/** Captures the TurnContext each agent actually received. */
class SpyRuntime extends ScriptedAgentRuntime {
  readonly seen: Array<{ personaId: string; context: string[] }> = [];

  async takeTurn(request: AgentTurnRequest) {
    this.seen.push({ personaId: request.persona.id, context: [...request.context.context] });
    return super.takeTurn(request);
  }
}

function build(options: {
  provider?: TurnGroundingProvider;
  context?: string[];
  script?: Record<string, string[]>;
  maxTurns?: number;
}) {
  const clock = fixedClock(1_700_000_000_000, 1_000);
  const store = new InMemoryChannelStore(clock, sequentialIdFactory());
  const runtime = new SpyRuntime(
    options.script ?? { data: ["Churn is 4%."], eng: ["Two sprints."] },
  );

  return {
    store,
    runtime,
    meeting: createMeeting({
      store,
      workspaceId: "ws_1",
      title: "Renewal risk",
      objective: "Decide whether to build the retention dashboard",
      agenda: ["Churn baseline", "Build cost"],
      participants: [ANALYST, ENG],
      runtimes: [runtime],
      maxTurns: options.maxTurns ?? 2,
      context: options.context,
      groundingProvider: options.provider,
      clock,
      newId: sequentialIdFactory(),
    }),
  };
}

function chatOf(transcript: ChannelMessage[]) {
  return transcript.filter((m) => m.kind === "chat");
}

describe("turn grounding", () => {
  it("retrieves once per turn, for the persona about to speak", async () => {
    const provider = new StubProvider((r) => ({
      passages: [`passage for ${r.persona.id}`],
      sources: [{ label: `doc · ${r.persona.id}` }],
    }));
    const h = build({ provider });
    const { orchestrator } = await h.meeting;

    await orchestrator.run();

    expect(provider.calls.map((c) => c.persona.id)).toEqual(["data", "eng"]);
    expect(provider.calls.map((c) => c.turnIndex)).toEqual([0, 1]);
    // Each agent sees its own passages, not the union of everyone's.
    expect(h.runtime.seen).toEqual([
      { personaId: "data", context: ["passage for data"] },
      { personaId: "eng", context: ["passage for eng"] },
    ]);
  });

  it("appends retrieved passages after the meeting's pinned context", async () => {
    const provider = new StubProvider(() => ({ passages: ["retrieved"] }));
    const h = build({ provider, context: ["pinned"], maxTurns: 1 });
    const { orchestrator } = await h.meeting;

    await orchestrator.step();

    // Order matters: pinned material is what the human chose, and stays first.
    expect(h.runtime.seen[0]!.context).toEqual(["pinned", "retrieved"]);
  });

  it("records provenance on the message the turn produced", async () => {
    const provider = new StubProvider(() => ({
      passages: ["Churn was 4.1% in Q2."],
      sources: [{ label: "Q2 metrics · p.3", documentId: "12", page: 3, excerpt: "Churn was 4.1%" }],
    }));
    const h = build({ provider, maxTurns: 1 });
    const { orchestrator, config } = await h.meeting;

    await orchestrator.step();

    const [message] = chatOf(await h.store.read(config.channelId));
    expect(message!.meta?.grounding).toEqual([
      { label: "Q2 metrics · p.3", documentId: "12", page: 3, excerpt: "Churn was 4.1%" },
    ]);
  });

  it("distinguishes 'searched and found nothing' from 'never searched'", async () => {
    const grounded = build({
      provider: new StubProvider(() => ({ passages: [], sources: [] })),
      maxTurns: 1,
    });
    await (await grounded.meeting).orchestrator.step();
    const [groundedMessage] = chatOf(await grounded.store.read((await grounded.meeting).config.channelId));
    expect(groundedMessage!.meta?.grounding).toEqual([]);

    const ungrounded = build({ maxTurns: 1 });
    await (await ungrounded.meeting).orchestrator.step();
    const [plainMessage] = chatOf(
      await ungrounded.store.read((await ungrounded.meeting).config.channelId),
    );
    expect(plainMessage!.meta).not.toHaveProperty("grounding");
  });

  it("keeps the meeting running when retrieval throws, and reports it", async () => {
    const failures: Array<{ message: string; personaId: string }> = [];
    const clock = fixedClock(1_700_000_000_000, 1_000);
    const store = new InMemoryChannelStore(clock, sequentialIdFactory());
    const channel = await store.createChannel({
      id: "chan_1",
      slug: "renewal-risk",
      name: "Renewal risk",
      workspaceId: "ws_1",
    });

    const orchestrator = new MeetingOrchestrator({
      store,
      config: {
        id: "mtg_1",
        channelId: channel.id,
        workspaceId: "ws_1",
        title: "Renewal risk",
        objective: "Decide whether to build the retention dashboard",
        agenda: [],
        participants: [ANALYST, ENG],
        turnPolicy: { kind: "round_robin" },
        maxTurns: 2,
      },
      runtimes: [new ScriptedAgentRuntime({ data: ["Churn is 4%."], eng: ["Two sprints."] })],
      groundingProvider: {
        retrieve: () => Promise.reject(new Error("index unavailable")),
      },
      onGroundingError: (error, personaId) =>
        failures.push({ message: error.message, personaId }),
      clock,
    });

    const state = await orchestrator.run();

    // A broken index degrades the answer. It must not end the meeting.
    expect(state.status).toBe("completed");
    expect(chatOf(await store.read(channel.id))).toHaveLength(2);
    // Both turns happened, and both were reported as ungrounded rather than
    // silently passing off as grounded.
    expect(failures).toEqual([
      { message: "index unavailable", personaId: "data" },
      { message: "index unavailable", personaId: "eng" },
    ]);
    for (const message of chatOf(await store.read(channel.id))) {
      expect(message.meta).not.toHaveProperty("grounding");
    }
  });

  it("scores grounding from retrieved excerpts, not just pinned context", async () => {
    const provider = new StubProvider(() => ({
      passages: ["Churn was 4% in Q2 across 1200 accounts."],
      sources: [{ label: "Q2 metrics", excerpt: "Churn was 4% in Q2 across 1200 accounts." }],
    }));
    const h = build({
      provider,
      script: { data: ["Churn is 4%, so 1200 accounts are in scope."], eng: ["Noted."] },
      maxTurns: 1,
    });
    const { orchestrator, config } = await h.meeting;
    await orchestrator.step();

    const transcript = await h.store.read(config.channelId);
    const result = evaluateMeeting(config, orchestrator.getState(), transcript);
    const grounding = result.dimensions.find((d) => d.id === "grounding")!;

    // Before retrieval existed this dimension abstained (weight 0) whenever
    // config.context was empty — which is every retrieval-grounded meeting.
    expect(grounding.weight).toBeGreaterThan(0);
    expect(grounding.score).toBe(1);
  });
});

describe("buildGroundingQuery", () => {
  const base: TurnGroundingRequest = {
    meetingId: "mtg_1",
    persona: ANALYST,
    objective: "Decide whether to build the retention dashboard",
    agenda: ["Churn baseline", "Build cost"],
    transcript: [],
    turnIndex: 0,
  };

  it("uses the agenda only before anything has been said", () => {
    const query = buildGroundingQuery(base);
    expect(query).toContain("Data analyst");
    expect(query).toContain("retention dashboard");
    expect(query).toContain("Churn baseline");
  });

  it("prefers the last substantive message once the room is talking", () => {
    const message = {
      id: "m1",
      channelId: "c1",
      seq: 2,
      ts: "2026-01-01T00:00:00.000Z",
      author: { kind: "agent" as const, id: "eng", displayName: "Marcus" },
      text: "What does the indemnity cap actually commit us to?",
      kind: "chat" as const,
    };
    const query = buildGroundingQuery({ ...base, transcript: [message] });

    expect(query).toContain("indemnity cap");
    // Querying the agenda too would retrieve the meeting's own framing back.
    expect(query).not.toContain("Build cost");
  });

  it("skips system messages when choosing the last thing said", () => {
    const system = {
      id: "m1",
      channelId: "c1",
      seq: 1,
      ts: "2026-01-01T00:00:00.000Z",
      author: { kind: "agent" as const, id: "system", displayName: "Launchstack" },
      text: "Meeting paused.",
      kind: "system" as const,
    };
    expect(buildGroundingQuery({ ...base, transcript: [system] })).not.toContain("Meeting paused");
  });
});

describe("toExcerpt", () => {
  it("collapses whitespace and truncates long passages", () => {
    expect(toExcerpt("a\n\n  b   c")).toBe("a b c");
    const long = "x".repeat(500);
    const excerpt = toExcerpt(long, 20);
    expect(excerpt).toHaveLength(20);
    expect(excerpt.endsWith("…")).toBe(true);
  });
});
