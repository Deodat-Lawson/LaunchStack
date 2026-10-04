"use client";

import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";

/**
 * "Are you sure?", in the app rather than in the browser.
 *
 * `window.confirm` looked like the cheap option and was not: it is suppressed
 * outright in embedded web views — the desktop shell, an in-app browser pane —
 * where it returns false without ever being shown. A delete guarded by it then
 * does nothing at all, with no dialog and no error, which is exactly what
 * "delete doesn't work" turned out to be. It also blocks the main thread and
 * ignores the app's theme.
 *
 * Deliberately not a `useConfirm()` promise hook: a component the caller
 * mounts keeps the pending action visible in the caller's own state, which is
 * what lets the confirming button show a busy state later without threading a
 * resolver around.
 */
export function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmLabel = "Delete",
    cancelLabel = "Cancel",
    destructive = true,
    layerClassName,
    onConfirm,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    /** What is about to happen, and whether it can be undone. */
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
    /**
     * Stacking for both the backdrop and the panel, for a dialog asked from a
     * surface that sits above the page's own layer — the full-screen document
     * preview is z-80, and a dialog left at the default would open behind it.
     */
    layerClassName?: string;
    onConfirm: () => void;
}) {
    // Callers clear their pending item as the dialog closes, which would
    // blank the title and description halfway through the fade-out. While
    // closed, keep saying what was last asked.
    const asked = { title, description, confirmLabel, destructive };
    const [last, setLast] = useState(asked);
    if (
        open &&
        (last.title !== title ||
            last.description !== description ||
            last.confirmLabel !== confirmLabel ||
            last.destructive !== destructive)
    ) {
        setLast(asked);
    }
    const shown = open ? asked : last;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={cn("sm:max-w-[420px]", layerClassName)}
                overlayClassName={layerClassName}
                data-testid="confirm-dialog"
                // No description: say so, rather than point at a missing one.
                {...(shown.description ? {} : { "aria-describedby": undefined })}
            >
                <DialogHeader>
                    <DialogTitle>{shown.title}</DialogTitle>
                    {shown.description && (
                        <DialogDescription>{shown.description}</DialogDescription>
                    )}
                </DialogHeader>
                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        data-testid="confirm-cancel"
                    >
                        {cancelLabel}
                    </Button>
                    <Button
                        variant={shown.destructive ? "destructive" : "default"}
                        onClick={() => {
                            // Close first: the caller's handler may navigate,
                            // and a dialog left mounted over a new screen is
                            // worse than one that closes a frame early.
                            onOpenChange(false);
                            onConfirm();
                        }}
                        data-testid="confirm-accept"
                    >
                        {shown.confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
