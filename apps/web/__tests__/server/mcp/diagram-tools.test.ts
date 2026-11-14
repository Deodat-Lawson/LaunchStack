/**
 * The MCP diagram tools: assistants connected to LaunchStack find, read,
 * draw and change diagrams through the same service as Ask, and get links
 * back. The service is mocked; it has its own tests.
 */
import { buildDiagram } from "~/app/employer/documents/_mindmap/model/generate";
import type { McpPrincipal } from "~/server/mcp/principal";
import { isInputRequired, type McpTool, type McpToolOutcome } from "~/server/mcp/protocol";
import {
    createDiagramTool,
    editDiagramTool,
    listDiagramsTool,
    readDiagramTool,
} from "~/server/mcp/tools/diagrams";
import {
    createDiagram,
    DiagramEditError,
    DraftFolderError,
    editDiagram,
    findDiagrams,
    loadDiagram,
} from "~/server/mindmap/agent";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

jest.mock("~/server/mindmap/agent", () => {
    const actual = jest.requireActual("~/server/mindmap/agent");
    return {
        ...actual,
        createDiagram: jest.fn(),
        editDiagram: jest.fn(),
        findDiagrams: jest.fn(),
        loadDiagram: jest.fn(),
    };
});

const ORIGIN = "https://app.example.com";
const DOC = buildDiagram({ title: "Hiring", type: "org_chart", outline: "CEO\n  CTO" });
const principal: McpPrincipal = {
    ctx: makeWorkspaceContext({ role: "member", companyId: BigInt(50) }),
    scopes: new Set(["launchstack:read", "launchstack:write"]),
    credential: { kind: "key", keyId: 3 },
    label: "Claude Code",
    family: "claude",
    rateLimitKey: "mcp:user-a:50",
};

async function call(tool: McpTool, args: unknown) {
    const outcome: McpToolOutcome = await tool.call(args, {
        principal,
        origin: ORIGIN,
        client: { era: "legacy", formElicitation: false },
        roundTrip: null,
        rawArguments: (args ?? {}) as Record<string, unknown>,
    });
    if (isInputRequired(outcome)) throw new Error("unexpected input_required");
    return outcome;
}

beforeEach(() => jest.clearAllMocks());

describe("MCP diagram tools", () => {
    it("draws a diagram in the Private section and links to it", async () => {
        (createDiagram as jest.Mock).mockResolvedValue({
            row: { id: 8, title: "Hiring", folder: "" },
            doc: DOC,
        });
        const answer = await call(createDiagramTool, {
            title: "Hiring",
            type: "org_chart",
            outline: "CEO\n  CTO",
        });
        expect(createDiagram).toHaveBeenCalledWith(principal.ctx, {
            spec: { title: "Hiring", type: "org_chart", outline: "CEO\n  CTO", mermaid: undefined },
            folder: "Unfiled",
            mode: "dark",
        });
        expect(answer).toMatchObject({
            ok: true,
            structured: {
                id: "m8",
                kind: "org chart",
                folder: "Private",
                url: `${ORIGIN}/employer/documents?source=m8`,
            },
        });
    });

    it("answers a folder the person cannot add to with what to do instead", async () => {
        (createDiagram as jest.Mock).mockRejectedValue(new DraftFolderError("denied", "Finance"));
        const answer = await call(createDiagramTool, {
            title: "x",
            type: "mindmap",
            outline: "- A",
            folder: "Finance",
        });
        expect(answer).toMatchObject({
            ok: false,
            message: expect.stringContaining("without a folder"),
        });
    });

    it("lists diagrams with links, the most recently opened marked", async () => {
        (findDiagrams as jest.Mock).mockResolvedValue([
            {
                id: 3,
                title: "Launch",
                folder: "",
                nodeCount: 9,
                updatedAt: "2026-11-01T00:00:00Z",
                openedAt: null,
                openedLast: true,
            },
        ]);
        const answer = await call(listDiagramsTool, {});
        expect(answer).toMatchObject({
            ok: true,
            structured: {
                diagrams: [
                    {
                        id: "m3",
                        title: "Launch",
                        folder: "Private",
                        shapes: 9,
                        openedMostRecently: true,
                        url: `${ORIGIN}/employer/documents?source=m3`,
                    },
                ],
            },
        });
    });

    it("reads a diagram, and says so plainly when there is none", async () => {
        (loadDiagram as jest.Mock).mockResolvedValueOnce({
            row: { id: 8, title: "Hiring", folder: "" },
            doc: DOC,
            canEdit: true,
        });
        const read = await call(readDiagramTool, { diagram: "m8" });
        expect(read.ok && read.text).toMatch(/- CEO \(id: n_\w+\)/);
        expect(read).toMatchObject({ structured: { id: "m8", canEdit: true } });

        (loadDiagram as jest.Mock).mockResolvedValueOnce(null);
        expect(await call(readDiagramTool, { diagram: "m9" })).toMatchObject({ ok: false });
    });

    it("edits a diagram and reports what changed; a bad edit changes nothing", async () => {
        (editDiagram as jest.Mock).mockResolvedValueOnce({
            row: { id: 8, title: "Hiring", folder: "", revision: 3 },
            doc: DOC,
            applied: ['Added topic [n_x] "CFO" under [n_y].'],
            added: ["n_x"],
        });
        const ok = await call(editDiagramTool, {
            diagram: "m8",
            edits: [{ op: "add", under: "n_y", text: "CFO", label: null }],
        });
        expect(editDiagram).toHaveBeenCalledWith(principal.ctx, 8, [
            {
                op: "add",
                under: "n_y",
                text: "CFO",
                after: undefined,
                shape: undefined,
                label: undefined,
                ref: undefined,
            },
        ]);
        expect(ok).toMatchObject({
            ok: true,
            structured: { id: "m8", revision: 3, added: ["n_x"] },
        });

        (editDiagram as jest.Mock).mockRejectedValueOnce(
            new DiagramEditError("Edit 1: no shape.", 0)
        );
        const bad = await call(editDiagramTool, {
            diagram: "m8",
            edits: [{ op: "remove", node: "n_q" }],
        });
        expect(bad).toMatchObject({ ok: false, message: "Edit 1: no shape. Nothing was changed." });
    });

    it("rejects an edit with no operations before touching anything", async () => {
        const answer = await call(editDiagramTool, { diagram: "m8", edits: [] });
        expect(answer.ok).toBe(false);
        expect(editDiagram).not.toHaveBeenCalled();
    });
});
