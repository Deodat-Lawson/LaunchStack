"use client";

import { Ellipsis, Pencil, Trash2, Users, UserX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
    EXTRACTION_LIMITS,
    type ExtractionTableSummary,
    type ExtractionTableView,
} from "~/lib/extraction/types";
import { useErrorText } from "~/lib/tools/errorText";
import { cn } from "~/lib/utils";

import { extractApi } from "../api";

/**
 * What the person who can manage a table does to it as a whole: rename,
 * share with the workspace or stop, delete. One menu, used on the list's
 * rows and in a table's header, so the three behave the same in both.
 */
export function TableMenu({
    table,
    onChanged,
    onDeleted,
    className,
}: {
    table: Pick<ExtractionTableSummary, "id" | "title" | "shared">;
    onChanged: (table: ExtractionTableView) => void;
    onDeleted: () => void;
    className?: string;
}) {
    const t = useTranslations("extract.manage");
    const tc = useTranslations("common.actions");
    const errorText = useErrorText();
    const [renaming, setRenaming] = useState(false);
    const [draft, setDraft] = useState(table.title);
    const [saving, setSaving] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const rename = async (event: FormEvent) => {
        event.preventDefault();
        const title = draft.trim();
        if (!title || saving) return;
        if (title === table.title) {
            setRenaming(false);
            return;
        }
        setSaving(true);
        try {
            const { table: next } = await extractApi.patch(table.id, { title });
            onChanged(next);
            setRenaming(false);
        } catch (e) {
            toast.error(errorText(e, t("renameFailed")));
        } finally {
            setSaving(false);
        }
    };

    const setShared = async (shared: boolean) => {
        try {
            const { table: next } = await extractApi.patch(table.id, { shared });
            onChanged(next);
            toast.success(shared ? t("sharedToast") : t("unsharedToast"));
        } catch (e) {
            toast.error(errorText(e, t("shareFailed")));
        }
    };

    const remove = async () => {
        try {
            await extractApi.remove(table.id);
            toast.success(t("deletedToast"));
            onDeleted();
        } catch (e) {
            toast.error(errorText(e, t("deleteFailed")));
        }
    };

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn("text-ink-2 size-8", className)}
                        aria-label={t("menuAria", { title: table.title })}
                    >
                        <Ellipsis />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[200px]">
                    <DropdownMenuItem
                        onSelect={() => {
                            setDraft(table.title);
                            setRenaming(true);
                        }}
                    >
                        <Pencil />
                        {tc("rename")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void setShared(!table.shared)}>
                        {table.shared ? <UserX /> : <Users />}
                        {table.shared ? t("stopSharing") : t("share")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                        <Trash2 />
                        {tc("delete")}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <Dialog open={renaming} onOpenChange={setRenaming}>
                <DialogContent className="sm:max-w-[420px]">
                    <form onSubmit={e => void rename(e)} className="grid gap-4">
                        <DialogHeader>
                            <DialogTitle>{t("renameTitle")}</DialogTitle>
                            <DialogDescription>{t("renameBody")}</DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-1.5">
                            <Label htmlFor={`extract-rename-${table.id}`}>{t("renameLabel")}</Label>
                            <Input
                                id={`extract-rename-${table.id}`}
                                value={draft}
                                maxLength={EXTRACTION_LIMITS.titleLength}
                                onChange={e => setDraft(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setRenaming(false)}
                            >
                                {tc("cancel")}
                            </Button>
                            <Button type="submit" disabled={!draft.trim() || saving}>
                                {tc("save")}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                open={confirmDelete}
                onOpenChange={setConfirmDelete}
                title={t("deleteTitle", { title: table.title })}
                description={t("deleteBody")}
                onConfirm={() => void remove()}
            />
        </>
    );
}
