import type { useTranslations } from "next-intl";

import type { ActionMenuItem } from "~/components/ui/action-menu";
import type { AgentSessionItem } from "../lib/api";

export type SessionMenuTranslator = ReturnType<typeof useTranslations<"agents.sessions.menu">>;

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
    handlers: SessionMenuHandlers,
    t: SessionMenuTranslator
): ActionMenuItem[] {
    const items: ActionMenuItem[] = [{ type: "label", id: "title", label: item.title }];
    const busyReason = handlers.busy ? t("busy") : undefined;
    if (item.imported) {
        if (handlers.onOpen) {
            items.push({
                type: "item",
                id: "open",
                label: t("openTranscript"),
                icon: "open",
                onSelect: () => handlers.onOpen?.(),
            });
        }
        if (handlers.onContinue) {
            items.push({
                type: "item",
                id: "continue",
                label: t("continueInChat"),
                icon: "newChat",
                onSelect: () => handlers.onContinue?.(),
            });
        }
        items.push({
            type: "item",
            id: "import",
            label: item.imported.stale ? t("updateImport") : t("reimport"),
            icon: "refresh",
            disabled: handlers.busy,
            disabledReason: busyReason,
            onSelect: handlers.onImport,
        });
    } else {
        items.push({
            type: "item",
            id: "import",
            label: t("import"),
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
            label: t("copyPath"),
            icon: "reveal",
            onSelect: () => handlers.onCopyPath?.(),
        });
    }
    items.push({
        type: "item",
        id: "copy-id",
        label: t("copyId"),
        icon: "copy",
        onSelect: handlers.onCopyId,
    });
    if (item.imported && handlers.onRemoveImport) {
        items.push({ type: "separator", id: "sep-danger" });
        items.push({
            type: "item",
            id: "remove",
            label: t("removeImport"),
            icon: "delete",
            danger: true,
            onSelect: () => handlers.onRemoveImport?.(),
        });
    }
    return items;
}
