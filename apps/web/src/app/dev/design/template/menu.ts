import type { useTranslations } from "next-intl";

import type { ActionMenuItem } from "~/components/ui/action-menu";

import type { Contract } from "./data";

/** `useTranslations("designTemplate.contract")`, passed in by the row or screen that opens the menu. */
export type ContractMenuT = ReturnType<typeof useTranslations<"designTemplate.contract">>;

export interface ContractMenuHandlers {
    onOpen?: () => void;
    onDecide: () => void;
    onAsk: () => void;
    onCopyLink: () => void;
    onDelete: () => void;
}

/**
 * One contract's verbs, for right-click on its row and for the "⋯" button
 * beside it — the same list, so nothing is reachable by right-click alone.
 * Pure: it takes the object and a bag of handlers and returns items, so the
 * set can be unit-tested without a portal. Destructive verbs go last, after
 * a separator, marked `danger`.
 */
export function buildContractMenuItems(
    contract: Contract,
    handlers: ContractMenuHandlers,
    t: ContractMenuT
): ActionMenuItem[] {
    const items: ActionMenuItem[] = [{ type: "label", id: "title", label: contract.vendor }];
    if (handlers.onOpen) {
        items.push({
            type: "item",
            id: "open",
            label: t("openContract"),
            icon: "open",
            onSelect: handlers.onOpen,
        });
    }
    items.push(
        {
            type: "item",
            id: "decide",
            label: t("recordDecision"),
            icon: "check",
            onSelect: handlers.onDecide,
        },
        { type: "item", id: "ask", label: t("askAbout"), icon: "ask", onSelect: handlers.onAsk },
        {
            type: "item",
            id: "copy-link",
            label: t("copyLink"),
            icon: "link",
            onSelect: handlers.onCopyLink,
        },
        { type: "separator", id: "sep-danger" },
        {
            type: "item",
            id: "delete",
            label: t("deleteRenewal"),
            icon: "delete",
            danger: true,
            onSelect: handlers.onDelete,
        }
    );
    return items;
}
