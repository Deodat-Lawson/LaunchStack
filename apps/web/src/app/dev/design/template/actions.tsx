"use client";

/**
 * Verbs on a contract that any screen can call: ask about it, copy its link,
 * delete it. Delete asks first, in a kit `ConfirmDialog` mounted once here —
 * never `window.confirm`, which embedded web views silently refuse.
 */

import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useToolNav } from "~/components/tool-app/nav";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";

import { paths } from "./bits";
import type { Contract } from "./data";

interface ContractActions {
    ask: (contract: Contract) => void;
    copyLink: (contract: Contract) => void;
    requestDelete: (contract: Contract) => void;
}

const ActionsContext = createContext<ContractActions | null>(null);

export function useContractActions(): ContractActions {
    const value = useContext(ActionsContext);
    if (!value) throw new Error("useContractActions must be used inside ContractActionsProvider");
    return value;
}

export function ContractActionsProvider({ children }: { children: ReactNode }) {
    const t = useTranslations("designTemplate.contract");
    const { navigate, linkFor } = useToolNav();
    const [deleting, setDeleting] = useState<Contract | null>(null);

    const ask = useCallback(
        (contract: Contract) =>
            // A site link: the tab hands it to the workspace, which opens Chat
            // beside this tab with the question ready.
            navigate(
                `/employer/documents?ask=${encodeURIComponent(t("askQuestion", { vendor: contract.vendor }))}`
            ),
        [navigate, t]
    );
    const copyLink = useCallback(
        (contract: Contract) => {
            const url = new URL(linkFor(paths.contract(contract.id)), window.location.origin).href;
            // Say it worked only once it has: the clipboard can refuse (no
            // focus, no permission, an embedded view).
            void (async () => {
                try {
                    await navigator.clipboard.writeText(url);
                    toast.success(t("linkCopied"));
                } catch {
                    toast.error(t("linkCopyFailed"));
                }
            })();
        },
        [linkFor, t]
    );
    const value = useMemo<ContractActions>(
        () => ({ ask, copyLink, requestDelete: setDeleting }),
        [ask, copyLink]
    );

    return (
        <ActionsContext.Provider value={value}>
            {children}
            <ConfirmDialog
                open={deleting !== null}
                onOpenChange={open => {
                    if (!open) setDeleting(null);
                }}
                title={t("deleteTitle")}
                description={deleting ? t("deleteBody", { vendor: deleting.vendor }) : undefined}
                onConfirm={() => {
                    toast.success(t("deleted"));
                    setDeleting(null);
                    navigate(paths.contracts());
                }}
            />
        </ActionsContext.Provider>
    );
}
