import type { ActionMenuItem } from "~/components/ui/action-menu";
import type { AgentSessionItem } from "../lib/api";

/**
 * Declarative items for one row of the sessions browser. What a row can do
 * depends on whether it has been imported: a new session can only be
 * imported; an imported one can be opened, continued, refreshed and removed.
 */
export interface SessionMenuHandlers {
    onImport: () => void;
    onOpen?: () => void;
    onContinue?: () => void;
    onCopyPath?: () => void;
    onCopyId: () => void;
    onRemoveImport?: () => void;
    busy: boolean;
}

export function buildSessionMenuItems(
    item: AgentSessionItem,
    handlers: SessionMenuHandlers
): ActionMenuItem[] {
    const items: ActionMenuItem[] = [{ type: "label", id: "title", label: item.title }];
    const busyReason = handlers.busy ? "An import is already running." : undefined;
    if (item.imported) {
        if (handlers.onOpen) {
            items.push({
                type: "item",
                id: "open",
                label: "Open the transcript",
                icon: "open",
                onSelect: () => handlers.onOpen?.(),
            });
        }
        if (handlers.onContinue) {
            items.push({
                type: "item",
                id: "continue",
                label: "Continue in chat",
                icon: "newChat",
                onSelect: () => handlers.onContinue?.(),
            });
        }
        items.push({
            type: "item",
            id: "import",
            label: item.imported.stale ? "Update the import" : "Re-import",
            icon: "refresh",
            disabled: handlers.busy,
            disabledReason: busyReason,
            onSelect: handlers.onImport,
        });
    } else {
        items.push({
            type: "item",
            id: "import",
            label: "Import",
            icon: "import",
            disabled: handlers.busy,
            disabledReason: busyReason,
            onSelect: handlers.onImport,
        });
    }
    items.push({ type: "separator", id: "sep-copy" });
    if (handlers.onCopyPath && item.projectPath) {
        items.push({
            type: "item",
            id: "copy-path",
            label: "Copy the project path",
            icon: "reveal",
            onSelect: () => handlers.onCopyPath?.(),
        });
    }
    items.push({
        type: "item",
        id: "copy-id",
        label: "Copy the session id",
        icon: "copy",
        onSelect: handlers.onCopyId,
    });
    if (item.imported && handlers.onRemoveImport) {
        items.push({ type: "separator", id: "sep-danger" });
        items.push({
            type: "item",
            id: "remove",
            label: "Remove the import…",
            icon: "delete",
            danger: true,
            onSelect: () => handlers.onRemoveImport?.(),
        });
    }
    return items;
}
