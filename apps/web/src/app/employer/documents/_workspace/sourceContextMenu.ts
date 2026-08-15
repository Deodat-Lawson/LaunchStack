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
      icon?: "open" | "ask" | "rename" | "copy" | "delete" | "folder" | "plus" | "check";
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
  onDelete?: (source: WorkspaceSource) => void;
}

export function isPersistedSource(source: WorkspaceSource): boolean {
  return typeof source.documentId === "number" && source.documentId > 0;
}

export function buildSourceMenuItems(
  source: WorkspaceSource,
  folders: WorkspaceFolder[],
  selected: string[],
  handlers: SourceMenuHandlers,
): SourceContextMenuItem[] {
  const persisted = isPersistedSource(source);
  const indexingReason = "This source is still being indexed.";
  const inContext = selected.includes(source.id);
  const currentFolder = source.folder?.trim() || "Unfiled";
  const items: SourceContextMenuItem[] = [
    { type: "label", id: "title", label: source.title },
  ];

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

  if (
    handlers.onRename ||
    handlers.onMoveToFolder ||
    handlers.onCopyTitle
  ) {
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
      items: folderNames.map((name) => ({
        type: "item" as const,
        id: `move-${name}`,
        label: name,
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
  onRename?: () => void;
  onSelectAll?: (add: boolean) => void;
  selectState?: "none" | "some" | "all";
}

export function buildFolderMenuItems(
  folderName: string,
  handlers: FolderMenuHandlers,
): SourceContextMenuItem[] {
  const items: SourceContextMenuItem[] = [
    { type: "label", id: "title", label: folderName },
  ];
  if (handlers.onRename) {
    items.push({
      type: "item",
      id: "rename-folder",
      label: "Rename or delete…",
      icon: "rename",
      onSelect: () => handlers.onRename?.(),
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
  return items;
}

export interface BlankRailMenuHandlers {
  onAddKnowledge?: () => void;
  onNewFolder?: () => void;
}

export function buildBlankRailMenuItems(
  handlers: BlankRailMenuHandlers,
): SourceContextMenuItem[] {
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

function uniqueFolderNames(
  folders: WorkspaceFolder[],
  currentFolder: string,
): string[] {
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
