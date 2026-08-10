/**
 * Meeting API routes.
 *
 * Postgres and Clerk are substituted; the collaboration engine is not. The
 * routes drive a real `MeetingOrchestrator` over a real `InMemoryChannelStore`,
 * so these tests cover the part that actually breaks — validation, tenant
 * scoping, control dispatch, and the shapes the UI consumes.
 */

import {
  createMeeting,
  InMemoryChannelStore,
  ScriptedAgentRuntime,
  type AgentPersona,
  type MeetingOrchestrator,
} from "@launchstack/core/collab";

interface Harness {
  store: InMemoryChannelStore;
  meetings: Map<
    string,
    { orchestrator: MeetingOrchestrator; config: Parameters<typeof mockBuildRow>[0]; row: ReturnType<typeof mockBuildRow> }
  >;
}

function mockBuildRow(config: {
  id: string;
  channelId: string;
  title: string;
  objective: string;
  maxTurns: number;
  participants: AgentPersona[];
}) {
  return {
    id: config.id,
    channelId: config.channelId,
    title: config.title,
    objective: config.objective,
    maxTurns: config.maxTurns,
    participants: config.participants,
    turnIndex: 0,
    status: "scheduled" as const,
    slackChannelId: null as string | null,
    slackMirrorEnabled: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    startedAt: null as Date | null,
    endedAt: null as Date | null,
  };
}

// jest.mock factories are hoisted, so shared state has to live behind a
// `mock`-prefixed binding.
const mockCtx: {
  userId: string | null;
  companyId: bigint;
  harness: Harness;
  personas: Array<AgentPersona & { dbId: string; archived: boolean }>;
  script: Record<string, string[]>;
} = {
  userId: "user_1",
  companyId: 7n,
  harness: { store: new InMemoryChannelStore(), meetings: new Map() },
  personas: [],
  script: {},
};

jest.mock("@clerk/nextjs/server", () => ({
  auth: () =>
    Promise.resolve({
      userId: mockCtx.userId,
      sessionClaims: { name: "Alex Chen" },
    }),
}));

jest.mock("~/lib/require-workspace-context", () => ({
  requireWorkspaceContext: () =>
    mockCtx.userId
      ? Promise.resolve({
          success: true,
          data: {
            clerkUserId: mockCtx.userId,
            userPk: 1n,
            companyId: mockCtx.companyId,
            role: "owner",
            status: "verified",
          },
        })
      : Promise.resolve({
          success: false,
          response: new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
          }),
        }),
}));

jest.mock("~/server/collab/store", () => ({
  getChannelStore: () => mockCtx.harness.store,
}));

jest.mock("~/server/collab/personas", () => ({
  ensureStarterPersonas: () => Promise.resolve(mockCtx.personas),
  listPersonas: () => Promise.resolve(mockCtx.personas),
}));

jest.mock("~/server/collab/runtime", () => {
  const engine = jest.requireActual<typeof import("@launchstack/core/collab")>(
    "@launchstack/core/collab",
  );
  return {
    listMeetingsForCompany: () =>
      Promise.resolve([...mockCtx.harness.meetings.values()].map((m) => m.row)),
    getHub: () => null,
    getMeetingRuntime: (meetingId: string) => {
      const entry = mockCtx.harness.meetings.get(meetingId);
      return Promise.resolve(
        entry ? { orchestrator: entry.orchestrator, config: entry.config, row: entry.row } : null,
      );
    },
    createMeetingForCompany: async (input: {
      title: string;
      objective: string;
      agenda?: string[];
      participants: AgentPersona[];
      turnPolicy?: { kind: "round_robin" | "moderated" | "reactive"; moderatorId?: string };
      maxTurns?: number;
    }) => {
      const created = await engine.createMeeting({
        store: mockCtx.harness.store,
        workspaceId: String(mockCtx.companyId),
        title: input.title,
        objective: input.objective,
        agenda: input.agenda,
        participants: input.participants,
        runtimes: [new engine.ScriptedAgentRuntime(mockCtx.script)],
        turnPolicy: input.turnPolicy,
        maxTurns: input.maxTurns,
      });
      const row = mockBuildRow({
        id: created.config.id,
        channelId: created.config.channelId,
        title: created.config.title,
        objective: created.config.objective,
        maxTurns: created.config.maxTurns,
        participants: created.config.participants,
      });
      mockCtx.harness.meetings.set(created.config.id, {
        orchestrator: created.orchestrator,
        config: created.config,
        row,
      });
      return { orchestrator: created.orchestrator, config: created.config, row };
    },
  };
});

import { GET as listMeetings, POST as createMeetingRoute } from "~/app/api/collab/meetings/route";
import { GET as getMeeting } from "~/app/api/collab/meetings/[meetingId]/route";
import { POST as control } from "~/app/api/collab/meetings/[meetingId]/control/route";
import { POST as postMessage } from "~/app/api/collab/meetings/[meetingId]/messages/route";

const PERSONAS = [
  { dbId: "p1", id: "pm", displayName: "Priya", role: "Product lead", systemPrompt: "Lead.", archived: false },
  { dbId: "p2", id: "eng", displayName: "Sam", role: "Engineering lead", systemPrompt: "Build.", archived: false },
];

function jsonRequest(body: unknown, url = "http://localhost/api/collab/meetings") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(meetingId: string) {
  return { params: Promise.resolve({ meetingId }) };
}

async function startMeeting(overrides: Record<string, unknown> = {}) {
  const response = await createMeetingRoute(
    jsonRequest({
      title: "Q3 pricing review",
      objective: "Agree a Q3 price change",
      participantKeys: ["pm", "eng"],
      maxTurns: 4,
      ...overrides,
    }),
  );
  const body = (await response.json()) as { meeting?: { id: string; channelId: string } };
  return { response, meeting: body.meeting! };
}

describe("collab meeting routes", () => {
  beforeEach(() => {
    mockCtx.userId = "user_1";
    mockCtx.companyId = 7n;
    mockCtx.harness = { store: new InMemoryChannelStore(), meetings: new Map() };
    mockCtx.personas = [...PERSONAS];
    mockCtx.script = {
      pm: ["Margin is 42%. @eng feasibility?", "Decision: we'll go with tier B."],
      eng: ["Two sprints. I'll own the migration.", "Confirmed. MEETING_COMPLETE"],
    };
  });

  describe("authentication", () => {
    it("rejects every route when signed out", async () => {
      mockCtx.userId = null;

      expect((await listMeetings()).status).toBe(401);
      expect((await createMeetingRoute(jsonRequest({}))).status).toBe(401);
      expect(
        (await getMeeting(new Request("http://localhost/x"), params("mtg_1"))).status,
      ).toBe(401);
      expect((await control(jsonRequest({ action: "run" }), params("mtg_1"))).status).toBe(401);
      expect((await postMessage(jsonRequest({ text: "hi" }), params("mtg_1"))).status).toBe(401);
    });
  });

  describe("POST /api/collab/meetings", () => {
    it("creates a channel-backed meeting and returns its state", async () => {
      const { response, meeting } = await startMeeting();

      expect(response.status).toBe(201);
      expect(meeting.id).toMatch(/^mtg_/);

      const channel = await mockCtx.harness.store.getChannel(meeting.channelId);
      expect(channel?.slug).toBe("q3-pricing-review");
      expect(channel?.workspaceId).toBe("7");
    });

    it("starts the meeting when asked, posting the kickoff message", async () => {
      const { meeting } = await startMeeting({ autoStart: true });

      const messages = await mockCtx.harness.store.read(meeting.channelId);
      expect(messages[0]!.kind).toBe("system");
      expect(messages[0]!.text).toContain("Q3 pricing review");
    });

    it("rejects an unknown participant rather than silently dropping it", async () => {
      const response = await createMeetingRoute(
        jsonRequest({
          title: "T",
          objective: "O",
          participantKeys: ["pm", "ghost"],
        }),
      );
      expect(response.status).toBe(400);
      expect((await response.json()) as { error: string }).toEqual({
        error: 'Unknown participant "ghost"',
      });
    });

    it("rejects a moderator who is not on the roster", async () => {
      const response = await createMeetingRoute(
        jsonRequest({
          title: "T",
          objective: "O",
          participantKeys: ["pm"],
          turnPolicy: "moderated",
          moderatorKey: "nobody",
        }),
      );
      expect(response.status).toBe(400);
    });

    it("validates the payload", async () => {
      for (const body of [
        {},
        { title: "T" },
        { title: "T", objective: "O", participantKeys: [] },
        { title: "T", objective: "O", participantKeys: ["pm"], maxTurns: 0 },
        { title: "T", objective: "O", participantKeys: ["pm"], maxTurns: 999 },
      ]) {
        expect((await createMeetingRoute(jsonRequest(body))).status).toBe(400);
      }
    });
  });

  describe("GET /api/collab/meetings", () => {
    it("lists meetings with their channel handles", async () => {
      await startMeeting();

      const body = (await (await listMeetings()).json()) as {
        meetings: Array<{ title: string; channelSlug: string; participants: unknown[] }>;
      };

      expect(body.meetings).toHaveLength(1);
      expect(body.meetings[0]).toMatchObject({
        title: "Q3 pricing review",
        channelSlug: "q3-pricing-review",
      });
      expect(body.meetings[0]!.participants).toHaveLength(2);
    });
  });

  describe("GET /api/collab/meetings/[id]", () => {
    it("returns the transcript, state, and minutes", async () => {
      const { meeting } = await startMeeting();
      await control(jsonRequest({ action: "run", limit: 4 }), params(meeting.id));

      const response = await getMeeting(
        new Request(`http://localhost/api/collab/meetings/${meeting.id}`),
        params(meeting.id),
      );
      const body = (await response.json()) as {
        meeting: { title: string; channelSlug: string };
        state: { status: string };
        messages: Array<{ text: string; author: { id: string } }>;
        minutes: { decisions: unknown[]; actionItems: Array<{ owner?: string }> };
      };

      expect(response.status).toBe(200);
      expect(body.meeting.channelSlug).toBe("q3-pricing-review");
      expect(body.state.status).toBe("completed");
      expect(body.messages.some((m) => m.author.id === "pm")).toBe(true);
      expect(body.minutes.decisions.length).toBeGreaterThan(0);
      expect(body.minutes.actionItems.some((a) => a.owner === "eng")).toBe(true);
    });

    it("returns only the tail when afterSeq is given, but complete minutes", async () => {
      const { meeting } = await startMeeting();
      await control(jsonRequest({ action: "run", limit: 4 }), params(meeting.id));

      const response = await getMeeting(
        new Request(`http://localhost/api/collab/meetings/${meeting.id}?afterSeq=3`),
        params(meeting.id),
      );
      const body = (await response.json()) as {
        messages: Array<{ seq: number }>;
        latestSeq: number;
        minutes: { turnsTaken: number };
      };

      expect(body.messages.every((m) => m.seq > 3)).toBe(true);
      expect(body.latestSeq).toBeGreaterThan(3);
      expect(body.minutes.turnsTaken).toBe(4);
    });

    it("404s a meeting that does not belong to this workspace", async () => {
      const response = await getMeeting(new Request("http://localhost/x"), params("mtg_other"));
      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/collab/meetings/[id]/control", () => {
    it("advances one turn at a time with step", async () => {
      const { meeting } = await startMeeting();

      const first = await control(jsonRequest({ action: "step" }), params(meeting.id));
      const firstBody = (await first.json()) as { state: { turnIndex: number } };
      expect(firstBody.state.turnIndex).toBe(1);

      const second = await control(jsonRequest({ action: "step" }), params(meeting.id));
      expect(((await second.json()) as { state: { turnIndex: number } }).state.turnIndex).toBe(2);
    });

    it("bounds run so a request cannot span the whole meeting", async () => {
      const { meeting } = await startMeeting({ maxTurns: 20 });

      const response = await control(jsonRequest({ action: "run", limit: 2 }), params(meeting.id));
      expect(((await response.json()) as { state: { turnIndex: number } }).state.turnIndex).toBe(2);
    });

    it("pauses, takes over, releases, and completes", async () => {
      const { meeting } = await startMeeting({ maxTurns: 10 });
      await control(jsonRequest({ action: "start" }), params(meeting.id));

      const paused = await control(jsonRequest({ action: "pause" }), params(meeting.id));
      expect(((await paused.json()) as { state: { status: string } }).state.status).toBe("paused");

      const takeover = await control(
        jsonRequest({ action: "takeover", asPersonaId: "pm" }),
        params(meeting.id),
      );
      const takeoverState = (await takeover.json()) as {
        state: { status: string; controller?: { displayName: string; asPersonaId?: string } };
      };
      expect(takeoverState.state.status).toBe("human_control");
      expect(takeoverState.state.controller).toMatchObject({
        displayName: "Alex Chen",
        asPersonaId: "pm",
      });

      const released = await control(jsonRequest({ action: "release" }), params(meeting.id));
      expect(((await released.json()) as { state: { status: string } }).state.status).toBe("running");

      const done = await control(jsonRequest({ action: "complete" }), params(meeting.id));
      expect(((await done.json()) as { state: { status: string } }).state.status).toBe("completed");
    });

    it("reports a bad takeover as a 400, not a 500", async () => {
      const { meeting } = await startMeeting();
      const response = await control(
        jsonRequest({ action: "takeover", asPersonaId: "not-in-this-meeting" }),
        params(meeting.id),
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toMatch(/Unknown persona/);
    });

    it("rejects an unknown action", async () => {
      const { meeting } = await startMeeting();
      expect((await control(jsonRequest({ action: "detonate" }), params(meeting.id))).status).toBe(400);
    });
  });

  describe("POST /api/collab/meetings/[id]/messages", () => {
    it("posts a human message attributed to the signed-in user", async () => {
      const { meeting } = await startMeeting();

      const response = await postMessage(
        jsonRequest({ text: "Legal is still reviewing the tier names." }),
        params(meeting.id),
      );
      const body = (await response.json()) as {
        message: { author: { kind: string; displayName: string; id: string } };
      };

      expect(response.status).toBe(201);
      expect(body.message.author).toMatchObject({ kind: "human", displayName: "Alex Chen", id: "user_1" });
    });

    it("attributes the message to the held seat during a takeover", async () => {
      const { meeting } = await startMeeting();
      await control(jsonRequest({ action: "takeover", asPersonaId: "eng" }), params(meeting.id));

      const response = await postMessage(jsonRequest({ text: "Engineering says two sprints." }), params(meeting.id));
      const body = (await response.json()) as {
        message: { author: { onBehalfOfPersonaId?: string } };
      };
      expect(body.message.author.onBehalfOfPersonaId).toBe("eng");
    });

    it("refuses to post into a finished meeting", async () => {
      const { meeting } = await startMeeting();
      await control(jsonRequest({ action: "complete" }), params(meeting.id));

      const response = await postMessage(jsonRequest({ text: "one more thing" }), params(meeting.id));
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toMatch(/ended/);
    });

    it("rejects empty and oversized messages", async () => {
      const { meeting } = await startMeeting();
      expect((await postMessage(jsonRequest({ text: "" }), params(meeting.id))).status).toBe(400);
      expect(
        (await postMessage(jsonRequest({ text: "x".repeat(8_001) }), params(meeting.id))).status,
      ).toBe(400);
    });
  });

  it("keeps a full human-in-the-loop meeting coherent end to end", async () => {
    const { meeting } = await startMeeting({ maxTurns: 6 });

    await control(jsonRequest({ action: "step" }), params(meeting.id));
    await control(jsonRequest({ action: "takeover" }), params(meeting.id));
    await postMessage(jsonRequest({ text: "Hold — finance wants tier C considered." }), params(meeting.id));

    // Agents are genuinely blocked while the human holds the floor.
    const blocked = await control(jsonRequest({ action: "step" }), params(meeting.id));
    expect(((await blocked.json()) as { state: { turnIndex: number } }).state.turnIndex).toBe(1);

    await control(jsonRequest({ action: "release" }), params(meeting.id));
    await control(jsonRequest({ action: "run", limit: 3 }), params(meeting.id));

    const detail = (await (
      await getMeeting(new Request("http://localhost/x"), params(meeting.id))
    ).json()) as {
      messages: Array<{ author: { kind: string }; kind: string; text: string }>;
      minutes: { humanInterventions: number };
    };

    expect(detail.minutes.humanInterventions).toBe(1);
    expect(detail.messages.some((m) => m.text.includes("finance wants tier C"))).toBe(true);
    expect(detail.messages.some((m) => m.kind === "system" && m.text.includes("took the floor"))).toBe(true);
    expect(detail.messages.filter((m) => m.author.kind === "agent" && m.kind === "chat").length).toBeGreaterThan(1);
  });
});

// Referenced by the runtime mock; kept out of the factory so the import is
// visible to the type checker.
void ScriptedAgentRuntime;
void createMeeting;
