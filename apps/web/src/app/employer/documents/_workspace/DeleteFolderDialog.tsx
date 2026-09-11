"use client";

import { useEffect, useState } from "react";
import { FolderX } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { UNFILED_FOLDER, displayFolderPath, folderParentPath } from "~/lib/folders/path";

/**
 * Deleting a folder never deletes a source. Everything inside — including
 * what sits in subfolders — moves up to the folder's parent, or to Unfiled at
 * the top level, and the dialog says so with the real numbers.
 */

export interface DeleteFolderDialogProps {
    /** The folder being deleted, or null when closed. */
    path: string | null;
    /** Sources in this folder and every folder beneath it. */
    documentCount: number;
    /** Folders beneath this one. */
    subfolderCount: number;
    /** Resolves to an error message to show, or null when the folder is gone. */
    onConfirm: (path: string) => Promise<string | null>;
    onClose: () => void;
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function DeleteFolderDialog({
    path,
    documentCount,
    subfolderCount,
    onConfirm,
    onClose,
}: DeleteFolderDialogProps) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setBusy(false);
        setError(null);
    }, [path]);

    const destination = path ? (folderParentPath(path) ?? UNFILED_FOLDER) : UNFILED_FOLDER;

    const confirm = async () => {
        if (!path || busy) return;
        setBusy(true);
        setError(null);
        const failure = await onConfirm(path);
        setBusy(false);
        if (failure) {
            setError(failure);
            return;
        }
        onClose();
    };

    const consequences: string[] = [];
    if (documentCount > 0) {
        consequences.push(
            `${plural(documentCount, "source")} inside will move to ${displayFolderPath(destination)}.`
        );
    }
    if (subfolderCount > 0) {
        consequences.push(`${plural(subfolderCount, "subfolder")} will be removed too.`);
    }
    if (consequences.length === 0) consequences.push("The folder is empty.");

    return (
        <Dialog
            open={path !== null}
            onOpenChange={next => {
                if (!next && !busy) onClose();
            }}
        >
            <DialogContent className="sm:max-w-[440px]" data-testid="delete-folder-dialog">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <span className="bg-danger-soft text-danger flex size-7 items-center justify-center rounded-md">
                            <FolderX className="size-4" aria-hidden />
                        </span>
                        Delete {path ? `"${displayFolderPath(path)}"` : "folder"}?
                    </DialogTitle>
                    <DialogDescription>
                        No source is deleted. {consequences.join(" ")}
                    </DialogDescription>
                </DialogHeader>
                {error && (
                    <p className="text-danger text-xs" role="alert">
                        {error}
                    </p>
                )}
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        data-testid="delete-folder-confirm"
                        onClick={() => void confirm()}
                        disabled={busy || !path}
                    >
                        {busy ? "Deleting…" : "Delete folder"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
