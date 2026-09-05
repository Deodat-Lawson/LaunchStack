import {
    UNFILED_FOLDER,
    displayFolderPath,
    folderDepth,
    folderParentPath,
    isFolderOrDescendant,
    normalizeFolderPath,
} from "~/lib/folders/path";
import type { WorkspaceFolder, WorkspaceSource } from "./types";

/**
 * Declarative items for the source / folder / blank-rail context menus.
 * Kept as data so the menu chrome can stay dumb and tests can assert the
 * action set without rendering portals.
 */

export type SourceContextMenuItem =
    | {
          type: "label";
          id: string;
          label: string;
      }
    | {
          type: "separator";
          id: string;
      }
    | {
          type: "item";
          id: string;
          label: string;
          danger?: boolean;
          disabled?: boolean;
          disabledReason?: string;
          checked?: boolean;
          shortcut?: string;
          icon?:
              | "open"
              | "ask"
              | "rename"
              | "copy"
              | "delete"
              | "folder"
              | "plus"
              | "check"
              | "lock"
              | "share";
          onSelect: () => void;
      }
    | {
          type: "submenu";
          id: string;
          label: string;
          icon?: "folder";
          disabled?: boolean;
          disabledReason?: string;
          items: SourceContextMenuItem[];
      };

export interface SourceMenuHandlers {
    onOpen?: (source: WorkspaceSource) => void;
    onToggleContext?: (source: WorkspaceSource) => void;
    onRename?: (source: WorkspaceSource) => void;
    onMoveToFolder?: (sourceId: string, folderName: string) => void;
    onCopyTitle?: (source: WorkspaceSource) => void;
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

    if (handlers.onToggleContext) {
        items.push({
            type: "item",
            id: "context",
            label: inContext ? "Remove from context" : "Add to context",
            icon: "ask",
            onSelect: () => handlers.onToggleContext?.(source),
        });
    }

    if (handlers.onRename || handlers.onMoveToFolder || handlers.onCopyTitle) {
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

    if (handlers.onCopyTitle) {
        items.push({
            type: "item",
            id: "copy",
            label: "Copy title",
            icon: "copy",
            onSelect: () => handlers.onCopyTitle?.(source),
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
    if (handlers.onNewSubfolder) {
        items.push({
            type: "item",
            id: "new-subfolder",
            label: "New subfolder…",
            icon: "plus",
            onSelect: () => handlers.onNewSubfolder?.(),
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
}

export function buildBlankRailMenuItems(handlers: BlankRailMenuHandlers): SourceContextMenuItem[] {
    const items: SourceContextMenuItem[] = [];
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
