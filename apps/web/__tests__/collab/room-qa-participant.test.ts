/**
 * Workspace Q&A room members.
 *
 * The property under test is the one the whole feature rests on: a member
 * answers from *its own* documents, retrieved under the *asker's* access, and
 * says so plainly when its sources don't cover the question. A member that
 * guesses fluently instead is worse than useless in a room, because the reader
 * cannot tell which answers were grounded.
 */

import type { AgentPersona, TurnContext } from "@launchstack/core/collab";

interface SearchCall {
  query: string;
  documentIds: string[];
  userId: string;
}

const mockCalls: SearchCall[] = [];
const mockResults = new Map<string, Array<Record<string, unknown>>>();
const mockPrompts: string[] = [];

jest.mock("~/lib/tools/rag", () => ({
  executeRAGSearch: (
    input: { query: string; documentIds: string[]; topK?: number },
    userId: string,
  ) => {
    mockCalls.push({ query: input.query, documentIds: input.documentIds, userId });
    const key = input.documentIds.join(",");
    return Promise.resolve({ results: mockResults.get(key) ?? [] });
  },
}));

jest.mock("~/server/collab/chat", () => ({
  createCollabChatFn: () => (request: { messages: Array<{ role: string; content: string }> }) => {
    mockPrompts.push(request.messages.map((m) => m.content).join("\n---\n"));
    return Promise.resolve("Clause 11.2 caps liability at 12 months of fees.");
  },
}));

function persona(id: string): AgentPersona {
  return { id, displayName: id, role: `${id} specialist`, systemPrompt: "Answer from sources." };
}

function turnContext(question: string): TurnContext {
  return {
    meetingId: "room_1",
    title: "Contract review",
    objective: question,
    agenda: [],
    context: [],
    roster: [],
    turnIndex: 0,
    maxTurns: 1,
    completionMarker: "NO_ANSWER",
    mode: "room",
  };
}

function questionTurn(question: string) {
  return {
    persona: persona("legal"),
    context: turnContext(question),
    transcript: [
      {
        id: "m1",
        channelId: "c",
        seq: 1,
        ts: "2026-01-01T00:00:00.000Z",
        author: { kind: "human" as const, id: "u", displayName: "Priya" },
        text: question,
        kind: "chat" as const,
      },
    ],
  };
}

async function load() {
  return import("~/server/collab/qa-participant");
}

beforeEach(() => {
  mockCalls.length = 0;
  mockPrompts.length = 0;
  mockResults.clear();
  jest.resetModules();
});

describe("WorkspaceQaRuntime", () => {
  it("serves only personas it has a binding for", async () => {
    const { WorkspaceQaRuntime } = await load();
    const runtime = new WorkspaceQaRuntime({
      binding: (p) => (p.id === "legal" ? { documentIds: ["1"] } : null),
      actorUserId: "asker",
    });

    expect(runtime.serves(persona("legal"))).toBe(true);
    expect(runtime.serves(persona("finance"))).toBe(false);
  });

  it("retrieves from the member's own documents, as the asker", async () => {
    mockResults.set("7,9", [
      { content: "Clause 11.2 caps liability at 12 months of fees.", page: 4, documentTitle: "MSA", relevanceScore: 0.8 },
    ]);
    const { WorkspaceQaRuntime } = await load();
    const runtime = new WorkspaceQaRuntime({
      binding: () => ({ documentIds: ["7", "9"] }),
      actorUserId: "asker_2",
    });

    const result = await runtime.takeTurn(questionTurn("What is the liability cap?"));

    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0]).toMatchObject({
      query: "What is the liability cap?",
      documentIds: ["7", "9"],
      // Never the room's creator — a room must not read what its asker cannot.
      userId: "asker_2",
    });
    expect(result.text).toContain("Clause 11.2");
    expect(result.meta).toMatchObject({ adapter: "workspace-qa", passagesUsed: 1 });
  });

  it("records citable provenance for every passage it used", async () => {
    mockResults.set("7", [
      { content: "Churn was 4.1% in Q2.", page: 2, documentTitle: "Q2 review", relevanceScore: 0.9 },
    ]);
    const { WorkspaceQaRuntime } = await load();
    const runtime = new WorkspaceQaRuntime({
      binding: () => ({ documentIds: ["7"] }),
      actorUserId: "asker",
    });

    const result = await runtime.takeTurn(questionTurn("What was churn?"));

    expect(result.meta!.grounding).toEqual([
      expect.objectContaining({ label: "Q2 review · p.2", page: 2, excerpt: "Churn was 4.1% in Q2." }),
    ]);
  });

  it("declines rather than guessing when its sources return nothing", async () => {
    const { WorkspaceQaRuntime } = await load();
    const runtime = new WorkspaceQaRuntime({
      binding: () => ({ documentIds: ["7"] }),
      actorUserId: "asker",
    });

    const result = await runtime.takeTurn(questionTurn("Anything about pricing?"));

    // A decline is the honest answer, and the model is never consulted — a
    // member with no matching passage has nothing to be fluent about.
    expect(result.meta).toMatchObject({ declined: true, reason: "no_matches" });
    expect(mockPrompts).toHaveLength(0);
  });

  it("declines when the member has no documents assigned", async () => {
    const { WorkspaceQaRuntime } = await load();
    const runtime = new WorkspaceQaRuntime({
      binding: () => ({ documentIds: [] }),
      actorUserId: "asker",
    });

    const result = await runtime.takeTurn(questionTurn("Anything?"));

    expect(result.meta).toMatchObject({ declined: true, reason: "no_documents" });
    expect(mockCalls).toHaveLength(0);
  });

  it("tells the member its sources are its own and others differ", async () => {
    mockResults.set("7", [{ content: "Some passage.", page: 1, documentTitle: "Doc" }]);
    const { WorkspaceQaRuntime } = await load();
    const runtime = new WorkspaceQaRuntime({
      binding: () => ({ documentIds: ["7"] }),
      actorUserId: "asker",
    });

    await runtime.takeTurn(questionTurn("Q?"));

    const prompt = mockPrompts[0]!;
    expect(prompt).toContain("only material you can see");
    expect(prompt).toContain("different sources");
    // The instruction that keeps a room honest.
    expect(prompt).toContain("Being the member with nothing to add is a useful answer");
  });
});
