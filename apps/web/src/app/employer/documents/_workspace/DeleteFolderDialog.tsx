"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
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

export function DeleteFolderDialog({
    path,
    documentCount,
    subfolderCount,
    onConfirm,
    onClose,
}: DeleteFolderDialogProps) {
    const t = useTranslations("sources.deleteFolderDialog");
    const tc = useTranslations("common");
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
            t("sourcesMove", {
                count: documentCount,
                destination:
                    destination === UNFILED_FOLDER ? t("unfiled") : displayFolderPath(destination),
            })
        );
    }
    if (subfolderCount > 0) {
        consequences.push(t("subfoldersRemoved", { count: subfolderCount }));
    }
    if (consequences.length === 0) consequences.push(t("empty"));

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
                        {path ? t("title", { name: displayFolderPath(path) }) : t("titleFallback")}
                    </DialogTitle>
                    <DialogDescription>
                        {t("description", { consequences: consequences.join(" ") })}
                    </DialogDescription>
                </DialogHeader>
                {error && (
                    <p className="text-danger text-xs" role="alert">
                        {error}
                    </p>
                )}
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                        {tc("actions.cancel")}
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        data-testid="delete-folder-confirm"
                        onClick={() => void confirm()}
                        disabled={busy || !path}
                    >
                        {busy ? t("deleting") : t("deleteFolder")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
