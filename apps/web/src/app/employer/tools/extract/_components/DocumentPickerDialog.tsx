"use client";

import { Folder, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
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
import type { ExtractionSourceOption } from "~/lib/extraction/types";
import { cn } from "~/lib/utils";

import { addToSelection, findSources, groupByFolder, removeFromSelection } from "../_lib/documents";
import { KindGlyph } from "./Bits";

type View = "all" | "picked";

/**
 * Choosing the documents of a table — often dozens at once, so the picker
 * is built for many: find by name or folder, take a whole folder or
 * everything shown in one click, and always see how many are chosen. A
 * document still being processed is listed, so nobody wonders where it went,
 * but cannot be chosen yet. Ticks apply at once; Done just closes.
 */
export function DocumentPickerDialog({
    open,
    onOpenChange,
    sources,
    loading,
    error,
    onRetry,
    picked,
    max,
    onChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sources: ExtractionSourceOption[];
    loading: boolean;
    error: string | null;
    onRetry: () => void;
    picked: number[];
    max: number;
    onChange: (next: number[]) => void;
}) {
    const t = useTranslations("extract.picker");
    const tc = useTranslations("common");
    const locale = useLocale();
    const [query, setQuery] = useState("");
    const [view, setView] = useState<View>("all");
    const pickedSet = useMemo(() => new Set(picked), [picked]);

    const shown = useMemo(() => {
        const found = findSources(sources, query);
        return view === "picked" ? found.filter(s => pickedSet.has(s.documentId)) : found;
    }, [sources, query, view, pickedSet]);
    const groups = useMemo(() => groupByFolder(shown, locale), [shown, locale]);
    const full = picked.length >= max;
    const choosable = shown.filter(s => s.indexed);
    const allShownPicked =
        choosable.length > 0 && choosable.every(s => pickedSet.has(s.documentId));

    const row = (source: ExtractionSourceOption) => {
        const id = `extract-pick-${source.documentId}`;
        const on = pickedSet.has(source.documentId);
        const disabled = !on && (full || !source.indexed);
        return (
            <li key={source.documentId}>
                <label
                    htmlFor={id}
                    className={cn(
                        "border-line-2 flex min-h-10 items-center gap-3 border-t px-5 py-2",
                        disabled ? "cursor-not-allowed" : "hover:bg-panel-2 cursor-pointer",
                        on && "bg-brand-soft/50"
                    )}
                >
                    <Checkbox
                        id={id}
                        checked={on}
                        disabled={disabled}
                        onCheckedChange={v =>
                            onChange(
                                v === true
                                    ? addToSelection(picked, [source], max)
                                    : removeFromSelection(picked, [source])
                            )
                        }
                    />
                    <KindGlyph kind={source.kind} className={cn(disabled && "opacity-60")} />
                    <span
                        className={cn(
                            "text-ink min-w-0 flex-1 truncate text-[13px]",
                            disabled && "text-ink-3"
                        )}
                    >
                        {source.title}
                    </span>
                    {!source.indexed && (
                        <span className="text-ink-3 shrink-0 text-xs">{t("notIndexed")}</span>
                    )}
                </label>
            </li>
        );
    };

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
                        <ToggleGroupItem value="picked" className="px-2.5 text-xs tabular-nums">
                            {t("pickedView", { count: picked.length })}
                        </ToggleGroupItem>
                    </ToggleGroup>
                </div>
                {!loading && !error && shown.length > 0 && (
                    <div className="border-line-2 flex items-center justify-between gap-3 border-t px-5 py-1.5">
                        <span className="text-ink-3 text-xs tabular-nums">
                            {t("shownCount", { count: shown.length })}
                        </span>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={choosable.length === 0 || (!allShownPicked && full)}
                            onClick={() =>
                                onChange(
                                    allShownPicked
                                        ? removeFromSelection(picked, choosable)
                                        : addToSelection(picked, choosable, max)
                                )
                            }
                        >
                            {allShownPicked
                                ? t("clearShown")
                                : t("selectShown", { count: choosable.length })}
                        </Button>
                    </div>
                )}
                <div className="border-line-2 min-h-[160px] flex-1 overflow-y-auto border-t">
                    {loading ? (
                        <SkeletonRows rows={5} height={40} className="rounded-none border-0" />
                    ) : error ? (
                        <InlineError className="px-5 py-4" message={error} onRetry={onRetry} />
                    ) : shown.length === 0 ? (
                        <p className="text-ink-3 px-5 py-6 text-[13px]">
                            {sources.length === 0
                                ? t("noDocuments")
                                : view === "picked" && !query.trim()
                                  ? t("nothingPicked")
                                  : t("noMatch")}
                        </p>
                    ) : (
                        groups.map(group => {
                            const name = group.folder ?? t("unfiled");
                            const can = group.sources.filter(s => s.indexed);
                            const on = can.filter(s => pickedSet.has(s.documentId)).length;
                            const allOn = can.length > 0 && on === can.length;
                            return (
                                <section key={group.folder ?? ""} aria-label={name}>
                                    <div className="bg-surface border-line-2 sticky top-0 z-[1] flex min-h-9 items-center gap-2 border-t px-5 py-1 first:border-t-0">
                                        <Folder
                                            className="text-ink-3 size-3.5 shrink-0"
                                            aria-hidden
                                        />
                                        <h3 className="text-ink-2 min-w-0 truncate text-xs font-semibold">
                                            {name}
                                        </h3>
                                        <span className="text-ink-3 shrink-0 text-xs tabular-nums">
                                            {t("folderCount", {
                                                picked: on,
                                                total: group.sources.length,
                                            })}
                                        </span>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="ml-auto h-7 shrink-0 px-2 text-xs"
                                            disabled={can.length === 0 || (!allOn && full)}
                                            aria-label={
                                                allOn
                                                    ? t("clearFolderAria", { folder: name })
                                                    : t("selectFolderAria", { folder: name })
                                            }
                                            onClick={() =>
                                                onChange(
                                                    allOn
                                                        ? removeFromSelection(picked, can)
                                                        : addToSelection(picked, can, max)
                                                )
                                            }
                                        >
                                            {allOn ? t("clearFolder") : t("selectFolder")}
                                        </Button>
                                    </div>
                                    <ul>{group.sources.map(row)}</ul>
                                </section>
                            );
                        })
                    )}
                </div>
                <DialogFooter className="border-line-2 flex-row items-center justify-between gap-2 border-t px-5 py-3 sm:justify-between">
                    <span
                        className={cn(
                            "text-xs tabular-nums",
                            full ? "text-warn-ink" : "text-ink-3"
                        )}
                        aria-live="polite"
                    >
                        {full
                            ? t("pickedFull", { count: picked.length, max })
                            : t("picked", { count: picked.length })}
                    </span>
                    <div className="flex items-center gap-2">
                        {picked.length > 0 && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => onChange([])}
                            >
                                {t("clearAll")}
                            </Button>
                        )}
                        <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
                            {tc("actions.done")}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
