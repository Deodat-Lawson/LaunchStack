/**
 * Ask's diagram tools: which are offered to whom, what they hand the
 * diagram service, what the model is told back, and what the chat is told
 * to show. The service itself (drafts, access, the save check) is mocked
 * here; ~/server/mindmap/agent and the model layer have their own tests.
 */
import {
    createDiagramTools,
    diagramToolsPrompt,
    type DiagramToolOptions,
} from "~/server/chat-diagram-tools";
import {
    createDiagram,
    DiagramEditDenied,
    DiagramEditError,
    DiagramSpecError,
    DraftFolderError,
    editDiagram,
    findDiagrams,
    loadDiagram,
} from "~/server/mindmap/agent";
import { buildDiagram } from "~/app/employer/documents/_mindmap/model/generate";

import { makeWorkspaceContext } from "../helpers/workspace-context";

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

const ctx = makeWorkspaceContext({ companyId: BigInt(5), userPk: BigInt(7) });
const signal = new AbortController().signal;
const ALL: DiagramToolOptions = { locale: "en", mode: "dark", canCreate: true, canEdit: true };

const DOC = buildDiagram({
    title: "Refunds",
    type: "flowchart",
    mermaid: "flowchart TD\n A --> B",
});

function row(id: number, title = "Refunds", folder = "") {
    return { id, title, folder, revision: 2, doc: DOC, createdByUserId: "u", updatedByUserId: "u" };
}

function tool(name: string, options: DiagramToolOptions = ALL) {
    const session = createDiagramTools(ctx, options);
    const found = session.tools.find(t => t.name === name);
    if (!found) throw new Error(`no ${name}`);
    return { session, tool: found };
}

beforeEach(() => jest.clearAllMocks());

describe("which tools", () => {
    it("offers reading to everyone, drawing and changing by what the person may do", () => {
        const names = (options: DiagramToolOptions) =>
            createDiagramTools(ctx, options).tools.map(t => t.name);
        expect(names(ALL)).toEqual([
            "find_diagrams",
            "read_diagram",
            "create_diagram",
            "edit_diagram",
        ]);
        expect(names({ ...ALL, canCreate: false, canEdit: false })).toEqual([
            "find_diagrams",
            "read_diagram",
        ]);
        expect(names({ ...ALL, canEdit: false })).toEqual([
            "find_diagrams",
            "read_diagram",
            "create_diagram",
        ]);
    });

    it("tells the model to draw rather than paste, and when it may not change one", () => {
        const all = diagramToolsPrompt(createDiagramTools(ctx, ALL));
        expect(all).toContain("create it with `create_diagram` rather than writing a list");
        expect(all).toContain("Change it with `edit_diagram`");
        const readOnly = diagramToolsPrompt(
            createDiagramTools(ctx, { ...ALL, canCreate: false, canEdit: false })
        );
        expect(readOnly).not.toContain("`create_diagram`");
        expect(readOnly).toContain("You cannot change diagrams for this person here");
    });
});

describe("create_diagram", () => {
    it("draws in the Private section in the person's lighting, and lists it for the chat", async () => {
        (createDiagram as jest.Mock).mockResolvedValue({ row: row(12), doc: DOC });
        const { session, tool: create } = tool("create_diagram");

        const result = await create.run(
            {
                title: "Refunds",
                type: "flowchart",
                mermaid: "flowchart TD\n A --> B",
                folder: "Private",
            },
            signal
        );

        expect(createDiagram).toHaveBeenCalledWith(ctx, {
            spec: {
                title: "Refunds",
                type: "flowchart",
                outline: undefined,
                mermaid: "flowchart TD\n A --> B",
            },
            folder: "Unfiled",
            mode: "dark",
            pageName: "Page 1",
        });
        expect(result).toContain('Created the flowchart "Refunds" (m12)');
        expect(result).toContain("Private section");
        expect(session.touched).toEqual([
            { kind: "diagram", mindmapId: 12, title: "Refunds", folder: "Unfiled" },
        ]);
    });

    it("draws the same diagram once, however many times the model asks", async () => {
        (createDiagram as jest.Mock).mockResolvedValue({ row: row(12), doc: DOC });
        const { session, tool: create } = tool("create_diagram");
        const args = { title: "Refunds", type: "mindmap", outline: "- A\n  - B" };
        await create.run(args, signal);
        const again = await create.run(args, signal);
        expect(createDiagram).toHaveBeenCalledTimes(1);
        expect(again).toContain("was already created");
        expect(session.touched).toHaveLength(1);
    });

    it("stops at three diagrams an answer", async () => {
        (createDiagram as jest.Mock).mockImplementation(
            async (_ctx, input: { spec: { title: string } }) => ({
                row: row(Number(input.spec.title.slice(1)), input.spec.title),
                doc: DOC,
            })
        );
        const { tool: create } = tool("create_diagram");
        for (const n of [1, 2, 3])
            await create.run({ title: `m${n}`, type: "mindmap", outline: "- A" }, signal);
        await expect(
            create.run({ title: "m4", type: "mindmap", outline: "- A" }, signal)
        ).rejects.toThrow(/budget for this answer is used up/);
    });

    it("passes on what was wrong with the diagram, and a folder the person cannot add to", async () => {
        const { tool: create } = tool("create_diagram");
        (createDiagram as jest.Mock).mockRejectedValueOnce(
            new DiagramSpecError("A flowchart needs `mermaid`.")
        );
        await expect(create.run({ title: "x", type: "flowchart" }, signal)).rejects.toThrow(
            "needs `mermaid`"
        );
        (createDiagram as jest.Mock).mockRejectedValueOnce(
            new DraftFolderError("denied", "Finance")
        );
        await expect(
            create.run({ title: "x", type: "mindmap", outline: "- A", folder: "Finance" }, signal)
        ).rejects.toThrow(/Create it without a folder/);
    });

    it("rejects arguments it cannot use", async () => {
        const { tool: create } = tool("create_diagram");
        await expect(create.run({ title: "", type: "venn" }, signal)).rejects.toThrow(
            /Invalid arguments/
        );
        expect(createDiagram).not.toHaveBeenCalled();
    });
});

describe("find_diagrams and read_diagram", () => {
    it("lists diagrams with ids, marking the one opened most recently", async () => {
        (findDiagrams as jest.Mock).mockResolvedValue([
            {
                id: 3,
                title: "Launch",
                folder: "",
                nodeCount: 9,
                updatedAt: "2026-11-01T00:00:00Z",
                openedAt: "2026-11-14T10:00:00Z",
                openedLast: true,
            },
            {
                id: 4,
                title: "Org",
                folder: "People",
                nodeCount: 5,
                updatedAt: "2026-10-01T00:00:00Z",
                openedAt: null,
                openedLast: false,
            },
        ]);
        const { tool: find } = tool("find_diagrams");
        const text = await find.run({}, signal);
        expect(findDiagrams).toHaveBeenCalledWith(ctx, { query: undefined, limit: 15 });
        expect(text).toContain('- m3 "Launch" — 9 shapes, Private');
        expect(text).toContain("(opened most recently)");
        expect(text).toContain('- m4 "Org" — 5 shapes, folder "People"');
    });

    it("reads a diagram by id, in any of the forms a model writes it", async () => {
        (loadDiagram as jest.Mock).mockResolvedValue({ row: row(12), doc: DOC, canEdit: false });
        const { tool: read } = tool("read_diagram");
        for (const id of ["m12", "12", "[m12]"]) {
            const text = await read.run({ diagram: id }, signal);
            expect(text).toContain('Diagram "Refunds" (m12): a flowchart');
            expect(text).toContain("can view this diagram but not change it");
        }
        expect(loadDiagram).toHaveBeenCalledWith(ctx, 12);
    });

    it("says plainly when there is no such diagram, without saying whether it exists", async () => {
        (loadDiagram as jest.Mock).mockResolvedValue(null);
        const { tool: read } = tool("read_diagram");
        expect(await read.run({ diagram: "m99" }, signal)).toContain(
            'No diagram "m99" that the person can open'
        );
    });
});

describe("edit_diagram", () => {
    it("applies the edits and returns what changed and the diagram as it now is", async () => {
        (editDiagram as jest.Mock).mockResolvedValue({
            row: row(12),
            doc: DOC,
            applied: ['Renamed [n_1] to "Ask"'],
            added: [],
        });
        const { session, tool: edit } = tool("edit_diagram");
        const text = await edit.run(
            { diagram: "m12", edits: [{ op: "rename", node: "n_1", text: "Ask", under: null }] },
            signal
        );
        expect(editDiagram).toHaveBeenCalledWith(ctx, 12, [
            { op: "rename", node: "n_1", text: "Ask" },
        ]);
        expect(text).toContain('Renamed [n_1] to "Ask"');
        expect(text).toContain('Diagram "Refunds" (m12)');
        expect(session.touched).toEqual([
            { kind: "diagram", mindmapId: 12, title: "Refunds", folder: "Unfiled", edited: true },
        ]);
    });

    it("a diagram made and then changed in one answer is still listed as made", async () => {
        (createDiagram as jest.Mock).mockResolvedValue({ row: row(12), doc: DOC });
        (editDiagram as jest.Mock).mockResolvedValue({
            row: row(12),
            doc: DOC,
            applied: [],
            added: [],
        });
        const session = createDiagramTools(ctx, ALL);
        await session.tools
            .find(t => t.name === "create_diagram")!
            .run({ title: "Refunds", type: "mindmap", outline: "- A" }, signal);
        await session.tools
            .find(t => t.name === "edit_diagram")!
            .run({ diagram: "m12", edits: [{ op: "arrange" }] }, signal);
        expect(session.touched).toEqual([
            { kind: "diagram", mindmapId: 12, title: "Refunds", folder: "Unfiled", edited: false },
        ]);
    });

    it("says what failed and that nothing changed", async () => {
        const { tool: edit } = tool("edit_diagram");
        (editDiagram as jest.Mock).mockRejectedValueOnce(
            new DiagramEditError('Edit 1: no shape "x" on this page.', 0)
        );
        await expect(
            edit.run({ diagram: "m12", edits: [{ op: "remove", node: "x" }] }, signal)
        ).rejects.toThrow(/no shape "x".*Nothing was changed/);
        (editDiagram as jest.Mock).mockRejectedValueOnce(new DiagramEditDenied(12));
        await expect(
            edit.run({ diagram: "m12", edits: [{ op: "arrange" }] }, signal)
        ).rejects.toThrow(/view diagram m12 but not change it/);
        await expect(
            edit.run({ diagram: "doc 3", edits: [{ op: "arrange" }] }, signal)
        ).rejects.toThrow(/not a diagram id/);
    });

    it("reads edits the way small models write them", async () => {
        (editDiagram as jest.Mock).mockResolvedValue({
            row: row(12),
            doc: DOC,
            applied: [],
            added: [],
        });
        const { tool: edit } = tool("edit_diagram");
        // Blank and null fields mean absent; text with no op is an add; the
        // second add names no parent and goes where the first one went; and
        // the edits arrive as JSON text.
        await edit.run(
            {
                diagram: "m12",
                edits: JSON.stringify([
                    { op: "add", text: "Onboarding docs", under: "n_s", after: "", shape: "" },
                    { text: "Help center", node: null, ref: "help", keep_children: false },
                ]),
            },
            signal
        );
        expect(editDiagram).toHaveBeenCalledWith(ctx, 12, [
            expect.objectContaining({
                op: "add",
                text: "Onboarding docs",
                under: "n_s",
                after: undefined,
                shape: undefined,
            }),
            expect.objectContaining({ op: "add", text: "Help center", under: "n_s", ref: "help" }),
        ]);
    });
});
