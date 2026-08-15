import {
    buildBlankRailMenuItems,
    buildFolderMenuItems,
    buildSourceMenuItems,
    isPersistedSource,
} from "../sourceContextMenu";
import type { WorkspaceFolder, WorkspaceSource } from "../types";

function source(overrides: Partial<WorkspaceSource> = {}): WorkspaceSource {
    return {
        id: "d1",
        documentId: 1,
        title: "Claude Code (global) — memory.md",
        type: "doc",
        size: "",
        added: "just now",
        folder: "Unfiled",
        tags: [],
        domain: "General",
        ...overrides,
    };
}

const folders: WorkspaceFolder[] = [
    { id: "cat-1", name: "Contracts", color: "x" },
    { id: "f-Unfiled", name: "Unfiled", color: "y" },
];

describe("isPersistedSource", () => {
    it("treats optimistic rows as not yet writable", () => {
        expect(isPersistedSource(source({ documentId: undefined }))).toBe(false);
        expect(isPersistedSource(source({ documentId: 0 }))).toBe(false);
        expect(isPersistedSource(source({ documentId: 9 }))).toBe(true);
    });
});

describe("buildSourceMenuItems", () => {
    it("exposes open, rename, move, copy, and delete for a persisted file", () => {
        const onOpen = jest.fn();
        const onRename = jest.fn();
        const onDelete = jest.fn();
        const items = buildSourceMenuItems(source(), folders, [], {
            onOpen,
            onRename,
            onDelete,
            onCopyTitle: jest.fn(),
            onMoveToFolder: jest.fn(),
            onToggleContext: jest.fn(),
        });
        const ids = items.map(item => item.id);
        expect(ids).toEqual([
            "title",
            "open",
            "context",
            "sep-modify",
            "rename",
            "move",
            "copy",
            "sep-danger",
            "delete",
        ]);
        const rename = items.find(item => item.id === "rename");
        expect(rename?.type === "item" && rename.disabled).toBe(false);
        const del = items.find(item => item.id === "delete");
        expect(del?.type === "item" && del.danger).toBe(true);
    });

    it("disables mutations while a source is still indexing", () => {
        const items = buildSourceMenuItems(
            source({ documentId: undefined, pending: true }),
            folders,
            [],
            {
                onRename: jest.fn(),
                onDelete: jest.fn(),
                onMoveToFolder: jest.fn(),
            }
        );
        const rename = items.find(item => item.id === "rename");
        const move = items.find(item => item.id === "move");
        const del = items.find(item => item.id === "delete");
        expect(rename?.type === "item" && rename.disabled).toBe(true);
        expect(move?.type === "submenu" && move.disabled).toBe(true);
        expect(del?.type === "item" && del.disabled).toBe(true);
    });

    it("labels context toggle based on current selection", () => {
        const selected = buildSourceMenuItems(source(), folders, ["d1"], {
            onToggleContext: jest.fn(),
        });
        const item = selected.find(entry => entry.id === "context");
        expect(item?.type === "item" && item.label).toBe("Remove from context");
    });

    it("invokes handlers from the matching item", () => {
        const onRename = jest.fn();
        const onMoveToFolder = jest.fn();
        const file = source({ folder: "Contracts" });
        const items = buildSourceMenuItems(file, folders, [], {
            onRename,
            onMoveToFolder,
        });
        const rename = items.find(item => item.id === "rename");
        if (rename?.type === "item") rename.onSelect();
        expect(onRename).toHaveBeenCalledWith(file);

        const move = items.find(item => item.id === "move");
        expect(move?.type).toBe("submenu");
        if (move?.type === "submenu") {
            const unfiled = move.items.find(item => item.id === "move-Unfiled");
            if (unfiled?.type === "item") unfiled.onSelect();
        }
        expect(onMoveToFolder).toHaveBeenCalledWith("d1", "Unfiled");
    });
});

describe("buildFolderMenuItems", () => {
    it("offers rename and select-all", () => {
        const onRename = jest.fn();
        const onSelectAll = jest.fn();
        const items = buildFolderMenuItems("Contracts", {
            onRename,
            onSelectAll,
            selectState: "none",
        });
        expect(items.map(item => item.id)).toEqual(["title", "rename-folder", "select-folder"]);
        const select = items.find(item => item.id === "select-folder");
        if (select?.type === "item") select.onSelect();
        expect(onSelectAll).toHaveBeenCalledWith(true);
    });
});

describe("buildBlankRailMenuItems", () => {
    it("offers add knowledge and new folder", () => {
        const onAddKnowledge = jest.fn();
        const onNewFolder = jest.fn();
        const items = buildBlankRailMenuItems({ onAddKnowledge, onNewFolder });
        expect(items.map(item => item.id)).toEqual(["add", "new-folder"]);
    });
});
