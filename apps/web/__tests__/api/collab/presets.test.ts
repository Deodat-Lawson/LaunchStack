/**
 * Preset agent teams.
 *
 * Two things matter here and neither is cosmetic. Applying a pack must be
 * additive — a handle already in use is referenced by past transcripts and by
 * the frozen roster on every meeting that used it, so overwriting one rewrites
 * history. And the prompts themselves are the product: a preset agent with a
 * vague prompt produces a meeting of six agreeable voices, which is the exact
 * failure the preset exists to prevent.
 */

import { partitionByHandle } from "~/server/collab/personas";
import { PERSONA_PACKS, getPack, listPackSummaries } from "~/server/collab/presets";

interface StoredPersona {
  dbId: string;
  id: string;
  archived: boolean;
}

const mockCtx: { userId: string | null; personas: StoredPersona[] } = {
  userId: "user_1",
  personas: [],
};

jest.mock("~/lib/require-workspace-context", () => ({
  requireWorkspaceContext: () =>
    mockCtx.userId
      ? Promise.resolve({
          success: true,
          data: {
            clerkUserId: mockCtx.userId,
            userPk: 1n,
            companyId: 7n,
            role: "owner",
            status: "verified",
          },
        })
      : Promise.resolve({
          success: false,
          response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
        }),
}));

// Keeps the Postgres client from loading — it pulls `~/env`, which is
// ESM-only and cannot be required under Jest.
jest.mock("~/server/db", () => ({ db: {} }));

// `applyPersonas` is storage; `partitionByHandle` is the rule. The rule stays
// real here — the mock only supplies the rows it would have read and records
// the writes it would have made.
jest.mock("~/server/collab/personas", () => {
  const actual: {
    partitionByHandle: (
      existing: Iterable<string>,
      candidates: Array<{ key: string }>,
    ) => { toCreate: Array<{ key: string }>; skipped: string[] };
  } = jest.requireActual("~/server/collab/personas");

  return {
    ...actual,
    listPersonas: (_companyId: bigint, includeArchived = false) =>
      Promise.resolve(mockCtx.personas.filter((p) => (includeArchived ? true : !p.archived))),
    applyPersonas: (_companyId: bigint, candidates: Array<{ key: string }>) => {
      const { toCreate, skipped } = actual.partitionByHandle(
        mockCtx.personas.map((p) => p.id),
        candidates,
      );
      for (const persona of toCreate) {
        mockCtx.personas.push({ dbId: `p_${persona.key}`, id: persona.key, archived: false });
      }
      return Promise.resolve({ created: toCreate.map((p) => p.key), skipped });
    },
  };
});

async function loadRoute() {
  return import("~/app/api/collab/agents/presets/route");
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/collab/agents/presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockCtx.userId = "user_1";
  mockCtx.personas = [];
  jest.resetModules();
});

describe("preset pack definitions", () => {
  const packs = PERSONA_PACKS;

  it("ships the tech startup core team", () => {
    const pack = getPack("startup-core");
    expect(pack).not.toBeNull();
    expect(pack!.personas.map((p) => p.key)).toEqual([
      "founder",
      "product",
      "eng",
      "design",
      "growth",
      "data",
    ]);
  });

  it("uses handles that are mention-safe and unique within a pack", () => {
    for (const pack of packs) {
      const keys = pack.personas.map((p) => p.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of keys) expect(key).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
    }
  });

  it("names a moderator that is actually in the pack", () => {
    for (const pack of packs) {
      if (pack.suggested.turnPolicy !== "moderated") continue;
      expect(pack.suggested.moderatorKey).toBeDefined();
      expect(pack.personas.map((p) => p.key)).toContain(pack.suggested.moderatorKey!);
    }
  });

  it("fits inside the meeting participant cap", () => {
    // The create-meeting API accepts at most 10 participants; a pack you
    // cannot put in one room is not a usable preset.
    for (const pack of packs) expect(pack.personas.length).toBeLessThanOrEqual(10);
  });

  it("gives every agent a prompt with a stance, a shape, and a handoff", () => {
    for (const pack of packs) {
      for (const persona of pack.personas) {
        const prompt = persona.systemPrompt;
        // Substantial enough to actually steer a model.
        expect(prompt.length).toBeGreaterThan(600);
        // What this agent refuses to let pass — the source of real disagreement.
        expect(prompt).toContain("## What you refuse to let pass");
        // How a good turn is shaped, so "be concrete" is not the instruction.
        expect(prompt).toContain("## How you run a turn");
        // Who to hand to, so the room does not stall with nobody addressed.
        expect(prompt).toMatch(/@[a-z0-9_-]+/);
        // Explicit permission to not know, so gaps do not become inventions.
        expect(prompt).toContain("do not support a claim");
      }
    }
  });

  it("only hands off to handles that exist in the same pack", () => {
    for (const pack of packs) {
      const keys = new Set(pack.personas.map((p) => p.key));
      for (const persona of pack.personas) {
        const mentioned = [...persona.systemPrompt.matchAll(/@([a-z0-9_-]+)/g)].map((m) => m[1]!);
        for (const handle of mentioned) {
          // A prompt telling an agent to hand to @finance in a pack with no
          // finance seat produces a turn addressed to nobody.
          expect(keys.has(handle)).toBe(true);
        }
      }
    }
  });

  it("keeps full prompts out of the pack summaries", () => {
    for (const summary of listPackSummaries()) {
      for (const persona of summary.personas) {
        expect(persona.promptPreview.length).toBeLessThan(300);
        expect(persona).not.toHaveProperty("systemPrompt");
      }
    }
  });
});

describe("partitionByHandle", () => {
  const p = (key: string) => ({ key, displayName: key, role: key, systemPrompt: "x" });

  it("keeps existing handles and creates the rest", () => {
    const result = partitionByHandle(["eng"], [p("founder"), p("eng"), p("data")]);
    expect(result.toCreate.map((c) => c.key)).toEqual(["founder", "data"]);
    expect(result.skipped).toEqual(["eng"]);
  });

  it("creates a repeated handle once rather than tripping the unique index", () => {
    const result = partitionByHandle([], [p("eng"), p("eng")]);
    expect(result.toCreate).toHaveLength(1);
    expect(result.skipped).toEqual(["eng"]);
  });
});

describe("POST /api/collab/agents/presets", () => {
  it("creates the whole pack on a fresh workspace", async () => {
    const { POST } = await loadRoute();
    const response = await POST(postRequest({ packId: "startup-core" }));
    const body = (await response.json()) as { created: string[]; skipped: string[] };

    expect(response.status).toBe(201);
    expect(body.created).toHaveLength(6);
    expect(body.skipped).toEqual([]);
  });

  it("is idempotent — applying twice creates nothing the second time", async () => {
    const { POST } = await loadRoute();
    await POST(postRequest({ packId: "startup-core" }));
    const response = await POST(postRequest({ packId: "startup-core" }));
    const body = (await response.json()) as { created: string[]; skipped: string[] };

    expect(response.status).toBe(200);
    expect(body.created).toEqual([]);
    expect(body.skipped).toHaveLength(6);
    expect(mockCtx.personas).toHaveLength(6);
  });

  it("never overwrites a handle the workspace already uses", async () => {
    mockCtx.personas.push({ dbId: "mine", id: "eng", archived: false });
    const { POST } = await loadRoute();
    const response = await POST(postRequest({ packId: "startup-core" }));
    const body = (await response.json()) as { created: string[]; skipped: string[] };

    expect(body.skipped).toEqual(["eng"]);
    expect(body.created).not.toContain("eng");
    // The original row is untouched — same dbId, not replaced by the preset.
    expect(mockCtx.personas.filter((p) => p.id === "eng")).toEqual([
      { dbId: "mine", id: "eng", archived: false },
    ]);
  });

  it("treats an archived handle as taken", async () => {
    // The handle still appears in old transcripts, and the unique index does
    // not care that the row is archived.
    mockCtx.personas.push({ dbId: "old", id: "growth", archived: true });
    const { POST } = await loadRoute();
    const response = await POST(postRequest({ packId: "startup-core" }));
    const body = (await response.json()) as { skipped: string[] };

    expect(body.skipped).toEqual(["growth"]);
  });

  it("404s an unknown pack and 400s a malformed body", async () => {
    const { POST } = await loadRoute();
    expect((await POST(postRequest({ packId: "nope" }))).status).toBe(404);
    expect((await POST(postRequest({}))).status).toBe(400);
  });

  it("requires a workspace", async () => {
    mockCtx.userId = null;
    const { GET, POST } = await loadRoute();
    expect((await GET()).status).toBe(401);
    expect((await POST(postRequest({ packId: "startup-core" }))).status).toBe(401);
  });
});

describe("GET /api/collab/agents/presets", () => {
  it("flags handles that would conflict before the user clicks", async () => {
    mockCtx.personas.push({ dbId: "mine", id: "product", archived: false });
    const { GET } = await loadRoute();
    const body = (await (await GET()).json()) as {
      packs: Array<{ id: string; conflicts: string[] }>;
    };

    expect(body.packs.find((p) => p.id === "startup-core")!.conflicts).toEqual(["product"]);
  });
});
