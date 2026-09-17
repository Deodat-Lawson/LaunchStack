import {
    buildBlankRailMenuItems,
    buildFolderMenuItems,
    buildSelectionMenuItems,
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

describe("buildFolderMenuItems for a nested folder", () => {
    const paths = ["Contracts", "Contracts/2026", "Contracts/2026/Globex", "HR", "Unfiled"];

    it("offers subfolder, rename, move, and delete", () => {
        const onMove = jest.fn();
        const onDelete = jest.fn();
        const items = buildFolderMenuItems("Contracts/2026", {
            onNewSubfolder: jest.fn(),
            onRename: jest.fn(),
            onMove,
            onDelete,
            folders: paths,
        });
        expect(items.map(item => item.id)).toEqual([
            "title",
            "new-subfolder",
            "rename-folder",
            "move-folder",
            "sep-folder-danger",
            "delete-folder",
        ]);
        expect(items[0]).toMatchObject({ type: "label", label: "Contracts / 2026" });
        const del = items.find(item => item.id === "delete-folder");
        expect(del).toMatchObject({ danger: true });
        if (del?.type === "item") del.onSelect();
        expect(onDelete).toHaveBeenCalled();
    });

    it("moves only to folders that are not itself, its subtree, its parent, or Unfiled", () => {
        const onMove = jest.fn();
        const items = buildFolderMenuItems("Contracts/2026", { onMove, folders: paths });
        const move = items.find(item => item.id === "move-folder");
        expect(move?.type).toBe("submenu");
        if (move?.type !== "submenu") return;
        expect(move.items.map(item => item.id)).toEqual(["move-folder-root", "move-folder-HR"]);
        const root = move.items[0];
        if (root?.type === "item") root.onSelect();
        expect(onMove).toHaveBeenCalledWith(null);
        const hr = move.items[1];
        if (hr?.type === "item") hr.onSelect();
        expect(onMove).toHaveBeenLastCalledWith("HR");
    });

    it("cannot move a top-level folder to the top level again", () => {
        const items = buildFolderMenuItems("HR", { onMove: jest.fn(), folders: paths });
        const move = items.find(item => item.id === "move-folder");
        if (move?.type !== "submenu") throw new Error("expected submenu");
        expect(move.items[0]).toMatchObject({ id: "move-folder-root", disabled: true });
    });
});

describe("source move submenu", () => {
    it("labels nested folders as readable paths", () => {
        const nested: WorkspaceFolder[] = [
            { id: "f-Contracts", name: "Contracts", color: "x" },
            { id: "f-Contracts/2026", name: "Contracts/2026", color: "x" },
        ];
        const items = buildSourceMenuItems(source(), nested, [], { onMoveToFolder: jest.fn() });
        const move = items.find(item => item.id === "move");
        if (move?.type !== "submenu") throw new Error("expected submenu");
        expect(move.items.map(item => (item.type === "item" ? item.label : ""))).toEqual([
            "Contracts",
            "Contracts / 2026",
            "Unfiled",
        ]);
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

describe("access items", () => {
    it("offers Restrict access only when a handler is wired, after copy and before delete", () => {
        const onRestrictAccess = jest.fn();
        const file = source();
        const items = buildSourceMenuItems(file, folders, [], {
            onCopyTitle: jest.fn(),
            onRestrictAccess,
            onDelete: jest.fn(),
        });
        expect(items.map(item => item.id)).toEqual([
            "title",
            "sep-modify",
            "copy",
            "access",
            "sep-danger",
            "delete",
        ]);
        const access = items.find(item => item.id === "access");
        expect(access?.type === "item" && access.label).toBe("Restrict access…");
        expect(access?.type === "item" && access.icon).toBe("lock");
        if (access?.type === "item") access.onSelect();
        expect(onRestrictAccess).toHaveBeenCalledWith(file);
    });

    it("reads Change access once the document is already restricted", () => {
        const items = buildSourceMenuItems(source({ restricted: true }), folders, [], {
            onRestrictAccess: jest.fn(),
        });
        const access = items.find(item => item.id === "access");
        expect(access?.type === "item" && access.label).toBe("Change access…");
    });

    it("waits for indexing before offering access changes", () => {
        const items = buildSourceMenuItems(source({ documentId: undefined }), folders, [], {
            onRestrictAccess: jest.fn(),
        });
        const access = items.find(item => item.id === "access");
        expect(access?.type === "item" && access.disabled).toBe(true);
    });

    it("offers Share folder… on a folder when a handler is wired", () => {
        const onShare = jest.fn();
        const items = buildFolderMenuItems("Contracts", {
            onRename: jest.fn(),
            onShare,
            onSelectAll: jest.fn(),
            selectState: "none",
        });
        expect(items.map(item => item.id)).toEqual([
            "title",
            "rename-folder",
            "share-folder",
            "select-folder",
        ]);
        const share = items.find(item => item.id === "share-folder");
        if (share?.type === "item") share.onSelect();
        expect(onShare).toHaveBeenCalled();
    });
});

describe("buildSelectionMenuItems", () => {
    const folders: WorkspaceFolder[] = [
        { id: "f1", name: "Plans", color: "x" },
        { id: "f2", name: "Legal", color: "x" },
    ];
    const a: WorkspaceSource = {
        id: "a",
        documentId: 1,
        title: "A",
        type: "doc",
        size: "",
        added: "",
        folder: "Plans",
        tags: [],
        domain: "General",
    };
    const b: WorkspaceSource = { ...a, id: "b", documentId: 2, title: "B" };
    const indexing: WorkspaceSource = { ...a, id: "c", documentId: undefined, title: "C" };

    it("acts on the whole selection and says how many", () => {
        const onRemoveFromContext = jest.fn();
        const onMoveToFolder = jest.fn();
        const onDelete = jest.fn();
        const items = buildSelectionMenuItems([a, b], folders, {
            onRemoveFromContext,
            onMoveToFolder,
            onDelete,
        });
        expect(items[0]).toMatchObject({ type: "label", label: "2 sources selected" });
        const context = items.find(i => i.id === "context");
        expect(context?.type === "item" && context.onSelect()).toBeUndefined();
        expect(onRemoveFromContext).toHaveBeenCalledWith(["a", "b"]);

        const move = items.find(i => i.id === "move");
        expect(move).toMatchObject({ type: "submenu", label: "Move 2 to folder" });
        const legal = move?.type === "submenu" ? move.items.find(i => i.id === "move-Legal") : null;
        // Both sit in Plans, so Plans is checked and Legal is live.
        expect(
            move?.type === "submenu" ? move.items.find(i => i.id === "move-Plans") : null
        ).toMatchObject({
            checked: true,
            disabled: true,
        });
        if (legal?.type === "item") legal.onSelect();
        expect(onMoveToFolder).toHaveBeenCalledWith(["a", "b"], "Legal");

        const del = items.find(i => i.id === "delete");
        expect(del).toMatchObject({ type: "item", label: "Delete 2 sources…", danger: true });
        if (del?.type === "item") del.onSelect();
        expect(onDelete).toHaveBeenCalledWith([a, b]);
    });

    it("skips sources still being indexed and says so", () => {
        const onDelete = jest.fn();
        const items = buildSelectionMenuItems([a, indexing], folders, {
            onDelete,
            onMoveToFolder: jest.fn(),
        });
        expect(items.find(i => i.id === "move")).toMatchObject({ label: "Move 1 of 2 to folder" });
        const del = items.find(i => i.id === "delete");
        expect(del).toMatchObject({ label: "Delete 1 of 2 sources…", disabled: false });
        if (del?.type === "item") del.onSelect();
        expect(onDelete).toHaveBeenCalledWith([a]);

        const none = buildSelectionMenuItems([indexing], folders, { onDelete });
        expect(none.find(i => i.id === "delete")).toMatchObject({
            disabled: true,
            disabledReason: "These sources are still being indexed.",
        });
    });
});

describe("rail additions", () => {
    const source: WorkspaceSource = {
        id: "d1",
        documentId: 1,
        title: "A",
        type: "doc",
        size: "",
        added: "",
        folder: "Plans",
        tags: [],
        domain: "General",
    };

    it("adds open-in-tab, show-in-knowledge, cut and copy-link when the rail can do them", () => {
        const onCut = jest.fn();
        const items = buildSourceMenuItems(source, [], [], {
            onOpenInNewTab: jest.fn(),
            onShowInKnowledge: jest.fn(),
            onCut,
            onCopyLink: jest.fn(),
            onCopyTitle: jest.fn(),
        });
        expect(items.map(i => i.id)).toEqual([
            "title",
            "open-tab",
            "knowledge",
            "sep-modify",
            "cut",
            "copy",
            "copy-link",
        ]);
        const cut = items.find(i => i.id === "cut");
        if (cut?.type === "item") cut.onSelect();
        expect(onCut).toHaveBeenCalledWith(source);
        // A mindmap has no standalone page to open in a tab.
        expect(
            buildSourceMenuItems({ ...source, type: "mindmap" }, [], [], {
                onOpenInNewTab: jest.fn(),
            }).find(i => i.id === "open-tab")
        ).toBeUndefined();
    });

    it("lets a folder take a paste, add a source, and fold its subtree", () => {
        const onPaste = jest.fn();
        const onCollapseAll = jest.fn();
        const items = buildFolderMenuItems("Plans", {
            onAddSource: jest.fn(),
            cutCount: 2,
            onPaste,
            onCollapseAll,
            allCollapsed: false,
        });
        expect(items.map(i => i.id)).toEqual(["title", "add-source", "paste", "collapse-all"]);
        expect(items.find(i => i.id === "paste")).toMatchObject({ label: "Paste 2 sources here" });
        expect(items.find(i => i.id === "collapse-all")).toMatchObject({ label: "Collapse all" });
        const fold = items.find(i => i.id === "collapse-all");
        if (fold?.type === "item") fold.onSelect();
        expect(onCollapseAll).toHaveBeenCalledWith(true);
        // Nothing cut: no paste verb at all.
        expect(
            buildFolderMenuItems("Plans", { onPaste, cutCount: 0 }).find(i => i.id === "paste")
        ).toBeUndefined();
        expect(
            buildBlankRailMenuItems({ cutCount: 1, onPaste }).find(i => i.id === "paste")
        ).toMatchObject({ label: "Paste 1 source at the top level" });
    });
});
