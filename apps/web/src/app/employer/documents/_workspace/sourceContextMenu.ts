import {
    UNFILED_FOLDER,
    displayFolderPath,
    folderDepth,
    folderParentPath,
    isFolderOrDescendant,
    normalizeFolderPath,
} from "~/lib/folders/path";
import type { WorkspaceFolder, WorkspaceSource } from "./types";

import type { ActionMenuItem } from "~/components/ui/action-menu";

/**
 * Declarative items for the source / folder / blank-rail context menus.
 * Kept as data so the menu chrome can stay dumb and tests can assert the
 * action set without rendering portals. The item model itself lives with the
 * menu primitive; this alias keeps the rail's builders reading naturally.
 */
export type SourceContextMenuItem = ActionMenuItem;

export interface SourceMenuHandlers {
    onOpen?: (source: WorkspaceSource) => void;
    /** Put it in a column beside whatever is open, rather than over it. */
    onOpenBeside?: (source: WorkspaceSource) => void;
    onToggleContext?: (source: WorkspaceSource) => void;
    onRename?: (source: WorkspaceSource) => void;
    onMoveToFolder?: (sourceId: string, folderName: string) => void;
    onCopyTitle?: (source: WorkspaceSource) => void;
    onOpenInNewTab?: (source: WorkspaceSource) => void;
    onCopyLink?: (source: WorkspaceSource) => void;
    /** Browse this source in the full Knowledge surface. */
    onShowInKnowledge?: (source: WorkspaceSource) => void;
    /** Pick the source up, to drop it on a folder with "Paste". */
    onCut?: (source: WorkspaceSource) => void;
    /** Opens the access dialog: who, beyond the folder's audience, may see this document. */
    onRestrictAccess?: (source: WorkspaceSource) => void;
    onDelete?: (source: WorkspaceSource) => void;
}

export function isPersistedSource(source: WorkspaceSource): boolean {
    // A mindmap is persisted by its own row, published or not; everything
    // else is persisted by a document row.
    if (source.type === "mindmap") {
        return typeof source.mindmapId === "number" && source.mindmapId > 0;
    }
    return typeof source.documentId === "number" && source.documentId > 0;
}

export function buildSourceMenuItems(
    source: WorkspaceSource,
    folders: WorkspaceFolder[],
    selected: string[],
    handlers: SourceMenuHandlers
): SourceContextMenuItem[] {
    const persisted = isPersistedSource(source);
    const indexingReason = "This source is still being indexed.";
    const inContext = selected.includes(source.id);
    const currentFolder = source.folder?.trim() || "Unfiled";
    const items: SourceContextMenuItem[] = [{ type: "label", id: "title", label: source.title }];

    if (handlers.onOpen) {
        items.push({
            type: "item",
            id: "open",
            label: "Open",
            icon: "open",
            onSelect: () => handlers.onOpen?.(source),
        });
    }

    if (handlers.onOpenBeside) {
        items.push({
            type: "item",
            id: "open-beside",
            label: "Open to the side",
            icon: "split",
            onSelect: () => handlers.onOpenBeside?.(source),
        });
    }

    if (handlers.onToggleContext) {
        items.push({
            type: "item",
            id: "context",
            label: inContext ? "Remove from context" : "Add to context",
            icon: "ask",
            onSelect: () => handlers.onToggleContext?.(source),
        });
    }

    if (handlers.onOpenInNewTab && source.type !== "mindmap") {
        items.push({
            type: "item",
            id: "open-tab",
            label: "Open in a new tab",
            icon: "external",
            disabled: !persisted,
            disabledReason: persisted ? undefined : indexingReason,
            onSelect: () => handlers.onOpenInNewTab?.(source),
        });
    }

    if (handlers.onShowInKnowledge) {
        items.push({
            type: "item",
            id: "knowledge",
            label: "Show in Knowledge",
            icon: "search",
            onSelect: () => handlers.onShowInKnowledge?.(source),
        });
    }

    if (handlers.onRename || handlers.onMoveToFolder || handlers.onCopyTitle || handlers.onCut) {
        items.push({ type: "separator", id: "sep-modify" });
    }

    if (handlers.onRename) {
        items.push({
            type: "item",
            id: "rename",
            label: "Rename…",
            icon: "rename",
            disabled: !persisted,
            disabledReason: persisted ? undefined : indexingReason,
            onSelect: () => handlers.onRename?.(source),
        });
    }

    if (handlers.onMoveToFolder) {
        const folderNames = uniqueFolderNames(folders, currentFolder);
        items.push({
            type: "submenu",
            id: "move",
            label: "Move to folder",
            icon: "folder",
            disabled: !persisted,
            disabledReason: persisted ? undefined : indexingReason,
            items: folderNames.map(name => ({
                type: "item" as const,
                id: `move-${name}`,
                label: displayFolderPath(name),
                icon: name === currentFolder ? "check" : undefined,
                checked: name === currentFolder,
                disabled: name === currentFolder,
                onSelect: () => handlers.onMoveToFolder?.(source.id, name),
            })),
        });
    }

    if (handlers.onCut) {
        items.push({
            type: "item",
            id: "cut",
            label: "Cut",
            icon: "cut",
            shortcut: "⌘X",
            disabled: !persisted,
            disabledReason: persisted ? undefined : indexingReason,
            onSelect: () => handlers.onCut?.(source),
        });
    }

    if (handlers.onCopyTitle) {
        items.push({
            type: "item",
            id: "copy",
            label: "Copy title",
            icon: "copy",
            onSelect: () => handlers.onCopyTitle?.(source),
        });
    }

    if (handlers.onCopyLink) {
        items.push({
            type: "item",
            id: "copy-link",
            label: "Copy link",
            icon: "link",
            onSelect: () => handlers.onCopyLink?.(source),
        });
    }

    if (handlers.onRestrictAccess) {
        items.push({
            type: "item",
            id: "access",
            label: source.restricted ? "Change access…" : "Restrict access…",
            icon: "lock",
            disabled: !persisted,
            disabledReason: persisted ? undefined : indexingReason,
            onSelect: () => handlers.onRestrictAccess?.(source),
        });
    }

    if (handlers.onDelete) {
        items.push({ type: "separator", id: "sep-danger" });
        items.push({
            type: "item",
            id: "delete",
            label: "Delete…",
            icon: "delete",
            danger: true,
            disabled: !persisted,
            disabledReason: persisted ? undefined : indexingReason,
            onSelect: () => handlers.onDelete?.(source),
        });
    }

    return items;
}

export interface FolderMenuHandlers {
    /** Focus the rail on this folder's subtree. */
    onOpen?: () => void;
    onNewSubfolder?: () => void;
    /** Open the Add dialog with this folder pre-selected. */
    onAddSource?: () => void;
    /** Sources picked up with "Cut", waiting for a folder. */
    cutCount?: number;
    onPaste?: () => void;
    /** Fold or unfold every folder in this subtree. */
    onCollapseAll?: (collapse: boolean) => void;
    /** Whether every folder in the subtree is folded already. */
    allCollapsed?: boolean;
    onRename?: () => void;
    /** Opens the folder access dialog: everyone in the workspace, or only people added. */
    onShare?: () => void;
    /** Move the folder under `targetParent`; null means the top level. */
    onMove?: (targetParent: string | null) => void;
    onDelete?: () => void;
    onSelectAll?: (add: boolean) => void;
    selectState?: "none" | "some" | "all";
    /** Every folder path in the workspace, for the move submenu. */
    folders?: string[];
}

export function buildFolderMenuItems(
    folderPath: string,
    handlers: FolderMenuHandlers
): SourceContextMenuItem[] {
    const path = normalizeFolderPath(folderPath);
    const items: SourceContextMenuItem[] = [
        { type: "label", id: "title", label: displayFolderPath(path) },
    ];
    if (handlers.onOpen) {
        items.push({
            type: "item",
            id: "open-folder",
            label: "Open folder",
            icon: "open",
            onSelect: () => handlers.onOpen?.(),
        });
    }
    if (handlers.onAddSource) {
        items.push({
            type: "item",
            id: "add-source",
            label: "New source in this folder…",
            icon: "plus",
            onSelect: () => handlers.onAddSource?.(),
        });
    }
    if (handlers.onNewSubfolder) {
        items.push({
            type: "item",
            id: "new-subfolder",
            label: "New subfolder…",
            icon: "folder",
            onSelect: () => handlers.onNewSubfolder?.(),
        });
    }
    if (handlers.onPaste && (handlers.cutCount ?? 0) > 0) {
        const n = handlers.cutCount ?? 0;
        items.push({
            type: "item",
            id: "paste",
            label: `Paste ${n} ${n === 1 ? "source" : "sources"} here`,
            icon: "paste",
            shortcut: "⌘V",
            onSelect: () => handlers.onPaste?.(),
        });
    }
    if (handlers.onCollapseAll) {
        const collapse = !handlers.allCollapsed;
        items.push({
            type: "item",
            id: "collapse-all",
            label: collapse ? "Collapse all" : "Expand all",
            icon: collapse ? "hide" : "open",
            onSelect: () => handlers.onCollapseAll?.(collapse),
        });
    }
    if (handlers.onRename) {
        items.push({
            type: "item",
            id: "rename-folder",
            label: "Rename…",
            icon: "rename",
            onSelect: () => handlers.onRename?.(),
        });
    }
    if (handlers.onMove) {
        const parent = folderParentPath(path);
        const targets = (handlers.folders ?? [])
            .map(normalizeFolderPath)
            .filter(
                candidate =>
                    candidate !== UNFILED_FOLDER &&
                    candidate !== parent &&
                    !isFolderOrDescendant(candidate, path)
            )
            .sort((a, b) => a.localeCompare(b));
        items.push({
            type: "submenu",
            id: "move-folder",
            label: "Move to…",
            icon: "folder",
            items: [
                {
                    type: "item" as const,
                    id: "move-folder-root",
                    label: "Top level",
                    icon: folderDepth(path) === 0 ? "check" : undefined,
                    checked: folderDepth(path) === 0,
                    disabled: folderDepth(path) === 0,
                    onSelect: () => handlers.onMove?.(null),
                },
                ...targets.map(target => ({
                    type: "item" as const,
                    id: `move-folder-${target}`,
                    label: displayFolderPath(target),
                    onSelect: () => handlers.onMove?.(target),
                })),
            ],
        });
    }
    if (handlers.onShare) {
        items.push({
            type: "item",
            id: "share-folder",
            label: "Share folder…",
            icon: "share",
            onSelect: () => handlers.onShare?.(),
        });
    }
    if (handlers.onSelectAll) {
        const all = handlers.selectState === "all";
        items.push({
            type: "item",
            id: "select-folder",
            label: all ? "Deselect all in folder" : "Select all in folder",
            icon: "check",
            onSelect: () => handlers.onSelectAll?.(!all),
        });
    }
    if (handlers.onDelete) {
        items.push({ type: "separator", id: "sep-folder-danger" });
        items.push({
            type: "item",
            id: "delete-folder",
            label: "Delete…",
            icon: "delete",
            danger: true,
            onSelect: () => handlers.onDelete?.(),
        });
    }
    return items;
}

export interface BlankRailMenuHandlers {
    onAddKnowledge?: () => void;
    onNewFolder?: () => void;
    /** Sources picked up with "Cut"; pasting here files them at the top level. */
    cutCount?: number;
    onPaste?: () => void;
}

export function buildBlankRailMenuItems(handlers: BlankRailMenuHandlers): SourceContextMenuItem[] {
    const items: SourceContextMenuItem[] = [];
    if (handlers.onPaste && (handlers.cutCount ?? 0) > 0) {
        const n = handlers.cutCount ?? 0;
        items.push({
            type: "item",
            id: "paste",
            label: `Paste ${n} ${n === 1 ? "source" : "sources"} at the top level`,
            icon: "paste",
            shortcut: "⌘V",
            onSelect: () => handlers.onPaste?.(),
        });
    }
    if (handlers.onAddKnowledge) {
        items.push({
            type: "item",
            id: "add",
            label: "Add knowledge",
            icon: "plus",
            onSelect: () => handlers.onAddKnowledge?.(),
        });
    }
    if (handlers.onNewFolder) {
        items.push({
            type: "item",
            id: "new-folder",
            label: "New folder",
            icon: "folder",
            onSelect: () => handlers.onNewFolder?.(),
        });
    }
    return items;
}

export interface SelectionMenuHandlers {
    /** Drop every one of these from the chat context. */
    onRemoveFromContext?: (ids: string[]) => void;
    onMoveToFolder?: (ids: string[], folderName: string) => void;
    onDelete?: (sources: WorkspaceSource[]) => void;
}

/**
 * The menu for a right-click inside a multi-selection: every verb acts on
 * the whole selection, and says so. Sources still being indexed cannot be
 * moved or deleted yet, so those verbs act on the persisted subset and say
 * how many that is.
 */
export function buildSelectionMenuItems(
    sources: WorkspaceSource[],
    folders: WorkspaceFolder[],
    handlers: SelectionMenuHandlers
): SourceContextMenuItem[] {
    const count = sources.length;
    const noun = count === 1 ? "source" : "sources";
    const persisted = sources.filter(isPersistedSource);
    const pending = count - persisted.length;
    const pendingReason =
        pending === count
            ? "These sources are still being indexed."
            : `${pending} of these ${pending === 1 ? "is" : "are"} still being indexed and will be skipped.`;
    const folderOf = (source: WorkspaceSource) => source.folder?.trim() || "Unfiled";
    const sharedFolder = sources.every(s => folderOf(s) === folderOf(sources[0]!))
        ? folderOf(sources[0]!)
        : null;

    const items: SourceContextMenuItem[] = [
        { type: "label", id: "title", label: `${count} ${noun} selected` },
    ];

    if (handlers.onRemoveFromContext) {
        items.push({
            type: "item",
            id: "context",
            label: "Remove all from context",
            icon: "ask",
            onSelect: () => handlers.onRemoveFromContext?.(sources.map(s => s.id)),
        });
    }

    if (handlers.onMoveToFolder) {
        const folderNames = uniqueFolderNames(folders, sharedFolder ?? "Unfiled");
        items.push({
            type: "submenu",
            id: "move",
            label: `Move ${persisted.length === count ? count : `${persisted.length} of ${count}`} to folder`,
            icon: "folder",
            disabled: persisted.length === 0,
            disabledReason: persisted.length === 0 ? pendingReason : undefined,
            items: folderNames.map(name => ({
                type: "item" as const,
                id: `move-${name}`,
                label: displayFolderPath(name),
                icon: name === sharedFolder ? "check" : undefined,
                checked: name === sharedFolder,
                disabled: name === sharedFolder,
                onSelect: () =>
                    handlers.onMoveToFolder?.(
                        persisted.map(s => s.id),
                        name
                    ),
            })),
        });
    }

    if (handlers.onDelete) {
        items.push({ type: "separator", id: "sep-danger" });
        items.push({
            type: "item",
            id: "delete",
            label: `Delete ${persisted.length === count ? count : `${persisted.length} of ${count}`} ${noun}…`,
            icon: "delete",
            danger: true,
            disabled: persisted.length === 0,
            disabledReason: persisted.length === 0 ? pendingReason : undefined,
            onSelect: () => handlers.onDelete?.(persisted),
        });
    }

    return items;
}

function uniqueFolderNames(folders: WorkspaceFolder[], currentFolder: string): string[] {
    const names = new Set<string>(["Unfiled"]);
    for (const folder of folders) {
        const name = folder.name.trim();
        if (name) names.add(name);
    }
    names.add(currentFolder);
    return [...names].sort((a, b) => {
        if (a === "Unfiled") return 1;
        if (b === "Unfiled") return -1;
        return a.localeCompare(b);
    });
}
