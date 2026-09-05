"use client";

import { useEffect, useState } from "react";
import { FolderPlus, PencilLine } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
    displayFolderPath,
    folderLeafName,
    folderParentPath,
    joinFolderPath,
    validateFolderName,
} from "~/lib/folders/path";

/**
 * One dialog for the two ways a folder gets its name: creating one (inside a
 * parent, or at the top level) and renaming one in place. Moving a folder is
 * the same server operation as renaming — it lives in the folder's menu and
 * drag-and-drop, not here.
 */

export type FolderDialogRequest =
    | { mode: "create"; parentPath: string | null }
    | { mode: "rename"; path: string };

export interface FolderDialogProps {
    request: FolderDialogRequest | null;
    /** Every folder path in the workspace, for the "already exists" check. */
    existingPaths: string[];
    /** Resolves to an error message to show, or null when the change landed. */
    onSubmit: (path: string) => Promise<string | null>;
    onClose: () => void;
}

export function FolderDialog({ request, existingPaths, onSubmit, onClose }: FolderDialogProps) {
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!request) return;
        setName(request.mode === "rename" ? folderLeafName(request.path) : "");
        setError(null);
        setBusy(false);
    }, [request]);

    const open = request !== null;
    const parent =
        request?.mode === "create"
            ? request.parentPath
            : request
              ? folderParentPath(request.path)
              : null;
    const trimmed = name.replace(/\s+/g, " ").trim();
    const target = joinFolderPath(parent, trimmed);
    const unchanged = request?.mode === "rename" && target === request.path;
    const nameProblem = trimmed ? validateFolderName(trimmed) : null;
    const taken =
        !unchanged &&
        trimmed.length > 0 &&
        existingPaths.some(path => path.toLowerCase() === target.toLowerCase());
    const problem =
        nameProblem ?? (taken ? `A folder named "${trimmed}" already exists there.` : null);
    const canSubmit = trimmed.length > 0 && !problem && !unchanged && !busy;

    const submit = async () => {
        if (!canSubmit) return;
        setBusy(true);
        setError(null);
        const failure = await onSubmit(target);
        setBusy(false);
        if (failure) {
            setError(failure);
            return;
        }
        onClose();
    };

    const isRename = request?.mode === "rename";

    return (
        <Dialog
            open={open}
            onOpenChange={next => {
                if (!next && !busy) onClose();
            }}
        >
            <DialogContent className="sm:max-w-[440px]" data-testid="folder-dialog">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <span className="bg-brand-soft text-brand flex size-7 items-center justify-center rounded-md">
                            {isRename ? (
                                <PencilLine className="size-4" aria-hidden />
                            ) : (
                                <FolderPlus className="size-4" aria-hidden />
                            )}
                        </span>
                        {isRename ? "Rename folder" : parent ? "New subfolder" : "New folder"}
                    </DialogTitle>
                    <DialogDescription>
                        {parent
                            ? `Inside ${displayFolderPath(parent)}. Everything in this folder moves with it.`
                            : "A folder is where a source lives. Folders can hold other folders."}
                    </DialogDescription>
                </DialogHeader>

                <form
                    className="grid gap-2"
                    onSubmit={event => {
                        event.preventDefault();
                        void submit();
                    }}
                >
                    <Label htmlFor="folder-dialog-name">Name</Label>
                    <Input
                        id="folder-dialog-name"
                        data-testid="folder-dialog-input"
                        value={name}
                        onChange={event => setName(event.target.value)}
                        autoFocus
                        disabled={busy}
                        aria-invalid={Boolean(problem) || undefined}
                        placeholder={parent ? "e.g. 2026" : "e.g. Contracts, Fundraising Q1"}
                    />
                    {(problem ?? error) && (
                        <p className="text-danger text-xs" role="alert">
                            {problem ?? error}
                        </p>
                    )}
                </form>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        data-testid="folder-dialog-submit"
                        onClick={() => void submit()}
                        disabled={!canSubmit}
                    >
                        {busy
                            ? isRename
                                ? "Saving…"
                                : "Creating…"
                            : isRename
                              ? "Save"
                              : "Create folder"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
