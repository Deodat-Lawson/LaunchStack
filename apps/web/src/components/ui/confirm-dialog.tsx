"use client";

import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";

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
    onConfirm: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[420px]" data-testid="confirm-dialog">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description && <DialogDescription>{description}</DialogDescription>}
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
                        variant={destructive ? "destructive" : "default"}
                        onClick={() => {
                            // Close first: the caller's handler may navigate,
                            // and a dialog left mounted over a new screen is
                            // worse than one that closes a frame early.
                            onOpenChange(false);
                            onConfirm();
                        }}
                        data-testid="confirm-accept"
                    >
                        {confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
