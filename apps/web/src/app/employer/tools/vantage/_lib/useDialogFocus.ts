"use client";

import { useRef } from "react";

/** Controlled dialogs have no Radix Trigger; return keyboard focus to their opener. */
export function useDialogFocus() {
    const opener = useRef<HTMLElement | null>(null);
    return {
        onOpenAutoFocus: () => {
            opener.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null;
        },
        onCloseAutoFocus: (event: Event) => {
            if (opener.current?.isConnected) {
                event.preventDefault();
                opener.current.focus();
            }
        },
    };
}
