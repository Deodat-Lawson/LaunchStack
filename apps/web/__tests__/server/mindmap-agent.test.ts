/**
 * The diagram service under the AI tools: an edit reads the saved map,
 * applies the edits through the editor's commands, and writes only over the
 * revision it read — reading again once if someone saved in between — and
 * keeps the version before in the map's history. Access and the database are
 * mocked; the edit operations have their own tests in the Mindmap model.
 */
import { buildDiagram } from "~/app/employer/documents/_mindmap/model/generate";
import { AI_EDIT_SNAPSHOT_LABEL } from "~/app/employer/documents/_mindmap/model/agent-edits";
import { activePage } from "~/app/employer/documents/_mindmap/model/doc";
import { getMindmap, writeRevision } from "~/server/mindmap/repository";
import { draftAccess } from "~/server/mindmap/access";
import {
    creatorThemeMode,
    DiagramBusy,
    DiagramEditDenied,
    DiagramNotFound,
    editDiagram,
    parseDiagramId,
} from "~/server/mindmap/agent";

import { makeWorkspaceContext } from "../helpers/workspace-context";

const mockReturning = jest.fn();
jest.mock("~/server/db", () => ({
    db: {
        update: () => ({
            set: (patch: unknown) => ({ where: () => ({ returning: () => mockReturning(patch) }) }),
        }),
    },
}));
jest.mock("~/server/mindmap/repository", () => {
    const actual = jest.requireActual("~/server/mindmap/repository");
    return { ...actual, getMindmap: jest.fn(), writeRevision: jest.fn(), listMindmaps: jest.fn() };
});
jest.mock("~/server/mindmap/access", () => ({
    canEditDraftAt: (level: string | null) => level === "edit" || level === "manage",
    draftAccess: jest.fn(),
    draftReader: jest.fn(async () => ({ companyId: BigInt(5), authUserId: "u1", scope: {} })),
}));
jest.mock("~/server/mindmap/create", () => ({
    createMindmapDraft: jest.fn(),
    DraftFolderError: class extends Error {},
}));

const ctx = makeWorkspaceContext({ companyId: BigInt(5), userPk: BigInt(7) });
const DOC = buildDiagram({ title: "Launch", type: "mindmap", outline: "- Launch\n  - Product" });
const product = activePage(DOC).nodes.find(n => n.text === "Product")!.id;

function saved(revision: number) {
    return {
        id: 12,
        title: "Launch",
        folder: "",
        doc: DOC,
        revision,
        nodeCount: 2,
        deletedAt: null,
        createdByUserId: "u1",
        updatedByUserId: "u1",
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    (draftAccess as jest.Mock).mockResolvedValue({ level: "edit" });
});

describe("editDiagram", () => {
    it("saves the edited map as the next revision and keeps the one before in its history", async () => {
        (getMindmap as jest.Mock).mockResolvedValue(saved(4));
        mockReturning.mockImplementation(async (patch: { revision: number }) => [
            { ...saved(patch.revision) },
        ]);

        const result = await editDiagram(ctx, 12, [{ op: "add", under: product, text: "Pricing" }]);

        expect(mockReturning).toHaveBeenCalledTimes(1);
        const patch = mockReturning.mock.calls[0]![0] as {
            revision: number;
            searchText: string;
            nodeCount: number;
        };
        expect(patch.revision).toBe(5);
        expect(patch.nodeCount).toBe(3);
        expect(patch.searchText).toContain("Pricing");
        expect(result.applied[0]).toMatch(/Added topic n_\w+ "Pricing"/);
        expect(writeRevision).toHaveBeenCalledWith(
            expect.objectContaining({
                mindmapId: 12,
                revision: 4,
                doc: DOC,
                label: AI_EDIT_SNAPSHOT_LABEL,
            })
        );
    });

    it("reads again and redoes the edit when someone saved in between", async () => {
        (getMindmap as jest.Mock).mockResolvedValueOnce(saved(4)).mockResolvedValueOnce(saved(5));
        mockReturning
            .mockResolvedValueOnce([])
            .mockImplementationOnce(async (patch: { revision: number }) => [saved(patch.revision)]);

        await editDiagram(ctx, 12, [{ op: "rename", node: product, text: "Products" }]);

        expect(getMindmap).toHaveBeenCalledTimes(2);
        expect((mockReturning.mock.calls[1]![0] as { revision: number }).revision).toBe(6);
    });

    it("gives up after a second lost race, having written nothing", async () => {
        (getMindmap as jest.Mock).mockResolvedValue(saved(4));
        mockReturning.mockResolvedValue([]);
        await expect(editDiagram(ctx, 12, [{ op: "arrange" }])).rejects.toBeInstanceOf(DiagramBusy);
        expect(writeRevision).not.toHaveBeenCalled();
    });

    it("refuses a map the person cannot open or cannot change", async () => {
        (getMindmap as jest.Mock).mockResolvedValueOnce(null);
        await expect(editDiagram(ctx, 12, [{ op: "arrange" }])).rejects.toBeInstanceOf(
            DiagramNotFound
        );
        (getMindmap as jest.Mock).mockResolvedValueOnce(saved(4));
        (draftAccess as jest.Mock).mockResolvedValueOnce({ level: "view" });
        await expect(editDiagram(ctx, 12, [{ op: "arrange" }])).rejects.toBeInstanceOf(
            DiagramEditDenied
        );
        expect(mockReturning).not.toHaveBeenCalled();
    });
});

describe("ids and lighting", () => {
    it("reads a diagram id in the forms models write it", () => {
        expect(parseDiagramId("m12")).toBe(12);
        expect(parseDiagramId("[M12]")).toBe(12);
        expect(parseDiagramId(12)).toBe(12);
        expect(parseDiagramId("d12")).toBeNull();
        expect(parseDiagramId("m0")).toBeNull();
    });

    it("draws in light only for someone who chose light; the app opens dark", () => {
        expect(creatorThemeMode("ls-theme=light.1700000000000")).toBe("light");
        expect(creatorThemeMode("ls-theme=system.1700000000000")).toBe("dark");
        expect(creatorThemeMode(null)).toBe("dark");
    });
});
