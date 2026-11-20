/**
 * The editor's AI routes are thin: auth, a rate limit, the AI allowance,
 * the model call under the workspace's models (counted as `mindmap`), and —
 * for Generate — the draft saved the gallery's way. These pin those seams;
 * the model calls and the builder have their own tests.
 */
import { NextResponse } from "next/server";

import { POST as expand } from "~/app/api/mindmaps/expand/route";
import { POST as generate } from "~/app/api/mindmaps/generate/route";
import { requireWorkspaceContext, type WorkspaceContext } from "~/lib/require-workspace-context";
import { refuseAtAiAllowance } from "~/server/ai-usage/refusal";
import { createDiagram, DraftFolderError } from "~/server/mindmap/agent";
import { expandTopicOutline, generateDiagramSpec } from "~/server/mindmap/generate";

import { makeWorkspaceContext } from "../helpers/workspace-context";

jest.mock("~/lib/require-workspace-context", () => ({ requireWorkspaceContext: jest.fn() }));
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<NextResponse>) =>
        handler(),
}));
jest.mock("~/server/ai-usage/refusal", () => ({ refuseAtAiAllowance: jest.fn(async () => null) }));
// A model failure that is not the person's limit or a bad request reads as the server's.
jest.mock("~/lib/models", () => ({
    describeChatResolutionFailure: () => ({ status: 500, message: "x" }),
}));
const scopes: unknown[] = [];
jest.mock("~/server/workspace-models/scope", () => ({
    withWorkspaceChatModels: (companyId: unknown, use: unknown, fn: () => unknown) => {
        scopes.push({ companyId, use });
        return fn();
    },
}));
jest.mock("~/server/mindmap/generate", () => ({
    MAX_PROMPT_CHARS: 4000,
    generateDiagramSpec: jest.fn(),
    expandTopicOutline: jest.fn(),
}));
jest.mock("~/server/mindmap/agent", () => ({
    createDiagram: jest.fn(),
    creatorThemeMode: () => "dark",
    // The real class: the route tells a refused folder by it.
    DraftFolderError: jest.requireActual("~/server/mindmap/create").DraftFolderError,
}));
jest.mock("~/server/mindmap/access", () => ({
    describeDraftAccess: jest.fn(
        async (_ctx: unknown, rows: { id: number }[]) =>
            new Map(rows.map(r => [r.id, { audience: "private" }]))
    ),
}));
jest.mock("~/server/mindmap/repository", () => ({
    toDetail: (row: { id: number; title: string }) => ({ id: row.id, title: row.title }),
}));

const CTX: WorkspaceContext = makeWorkspaceContext({ authUserId: "user_1", companyId: BigInt(42) });

function post(body: unknown, path = "generate") {
    return new Request(`http://localhost/api/mindmaps/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    scopes.length = 0;
    jest.mocked(requireWorkspaceContext).mockResolvedValue({ success: true, data: CTX });
});

describe("POST /api/mindmaps/generate", () => {
    it("has the workspace's model draw it, counted as mindmap, and saves it as a draft", async () => {
        const spec = { title: "Refunds", type: "flowchart", mermaid: "flowchart TD\n A --> B" };
        jest.mocked(generateDiagramSpec).mockResolvedValue(spec as never);
        jest.mocked(createDiagram).mockResolvedValue({
            row: { id: 9, title: "Refunds" },
            doc: {},
        } as never);

        const res = await generate(
            post({ prompt: "How refunds work", folder: "Ops", mode: "light" })
        );

        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({
            mindmap: { id: 9, title: "Refunds", access: { audience: "private" } },
        });
        expect(scopes).toEqual([
            { companyId: BigInt(42), use: { feature: "mindmap", userId: "user_1" } },
        ]);
        expect(generateDiagramSpec).toHaveBeenCalledWith("How refunds work", undefined);
        expect(createDiagram).toHaveBeenCalledWith(CTX, {
            spec,
            folder: "Ops",
            mode: "light",
            pageName: "Page 1",
        });
    });

    it("stops at the person's AI allowance before calling a model", async () => {
        jest.mocked(refuseAtAiAllowance).mockResolvedValueOnce(
            NextResponse.json({ code: "ai_allowance_reached" }, { status: 429 }) as never
        );
        const res = await generate(post({ prompt: "x" }));
        expect(res.status).toBe(429);
        expect(generateDiagramSpec).not.toHaveBeenCalled();
    });

    it("says it could not draw it when the model call fails, and saves nothing", async () => {
        jest.mocked(generateDiagramSpec).mockRejectedValue(new Error("upstream 500"));
        const res = await generate(post({ prompt: "x" }));
        expect(res.status).toBe(502);
        expect(await res.json()).toEqual({
            error: "Couldn't draw that. Try describing it another way.",
        });
        expect(createDiagram).not.toHaveBeenCalled();
    });

    it("refuses a folder the person cannot add to", async () => {
        jest.mocked(generateDiagramSpec).mockResolvedValue({
            title: "x",
            type: "mindmap",
            outline: "- A",
        });
        jest.mocked(createDiagram).mockRejectedValue(new DraftFolderError("denied", "Finance"));
        const res = await generate(post({ prompt: "x", folder: "Finance" }));
        expect(res.status).toBe(403);
    });

    it("rejects an empty description", async () => {
        const res = await generate(post({ prompt: "  " }));
        expect(res.status).toBe(400);
        expect(generateDiagramSpec).not.toHaveBeenCalled();
    });
});

describe("POST /api/mindmaps/expand", () => {
    it("asks for subtopics with the branch's words, counted as mindmap", async () => {
        jest.mocked(expandTopicOutline).mockResolvedValue("- Pricing\n- Docs");
        const res = await expand(post({ title: "Launch", path: ["Launch", "Product"] }, "expand"));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ outline: "- Pricing\n- Docs" });
        expect(expandTopicOutline).toHaveBeenCalledWith({
            title: "Launch",
            path: ["Launch", "Product"],
            existing: [],
            siblings: [],
            depth: 1,
        });
        expect(scopes).toEqual([
            { companyId: BigInt(42), use: { feature: "mindmap", userId: "user_1" } },
        ]);
    });

    it("needs a topic to expand", async () => {
        const res = await expand(post({ title: "Launch", path: [] }, "expand"));
        expect(res.status).toBe(400);
    });
});
