"use client";

import { useEffect, type RefObject } from "react";

/** Recover focus lost when an async save disables/removes the focused control.
 * Never take focus from another Studio pane or an open nested source dialog.
 */
export function useSheetFocusRecovery(open: boolean, heading: RefObject<HTMLElement | null>) {
    useEffect(() => {
        if (!open) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let settled: ReturnType<typeof setTimeout> | undefined;
        let observer: MutationObserver | undefined;
        let content: HTMLElement | null = null;
        let recover: (() => void) | undefined;
        const attach = () => {
            const target = heading.current;
            if (!target?.isConnected || !target.parentElement || observer) return;
            content = target.parentElement;
            recover = () => {
                clearTimeout(timer);
                clearTimeout(settled);
                timer = setTimeout(() => {
                    settled = setTimeout(() => {
                        const modal = document.querySelector(
                            '[role="dialog"][aria-modal="true"][data-state="open"]'
                        );
                        if (modal && !content?.contains(modal)) return;
                        if (
                            target.isConnected &&
                            (!document.activeElement || document.activeElement === document.body)
                        )
                            target.focus({ preventScroll: true });
                    }, 0);
                }, 0);
            };
            observer = new MutationObserver(recover);
            observer.observe(content, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ["disabled", "aria-busy", "data-state"],
            });
            content.addEventListener("focusout", recover);
            recover();
        };
        // Radix may mount portal content after the parent open effect.
        const portal = new MutationObserver(() => {
            attach();
            if (observer) portal.disconnect();
        });
        attach();
        if (!observer) portal.observe(document.body, { childList: true, subtree: true });
        return () => {
            portal.disconnect();
            observer?.disconnect();
            if (content && recover) content.removeEventListener("focusout", recover);
            clearTimeout(timer);
            clearTimeout(settled);
        };
    }, [open, heading]);
}
