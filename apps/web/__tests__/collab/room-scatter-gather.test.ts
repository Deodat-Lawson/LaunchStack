/**
 * Rooms — one question, every member, each from its own context.
 *
 * The assertions here are about the *primitive*: what lands in the log, in what
 * order, and what happens when a member fails, declines, hangs, or has no
 * runtime at all. Answer quality is not in scope; the whole point of a room is
 * that each member answers from material the others cannot see.
 */

import {
  askRoom,
  extractDecline,
  fixedClock,
  InMemoryChannelStore,
  ScriptedAgentRuntime,
  sequentialIdFactory,
  summarizeRounds,
  type AgentPersona,
  type AgentRuntime,
  type AgentTurnRequest,
  type AgentTurnResult,
  type ChannelMessage,
  type RoomConfig,
} from "@launchstack/core/collab";

const WEB: AgentPersona = {
  id: "web",
  displayName: "Web",
  role: "Frontend repo",
  systemPrompt: "Answer from the web app.",
};
const MOBILE: AgentPersona = {
  id: "mobile",
  displayName: "Mobile",
  role: "iOS repo",
  systemPrompt: "Answer from the iOS app.",
};
const INFRA: AgentPersona = {
  id: "infra",
  displayName: "Infra",
  role: "Terraform",
  systemPrompt: "Answer from infrastructure.",
};

const ASKER = { kind: "human" as const, id: "user_1", displayName: "Priya" };

async function harness(members: AgentPersona[] = [WEB, MOBILE, INFRA]) {
  const clock = fixedClock(1_700_000_000_000, 1_000);
  const store = new InMemoryChannelStore(clock, sequentialIdFactory());
  // One factory for the whole harness: a fresh one per round would hand every
  // round the same id, which is only ever true of a sequential test factory.
  const newId = sequentialIdFactory();
  const channel = await store.createChannel({
    id: "chan_room",
    slug: "api-token-change",
    name: "API token change",
    workspaceId: "ws_1",
  });
  const room: RoomConfig = {
    id: "room_1",
    channelId: channel.id,
    workspaceId: "ws_1",
    name: "API token change",
    purpose: "Find out what breaks",
    members,
  };
  return { clock, store, room, newId };
}

function ask(
  h: Awaited<ReturnType<typeof harness>>,
  runtimes: AgentRuntime[],
  options: { text?: string; memberIds?: string[]; timeoutMs?: number } = {},
) {
  return askRoom({
    store: h.store,
    room: h.room,
    runtimes,
    question: { text: options.text ?? "Changing the auth token to a JWT. What breaks?", author: ASKER },
    memberIds: options.memberIds,
    timeoutMs: options.timeoutMs,
    clock: h.clock,
    newId: h.newId,
  });
}

/** Records the context each member was handed. */
class SpyRuntime extends ScriptedAgentRuntime {
  readonly seen: Array<{ memberId: string; transcriptLength: number; mode?: string }> = [];

  async takeTurn(request: AgentTurnRequest): Promise<AgentTurnResult> {
    this.seen.push({
      memberId: request.persona.id,
      transcriptLength: request.transcript.length,
      mode: request.context.mode,
    });
    return super.takeTurn(request);
  }
}

/** A runtime that serves everyone and does whatever the test says. */
function fakeRuntime(
  behaviour: (persona: AgentPersona) => Promise<AgentTurnResult>,
): AgentRuntime {
  return { nodeId: "local", serves: () => true, takeTurn: (r) => behaviour(r.persona) };
}

describe("askRoom", () => {
  it("appends the question before every answer and settles all members", async () => {
    const h = await harness();
    const runtime = new SpyRuntime({
      web: ["3 call sites assume an opaque token."],
      mobile: ["We never decode it, but we pin length at 128."],
      infra: ["The ALB caps headers at 4KB."],
    });

    const result = await ask(h, [runtime]);

    expect(result.answers.map((a) => a.memberId)).toEqual(["web", "mobile", "infra"]);
    expect(result.answers.every((a) => a.status === "answered")).toBe(true);

    const transcript = await h.store.read(h.room.channelId);
    expect(transcript[0]!.id).toBe(result.question.id);
    for (const answer of result.answers) {
      expect(answer.message.seq).toBeGreaterThan(result.question.seq);
    }
  });

  it("gives each member the question only — never the other answers", async () => {
    const h = await harness();
    const runtime = new SpyRuntime({ web: ["a"], mobile: ["b"], infra: ["c"] });

    await ask(h, [runtime]);

    // If a member saw the others' answers, the first to finish would anchor the
    // rest and this would stop being a fan-out.
    expect(runtime.seen).toHaveLength(3);
    for (const seen of runtime.seen) {
      expect(seen.transcriptLength).toBe(1);
      expect(seen.mode).toBe("room");
    }
  });

  it("asks only the named subset", async () => {
    const h = await harness();
    const runtime = new ScriptedAgentRuntime({ web: ["a"], mobile: ["b"], infra: ["c"] });

    const result = await ask(h, [runtime], { memberIds: ["web", "infra"] });

    expect(result.answers.map((a) => a.memberId)).toEqual(["web", "infra"]);
    expect((result.question.meta!.round as { expected: string[] }).expected).toEqual([
      "web",
      "infra",
    ]);
  });

  it("keeps the round alive when one member throws", async () => {
    const h = await harness([WEB, MOBILE]);
    const runtime = fakeRuntime(async (persona) => {
      if (persona.id === "web") throw new Error("repo is locked");
      return { text: "Mobile is fine." };
    });

    const result = await ask(h, [runtime]);

    const web = result.answers.find((a) => a.memberId === "web")!;
    const mobile = result.answers.find((a) => a.memberId === "mobile")!;
    expect(web.status).toBe("failed");
    expect(web.error).toBe("repo is locked");
    // A failure is not content — the kind split is what stops the minutes
    // extractor and the Slack bridge reading an error as an answer.
    expect(web.message.kind).toBe("system");
    expect(mobile.status).toBe("answered");
    expect(mobile.message.kind).toBe("chat");
  });

  it("settles a member with no runtime rather than failing the round", async () => {
    const h = await harness([WEB, MOBILE]);
    // Serves only `web` — `mobile`'s machine is offline.
    const runtime = new ScriptedAgentRuntime({ web: ["Only I am reachable."] });

    const result = await ask(h, [runtime]);

    expect(result.answers.find((a) => a.memberId === "mobile")!.status).toBe("unserved");
    expect(result.answers.find((a) => a.memberId === "web")!.status).toBe("answered");
  });

  it("times a member out without stalling the others", async () => {
    const h = await harness([WEB, MOBILE]);
    const runtime = fakeRuntime(async (persona) => {
      if (persona.id === "web") return new Promise<AgentTurnResult>(() => undefined);
      return { text: "Answered immediately." };
    });

    const result = await ask(h, [runtime], { timeoutMs: 30 });

    const web = result.answers.find((a) => a.memberId === "web")!;
    expect(web.status).toBe("timeout");
    expect(web.message.kind).toBe("system");
    expect(result.answers.find((a) => a.memberId === "mobile")!.status).toBe("answered");
  });

  it("treats a decline as an answer, not a failure", async () => {
    const h = await harness([WEB, MOBILE]);
    const runtime = fakeRuntime(async (persona) =>
      persona.id === "web"
        ? { text: `Nothing here touches auth.\n${"NO_ANSWER"}` }
        : { text: "We pin token length at 128." },
    );

    const result = await ask(h, [runtime]);

    const web = result.answers.find((a) => a.memberId === "web")!;
    expect(web.status).toBe("declined");
    expect(web.message.kind).toBe("chat");
    // The marker is control flow and must never reach the transcript.
    expect(web.message.text).not.toContain("NO_ANSWER");
    expect(web.message.text).toContain("Nothing here touches auth.");
  });

  it("treats meta.declined from a remote worker as a decline", async () => {
    const h = await harness([WEB]);
    const runtime = fakeRuntime(async () => ({
      text: "I looked but found nothing.",
      meta: { declined: true, servedByNode: "laptop" },
    }));

    const result = await ask(h, [runtime]);

    expect(result.answers[0]!.status).toBe("declined");
    expect(result.answers[0]!.message.meta).toMatchObject({ servedByNode: "laptop" });
  });

  it("records provenance so an answer is attributable to its member", async () => {
    const h = await harness([WEB]);
    const runtime = fakeRuntime(async () => ({ text: "x", meta: { adapter: "workspace-qa" } }));

    const result = await ask(h, [runtime]);

    expect(result.answers[0]!.message.meta).toMatchObject({
      roomId: "room_1",
      roundId: result.roundId,
      memberId: "web",
      status: "answered",
      adapter: "workspace-qa",
    });
    expect(result.answers[0]!.message.author.id).toBe("web");
  });

  it("rejects a round with no members", async () => {
    const h = await harness();
    await expect(ask(h, [], { memberIds: ["nobody"] })).rejects.toThrow(/at least one member/);
  });
});

describe("summarizeRounds", () => {
  it("derives rounds from the log with no round table", async () => {
    const h = await harness([WEB, MOBILE]);
    const runtime = new ScriptedAgentRuntime({ web: ["a"], mobile: ["b"] });

    const first = await ask(h, [runtime], { text: "First question?" });
    const second = await ask(h, [runtime], { text: "Second question?" });

    const rounds = summarizeRounds(await h.store.read(h.room.channelId));

    expect(rounds).toHaveLength(2);
    expect(rounds[0]!.id).toBe(first.roundId);
    expect(rounds[0]!.text).toBe("First question?");
    expect(rounds[0]!.complete).toBe(true);
    expect(rounds[0]!.pending).toEqual([]);
    expect(rounds[0]!.settled.map((s) => s.memberId).sort()).toEqual(["mobile", "web"]);
    expect(rounds[1]!.id).toBe(second.roundId);
    // Ordered by question position, not by arrival.
    expect(rounds[0]!.questionSeq).toBeLessThan(rounds[1]!.questionSeq);
  });

  it("reports a round still in flight as incomplete", () => {
    const question: ChannelMessage = {
      id: "m1",
      channelId: "c",
      seq: 1,
      ts: "2026-01-01T00:00:00.000Z",
      author: ASKER,
      text: "Q?",
      kind: "chat",
      meta: { round: { id: "round_1", expected: ["web", "mobile"] } },
    };
    const answer: ChannelMessage = {
      ...question,
      id: "m2",
      seq: 2,
      author: { kind: "agent", id: "web", displayName: "Web" },
      text: "A",
      meta: { roundId: "round_1", memberId: "web", status: "answered" },
    };

    const [round] = summarizeRounds([question, answer]);

    expect(round!.complete).toBe(false);
    expect(round!.pending).toEqual(["mobile"]);
  });

  it("ignores messages that belong to no round", () => {
    const stray: ChannelMessage = {
      id: "m1",
      channelId: "c",
      seq: 1,
      ts: "2026-01-01T00:00:00.000Z",
      author: ASKER,
      text: "just chatting",
      kind: "chat",
    };
    expect(summarizeRounds([stray])).toEqual([]);
  });
});

describe("extractDecline", () => {
  it("strips the marker and reports it", () => {
    expect(extractDecline("nothing to add\nNO_ANSWER")).toEqual({
      text: "nothing to add",
      declined: true,
    });
    expect(extractDecline("here is the answer")).toEqual({
      text: "here is the answer",
      declined: false,
    });
  });
});
