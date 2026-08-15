/**
 * The agent roster API.
 *
 * The roster is what a meeting draws its participants from, so the things
 * worth pinning down are: a workspace is never left with an empty picker,
 * handles stay mention-safe, a duplicate handle is a 409 rather than a 500, and
 * retiring an agent archives it instead of orphaning past transcripts.
 */

import type { WorkerNode } from "~/app/employer/documents/_workspace/collab/types";

interface StoredPersona {
    dbId: string;
    id: string;
    displayName: string;
    role: string;
    systemPrompt: string;
    nodeId?: string | null;
    route?: string | null;
    archived: boolean;
}

const mockCtx: {
    userId: string | null;
    personas: StoredPersona[];
    nodes: WorkerNode[];
    nodesThrow: boolean;
    hubEnabled: boolean;
    slack: { canPost: boolean; canReceive: boolean; missing: string[] };
} = {
    userId: "user_1",
    personas: [],
    nodes: [],
    nodesThrow: false,
    hubEnabled: true,
    slack: { canPost: true, canReceive: true, missing: [] },
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
                  response: new Response(JSON.stringify({ error: "Unauthorized" }), {
                      status: 401,
                  }),
              }),
}));

jest.mock("~/server/collab/slack", () => ({
    getSlackStatus: () => mockCtx.slack,
}));

jest.mock("~/server/collab/runtime", () => ({
    getHub: () =>
        mockCtx.hubEnabled ? { hubId: "app-hub", listNodes: () => mockCtx.nodes } : null,
    listKnownNodes: () =>
        mockCtx.nodesThrow ? Promise.reject(new Error("db down")) : Promise.resolve(mockCtx.nodes),
}));

jest.mock("~/server/collab/personas", () => ({
    ensureStarterPersonas: () => {
        if (mockCtx.personas.length === 0) {
            mockCtx.personas.push({
                dbId: "seed_1",
                id: "facilitator",
                displayName: "Ada",
                role: "Facilitator",
                systemPrompt: "Run the meeting.",
                archived: false,
            });
        }
        return Promise.resolve(mockCtx.personas.filter(p => !p.archived));
    },
    // Mirrors the real module: the column is `key`, the persona field is `id`.
    createPersona: (_companyId: bigint, input: { key: string } & Partial<StoredPersona>) => {
        if (mockCtx.personas.some(p => p.id === input.key)) {
            return Promise.reject(
                new Error(
                    'duplicate key value violates unique constraint "collab_persona_company_key_idx"'
                )
            );
        }
        const { key, ...rest } = input;
        const persona: StoredPersona = {
            dbId: `p_${key}`,
            id: key,
            displayName: rest.displayName ?? key,
            role: rest.role ?? "",
            systemPrompt: rest.systemPrompt ?? "",
            nodeId: rest.nodeId,
            route: rest.route,
            archived: false,
        };
        mockCtx.personas.push(persona);
        return Promise.resolve(persona);
    },
    updatePersona: (
        _companyId: bigint,
        dbId: string,
        patch: { key?: string } & Partial<StoredPersona>
    ) => {
        const persona = mockCtx.personas.find(p => p.dbId === dbId);
        if (!persona) return Promise.resolve(null);
        const { key, ...rest } = patch;
        Object.assign(persona, rest, key === undefined ? {} : { id: key });
        return Promise.resolve(persona);
    },
    archivePersona: (_companyId: bigint, dbId: string) => {
        const persona = mockCtx.personas.find(p => p.dbId === dbId);
        if (!persona) return Promise.resolve(null);
        persona.archived = true;
        return Promise.resolve(persona);
    },
}));

import { GET, POST } from "~/app/api/collab/agents/route";
import { DELETE, PATCH } from "~/app/api/collab/agents/[personaId]/route";

function jsonRequest(body: unknown, method = "POST") {
    return new Request("http://localhost/api/collab/agents", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

const VALID = {
    key: "finance",
    displayName: "Dana",
    role: "Finance partner",
    systemPrompt: "Guard the margin. Quote figures from the documents.",
};

describe("collab agents routes", () => {
    beforeEach(() => {
        mockCtx.userId = "user_1";
        mockCtx.personas = [];
        mockCtx.nodes = [];
        mockCtx.nodesThrow = false;
        mockCtx.hubEnabled = true;
        mockCtx.slack = { canPost: true, canReceive: true, missing: [] };
    });

    it("rejects unauthenticated callers", async () => {
        mockCtx.userId = null;
        expect((await GET()).status).toBe(401);
        expect((await POST(jsonRequest(VALID))).status).toBe(401);
        expect(
            (
                await PATCH(jsonRequest({ role: "x" }, "PATCH"), {
                    params: Promise.resolve({ personaId: "p" }),
                })
            ).status
        ).toBe(401);
        expect(
            (
                await DELETE(jsonRequest({}, "DELETE"), {
                    params: Promise.resolve({ personaId: "p" }),
                })
            ).status
        ).toBe(401);
    });

    it("seeds a starter roster so the picker is never empty", async () => {
        const body = (await (await GET()).json()) as { personas: StoredPersona[] };
        expect(body.personas.length).toBeGreaterThan(0);
        expect(body.personas[0]!.id).toBe("facilitator");
    });

    it("reports where a worker should point and what Slack still needs", async () => {
        mockCtx.slack = { canPost: false, canReceive: false, missing: ["SLACK_BOT_TOKEN"] };
        const body = (await (await GET()).json()) as {
            network: { enabled: boolean; hubId: string | null; hubPath: string };
            slack: { missing: string[] };
        };

        expect(body.network).toEqual({
            enabled: true,
            hubId: "app-hub",
            hubPath: "/api/collab/hub",
        });
        expect(body.slack.missing).toEqual(["SLACK_BOT_TOKEN"]);
    });

    it("reports the network as disabled when no hub secret is configured", async () => {
        mockCtx.hubEnabled = false;
        const body = (await (await GET()).json()) as {
            network: { enabled: boolean; hubId: string | null };
        };
        expect(body.network).toMatchObject({ enabled: false, hubId: null });
    });

    it("lists worker nodes with their connection state", async () => {
        mockCtx.nodes = [
            {
                nodeId: "gpu-box-1",
                label: "GPU box",
                personaIds: ["eng"],
                lastSeenAt: 1,
                queuedEvents: 0,
                connected: true,
            },
            { nodeId: "old-box", personaIds: [], lastSeenAt: 0, queuedEvents: 0, connected: false },
        ];
        const body = (await (await GET()).json()) as { nodes: WorkerNode[] };
        expect(body.nodes.map(n => n.nodeId)).toEqual(["gpu-box-1", "old-box"]);
    });

    it("still renders the roster when node bookkeeping fails", async () => {
        mockCtx.nodesThrow = true;
        mockCtx.nodes = [
            {
                nodeId: "gpu-box-1",
                personaIds: [],
                lastSeenAt: 1,
                queuedEvents: 0,
                connected: true,
            },
        ];

        const response = await GET();
        expect(response.status).toBe(200);
        const body = (await response.json()) as { personas: StoredPersona[]; nodes: WorkerNode[] };
        expect(body.personas.length).toBeGreaterThan(0);
        // Falls back to the live registry rather than 500-ing the whole page.
        expect(body.nodes.map(n => n.nodeId)).toEqual(["gpu-box-1"]);
    });

    describe("POST /api/collab/agents", () => {
        it("creates an agent", async () => {
            const response = await POST(jsonRequest(VALID));
            expect(response.status).toBe(201);
            expect(((await response.json()) as { persona: StoredPersona }).persona).toMatchObject({
                id: "finance",
                displayName: "Dana",
            });
        });

        it("reports a duplicate handle as a conflict, not a server error", async () => {
            await POST(jsonRequest(VALID));
            const response = await POST(jsonRequest(VALID));

            expect(response.status).toBe(409);
            expect(((await response.json()) as { error: string }).error).toMatch(
                /"finance" already exists/
            );
        });

        it("rejects handles that would not survive being written as @mentions", async () => {
            for (const key of ["Finance", "fin ance", "fin@ance", "f", "-lead", ""]) {
                const response = await POST(jsonRequest({ ...VALID, key }));
                expect(response.status).toBe(400);
            }
        });

        it("rejects a model route the deployment does not define", async () => {
            expect((await POST(jsonRequest({ ...VALID, route: "telepathy" }))).status).toBe(400);
            expect(
                (await POST(jsonRequest({ ...VALID, key: "ok1", route: "reasoning" }))).status
            ).toBe(201);
        });

        it("rejects missing required fields", async () => {
            for (const body of [
                {},
                { key: "finance" },
                { key: "finance", displayName: "Dana" },
                { key: "finance", displayName: "Dana", role: "Finance" },
            ]) {
                expect((await POST(jsonRequest(body))).status).toBe(400);
            }
        });
    });

    describe("PATCH /api/collab/agents/[personaId]", () => {
        it("updates an existing agent", async () => {
            await POST(jsonRequest(VALID));
            const response = await PATCH(
                jsonRequest({ role: "Head of finance", nodeId: "gpu-box-1" }, "PATCH"),
                { params: Promise.resolve({ personaId: "p_finance" }) }
            );

            expect(response.status).toBe(200);
            expect(((await response.json()) as { persona: StoredPersona }).persona).toMatchObject({
                role: "Head of finance",
                nodeId: "gpu-box-1",
            });
        });

        it("clears a node assignment with an explicit null", async () => {
            await POST(jsonRequest({ ...VALID, nodeId: "gpu-box-1" }));
            const response = await PATCH(jsonRequest({ nodeId: null }, "PATCH"), {
                params: Promise.resolve({ personaId: "p_finance" }),
            });

            expect(
                ((await response.json()) as { persona: StoredPersona }).persona.nodeId
            ).toBeNull();
        });

        it("404s an unknown agent", async () => {
            const response = await PATCH(jsonRequest({ role: "x" }, "PATCH"), {
                params: Promise.resolve({ personaId: "nope" }),
            });
            expect(response.status).toBe(404);
        });
    });

    describe("DELETE /api/collab/agents/[personaId]", () => {
        it("archives rather than deleting, so past transcripts still resolve", async () => {
            await POST(jsonRequest(VALID));

            const response = await DELETE(jsonRequest({}, "DELETE"), {
                params: Promise.resolve({ personaId: "p_finance" }),
            });
            expect(response.status).toBe(200);
            expect((await response.json()) as { archived: boolean }).toMatchObject({
                archived: true,
            });

            // The row survives; it just stops appearing in the roster.
            expect(mockCtx.personas.find(p => p.dbId === "p_finance")).toBeDefined();
            const listed = (await (await GET()).json()) as { personas: StoredPersona[] };
            expect(listed.personas.some(p => p.id === "finance")).toBe(false);
        });

        it("404s an unknown agent", async () => {
            const response = await DELETE(jsonRequest({}, "DELETE"), {
                params: Promise.resolve({ personaId: "nope" }),
            });
            expect(response.status).toBe(404);
        });
    });
});
