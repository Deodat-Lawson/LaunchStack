"use client";

import { Search, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { InlineError } from "~/components/tools/EmptyState";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import type { ScenarioFileOption } from "~/lib/scenarios/types";
import { cn } from "~/lib/utils";

import { UPLOAD_FOLDER, filterFiles, fileKind, isCompanyFile } from "../_lib/files";
import { CompanyTag, FileGlyph, FileMeta } from "./FileBits";

type View = "all" | "company" | "picked";

/**
 * Choosing workspace files for a scenario, the way a file browser does it:
 * the company's own files first (what the profile counts as about the
 * company, and the Company folder), then everything else, newest first.
 * Ticks apply at once; Done just closes.
 */
export function FilePickerDialog({
    open,
    onOpenChange,
    files,
    loading,
    error,
    onRetry,
    picked,
    max,
    onToggle,
    onUpload,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    files: ScenarioFileOption[];
    loading: boolean;
    error: string | null;
    onRetry: () => void;
    picked: number[];
    max: number;
    onToggle: (id: number, on: boolean) => void;
    /** Null when the viewer may not add files. */
    onUpload: (() => void) | null;
}) {
    const t = useTranslations("scenarios.picker");
    const tc = useTranslations("common");
    const [query, setQuery] = useState("");
    const [view, setView] = useState<View>("all");
    const pickedSet = useMemo(() => new Set(picked), [picked]);

    const shown = useMemo(() => {
        const found = filterFiles(files, query);
        if (view === "company") return found.filter(isCompanyFile);
        if (view === "picked") return found.filter(f => pickedSet.has(f.id));
        return found;
    }, [files, query, view, pickedSet]);
    const company = shown.filter(isCompanyFile);
    const other = shown.filter(f => !isCompanyFile(f));
    const full = picked.length >= max;

    const row = (file: ScenarioFileOption) => {
        const id = `scenario-pick-${file.id}`;
        const on = pickedSet.has(file.id);
        const unreadable = file.status === "failed";
        const disabled = !on && (full || unreadable);
        return (
            <li key={file.id}>
                <label
                    htmlFor={id}
                    className={cn(
                        "border-line-2 flex items-center gap-3 border-t px-5 py-2.5",
                        disabled
                            ? "cursor-not-allowed opacity-60"
                            : "hover:bg-panel-2 cursor-pointer",
                        on && "bg-brand-soft/50"
                    )}
                >
                    <Checkbox
                        id={id}
                        checked={on}
                        disabled={disabled}
                        onCheckedChange={v => onToggle(file.id, v === true)}
                    />
                    <FileGlyph kind={fileKind(file)} />
                    <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                            <span className="text-ink truncate text-[13px] font-medium">
                                {file.title}
                            </span>
                            {file.aboutCompany && <CompanyTag className="max-sm:hidden" />}
                        </span>
                        <FileMeta file={file} />
                    </span>
                </label>
            </li>
        );
    };

    const group = (title: string, note: string, list: ScenarioFileOption[]) =>
        list.length > 0 && (
            <section aria-label={title}>
                <div className="bg-surface/95 border-line-2 sticky top-0 z-[1] flex items-baseline gap-2 border-t px-5 py-2 backdrop-blur first:border-t-0">
                    <h3 className="text-ink-2 text-xs font-semibold">
                        {title}
                        <span className="text-ink-3 ml-1 font-normal tabular-nums">
                            {list.length}
                        </span>
                    </h3>
                    <span className="text-ink-3 truncate text-xs">{note}</span>
                </div>
                <ul>{list.map(row)}</ul>
            </section>
        );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[min(720px,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px]">
                <DialogHeader className="px-5 pb-3 pt-5">
                    <DialogTitle className="text-base">{t("title")}</DialogTitle>
                    <DialogDescription className="text-[13px]">
                        {t("description")}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
                    <div className="border-line bg-surface focus-within:border-brand focus-within:ring-brand/50 flex min-w-[200px] flex-1 items-center gap-2 rounded-md border px-2.5 focus-within:ring-[3px]">
                        <Search className="text-ink-3 size-3.5 shrink-0" aria-hidden />
                        <Input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder={t("find")}
                            aria-label={t("find")}
                            className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 md:text-[13px] dark:bg-transparent"
                        />
                    </div>
                    <ToggleGroup
                        type="single"
                        size="sm"
                        variant="outline"
                        value={view}
                        onValueChange={v => v && setView(v as View)}
                        aria-label={tc("actions.show")}
                    >
                        <ToggleGroupItem value="all" className="px-2.5 text-xs">
                            {tc("status.all")}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="company" className="px-2.5 text-xs">
                            {t("companyFiles")}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="picked" className="px-2.5 text-xs">
                            {t.rich("pickedView", {
                                count: picked.length,
                                n: chunks => <span className="tabular-nums">{chunks}</span>,
                            })}
                        </ToggleGroupItem>
                    </ToggleGroup>
                </div>
                <div className="border-line-2 min-h-[160px] flex-1 overflow-y-auto border-t">
                    {loading ? (
                        <SkeletonRows rows={4} height={52} className="rounded-none border-0" />
                    ) : error ? (
                        <InlineError className="px-5 py-4" message={error} onRetry={onRetry} />
                    ) : shown.length === 0 ? (
                        <p className="text-ink-3 px-5 py-6 text-[13px]">
                            {files.length === 0
                                ? t("noFiles")
                                : view === "picked" && !query.trim()
                                  ? t("nothingPicked")
                                  : view === "company" && !query.trim()
                                    ? t("noCompanyFiles", { folder: UPLOAD_FOLDER })
                                    : t("noMatch")}
                        </p>
                    ) : (
                        <>
                            {group(t("companyFiles"), t("companyNote"), company)}
                            {group(t("otherFiles"), t("otherNote"), other)}
                        </>
                    )}
                </div>
                <DialogFooter className="border-line-2 flex-row items-center justify-between gap-2 border-t px-5 py-3 sm:justify-between">
                    {onUpload ? (
                        <Button type="button" variant="outline" size="sm" onClick={onUpload}>
                            <Upload />
                            {t("upload")}
                        </Button>
                    ) : (
                        <span />
                    )}
                    <div className="flex items-center gap-3">
                        <span
                            className={cn(
                                "text-xs tabular-nums",
                                full ? "text-warn" : "text-ink-3"
                            )}
                            aria-live="polite"
                        >
                            {t("picked", { count: picked.length, max })}
                        </span>
                        <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
                            {tc("actions.done")}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
