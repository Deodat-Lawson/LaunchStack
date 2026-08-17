/**
 * The rooms API.
 *
 * What matters here: a room belongs to one workspace and cannot be reached from
 * another; asking runs every member concurrently and settles each one
 * independently; and retrieval happens as the *asker*, not the room's creator,
 * so a room cannot be used to read documents you could not read yourself.
 */

import {
  askRoom,
  InMemoryChannelStore,
  ScriptedAgentRuntime,
  fixedClock,
  sequentialIdFactory,
  type AgentPersona,
} from "@launchstack/core/collab";

interface StoredRoom {
  id: string;
  companyId: bigint;
  channelId: string;
  name: string;
  purpose: string | null;
  members: Array<AgentPersona & { documentIds: string[] }>;
  archived: boolean;
  createdByUserId: string;
  createdAt: Date;
}

const mockCtx: {
  userId: string | null;
  companyId: bigint;
  rooms: StoredRoom[];
  /** Records who retrieval ran as, per member. */
  retrievalActors: Array<{ memberId: string; actorUserId: string }>;
} = {
  userId: "user_1",
  companyId: 7n,
  rooms: [],
  retrievalActors: [],
};

const mockStore = new InMemoryChannelStore(
  fixedClock(1_700_000_000_000, 1_000),
  sequentialIdFactory(),
);
const mockNewId = sequentialIdFactory();

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
          response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
        }),
}));

jest.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ sessionClaims: { name: "Priya" } }),
}));

jest.mock("~/server/collab/store", () => ({
  getChannelStore: () => mockStore,
}));

// Keeps the Postgres client and the retriever stack from loading — both reach
// `~/env`, which is ESM-only and cannot be required under Jest. Retrieval
// itself is substituted at the runtime level below.
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/lib/tools/rag", () => ({ executeRAGSearch: () => Promise.resolve({ results: [] }) }));
jest.mock("~/server/collab/chat", () => ({
  createCollabChatFn: () => () => Promise.resolve("stubbed"),
}));

jest.mock("~/server/collab/personas", () => ({
  ensureStarterPersonas: () =>
    Promise.resolve([
      { id: "web", displayName: "WEB", role: "web specialist", systemPrompt: "x" },
      { id: "mobile", displayName: "MOBILE", role: "mobile specialist", systemPrompt: "x" },
    ]),
  listPersonas: () => Promise.resolve([]),
}));

jest.mock("~/server/collab/rooms", () => {
  const actual: { rowToConfig: (row: StoredRoom) => unknown } =
    jest.requireActual("~/server/collab/rooms");
  return {
    ...actual,
    getRoom: (roomId: string, companyId: bigint) =>
      Promise.resolve(
        mockCtx.rooms.find((r) => r.id === roomId && r.companyId === companyId) ?? null,
      ),
    listRoomsForCompany: (companyId: bigint) =>
      Promise.resolve(mockCtx.rooms.filter((r) => r.companyId === companyId)),
    // Substitutes the model + retrieval, and records the actor each member's
    // retrieval ran as — the escalation guard this route exists to hold.
    buildRoomRuntimes: (input: {
      members: Array<{ id: string }>;
      actorUserId: string;
    }) => {
      // Required inside the factory: jest hoists `jest.mock` above the imports,
      // so the module-scope binding does not exist yet when this is defined.
      const { ScriptedAgentRuntime: Scripted }: { ScriptedAgentRuntime: typeof ScriptedAgentRuntime } =
        jest.requireActual("@launchstack/core/collab");
      const script: Record<string, string[]> = {};
      for (const member of input.members) {
        mockCtx.retrievalActors.push({ memberId: member.id, actorUserId: input.actorUserId });
        script[member.id] = [`${member.id} answers from its own documents.`];
      }
      return [new Scripted(script)];
    },
  };
});

async function loadRoutes() {
  return {
    collection: await import("~/app/api/collab/rooms/route"),
    detail: await import("~/app/api/collab/rooms/[roomId]/route"),
    ask: await import("~/app/api/collab/rooms/[roomId]/ask/route"),
  };
}

function member(id: string, documentIds: string[]): AgentPersona & { documentIds: string[] } {
  return {
    id,
    displayName: id.toUpperCase(),
    role: `${id} specialist`,
    systemPrompt: "Answer from your own sources.",
    documentIds,
  };
}

/** Monotonic across the file: the store outlives `beforeEach`, the rooms don't. */
let mockSeed = 0;

async function seedRoom(overrides: Partial<StoredRoom> = {}): Promise<StoredRoom> {
  const channelId = `chan_${++mockSeed}`;
  await mockStore.createChannel({
    id: channelId,
    slug: channelId,
    name: "Room",
    workspaceId: String(overrides.companyId ?? mockCtx.companyId),
  });
  const room: StoredRoom = {
    id: `room_${mockSeed}`,
    companyId: mockCtx.companyId,
    channelId,
    name: "API token change",
    purpose: "Find out what breaks",
    members: [member("web", ["1", "2"]), member("mobile", ["3"])],
    archived: false,
    createdByUserId: "creator_9",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
  mockCtx.rooms.push(room);
  return room;
}

function askRequest(body: unknown): Request {
  return new Request("http://localhost/api/collab/rooms/x/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockCtx.userId = "user_1";
  mockCtx.companyId = 7n;
  mockCtx.rooms = [];
  mockCtx.retrievalActors = [];
  jest.resetModules();
});

describe("POST /api/collab/rooms/[roomId]/ask", () => {
  it("asks every member and settles each independently", async () => {
    const room = await seedRoom();
    const { ask } = await loadRoutes();

    const response = await ask.POST(askRequest({ text: "What breaks?" }), {
      params: Promise.resolve({ roomId: room.id }),
    });
    const body = (await response.json()) as {
      roundId: string;
      answers: Array<{ memberId: string; status: string }>;
    };

    expect(response.status).toBe(201);
    expect(body.answers.map((a) => a.memberId)).toEqual(["web", "mobile"]);
    expect(body.answers.every((a) => a.status === "answered")).toBe(true);
  });

  it("retrieves as the asker, not the room's creator", async () => {
    // Otherwise a room launders access: ask a question, get an answer drawn
    // from documents the asker could not open themselves.
    const room = await seedRoom({ createdByUserId: "creator_9" });
    mockCtx.userId = "asker_2";
    const { ask } = await loadRoutes();

    await ask.POST(askRequest({ text: "What breaks?" }), {
      params: Promise.resolve({ roomId: room.id }),
    });

    expect(mockCtx.retrievalActors.length).toBeGreaterThan(0);
    for (const call of mockCtx.retrievalActors) {
      expect(call.actorUserId).toBe("asker_2");
      expect(call.actorUserId).not.toBe(room.createdByUserId);
    }
  });

  it("asks only the named subset", async () => {
    const room = await seedRoom();
    const { ask } = await loadRoutes();

    const response = await ask.POST(askRequest({ text: "What breaks?", memberIds: ["mobile"] }), {
      params: Promise.resolve({ roomId: room.id }),
    });
    const body = (await response.json()) as { answers: Array<{ memberId: string }> };

    expect(body.answers.map((a) => a.memberId)).toEqual(["mobile"]);
  });

  it("rejects a member that is not in the room", async () => {
    const room = await seedRoom();
    const { ask } = await loadRoutes();

    const response = await ask.POST(askRequest({ text: "hi", memberIds: ["infra"] }), {
      params: Promise.resolve({ roomId: room.id }),
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("infra");
  });

  it("404s a room in another workspace and 400s an empty question", async () => {
    const room = await seedRoom({ companyId: 999n });
    const { ask } = await loadRoutes();

    const foreign = await ask.POST(askRequest({ text: "hi" }), {
      params: Promise.resolve({ roomId: room.id }),
    });
    expect(foreign.status).toBe(404);

    const mine = await seedRoom();
    const empty = await ask.POST(askRequest({ text: "" }), {
      params: Promise.resolve({ roomId: mine.id }),
    });
    expect(empty.status).toBe(400);
  });

  it("requires a workspace", async () => {
    mockCtx.userId = null;
    const { ask } = await loadRoutes();
    const response = await ask.POST(askRequest({ text: "hi" }), {
      params: Promise.resolve({ roomId: "room_1" }),
    });
    expect(response.status).toBe(401);
  });
});

describe("GET /api/collab/rooms/[roomId]", () => {
  it("returns the log and the rounds derived from it", async () => {
    const room = await seedRoom();
    const { detail } = await loadRoutes();

    await askRoom({
      store: mockStore,
      room: {
        id: room.id,
        channelId: room.channelId,
        workspaceId: "7",
        name: room.name,
        members: room.members,
      },
      runtimes: [new ScriptedAgentRuntime({ web: ["a"], mobile: ["b"] })],
      question: { text: "Q?", author: { kind: "human", id: "user_1", displayName: "Priya" } },
      newId: mockNewId,
    });

    const response = await detail.GET(new Request("http://localhost/api/collab/rooms/x"), {
      params: Promise.resolve({ roomId: room.id }),
    });
    const body = (await response.json()) as {
      rounds: Array<{ complete: boolean; settled: unknown[] }>;
      messages: unknown[];
    };

    expect(response.status).toBe(200);
    expect(body.rounds).toHaveLength(1);
    expect(body.rounds[0]!.complete).toBe(true);
    expect(body.rounds[0]!.settled).toHaveLength(2);
    expect(body.messages).toHaveLength(3); // question + two answers
  });

  it("404s a room in another workspace", async () => {
    const room = await seedRoom({ companyId: 999n });
    const { detail } = await loadRoutes();
    const response = await detail.GET(new Request("http://localhost/api/collab/rooms/x"), {
      params: Promise.resolve({ roomId: room.id }),
    });
    expect(response.status).toBe(404);
  });
});

describe("GET /api/collab/rooms", () => {
  it("lists only this workspace's rooms", async () => {
    await seedRoom({ name: "Mine" });
    await seedRoom({ name: "Theirs", companyId: 999n });
    const { collection } = await loadRoutes();

    const body = (await (await collection.GET()).json()) as {
      rooms: Array<{ name: string; members: Array<{ documentCount: number }> }>;
    };

    expect(body.rooms.map((r) => r.name)).toEqual(["Mine"]);
    expect(body.rooms[0]!.members.map((m) => m.documentCount)).toEqual([2, 1]);
  });
});
