"use client";

import { ChevronDown, Download, MessageSquareText, RotateCw, Search, Square } from "lucide-react";
import { useFormatter, useLocale, useNow, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ToolNotFound } from "~/components/tool-app/ToolFrame";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { useToolActive, useToolNav } from "~/components/tool-app/nav";
import { InlineError } from "~/components/tools/EmptyState";
import { SkeletonBlock, SkeletonRows } from "~/components/tools/SkeletonRows";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Progress } from "~/components/ui/progress";
import { Spinner } from "~/components/ui/spinner";
import type { ExtractionTableView } from "~/lib/extraction/types";
import { useErrorText } from "~/lib/tools/errorText";
import { useResource } from "~/lib/tools/useResource";

import { extractApi } from "../api";
import { StatusPill } from "../_components/Bits";
import { ResultsGrid } from "../_components/ResultsGrid";
import { TableMenu } from "../_components/TableMenu";
import { filterRows, isLive, nextSort, progressOf, sortRows, type GridSort } from "../_lib/cells";
import { useExtract } from "../_lib/context";
import { askHref } from "../_lib/links";
import type { ExtractScreen } from "../_lib/screens";

type TableScreenProps = { screen: Extract<ExtractScreen, { kind: "table" }> };

const SCREEN_PAD = "@max-md:px-4 px-8";

/**
 * One table: what it is and how far along, what its owner can do with it
 * (export, ask the chat about it, cancel, retry what failed, rename, share,
 * delete), and the grid. Asks the server every two seconds while documents
 * are still being read — and only while this tab is the one in front, since
 * a hidden tab stays mounted. The grid takes whatever height is left and
 * scrolls inside it, so its header row never leaves.
 */
export function TableScreen({ screen }: TableScreenProps) {
    const t = useTranslations("extract.table");
    const tt = useTranslations("extract.tool");
    const tg = useTranslations("extract.grid");
    const locale = useLocale();
    const errorText = useErrorText();
    const active = useToolActive();
    const { navigate } = useToolNav();
    const { list } = useExtract();
    const [polling, setPolling] = useState(true);
    const res = useResource(`extract:table:${screen.id}`, () => extractApi.get(screen.id), {
        pollMs: polling && active ? 2000 : null,
    });
    const table = res.data?.table ?? null;
    const live = table ? isLive(table.status) : true;
    const reloadList = list.reload;
    const reloadTable = res.reload;

    // Stop asking once it ends, and tell the list (which may still show it running).
    const wasLive = useRef<boolean | null>(null);
    useEffect(() => {
        if (!table) return;
        setPolling(live);
        if (wasLive.current === true && !live) void reloadList();
        wasLive.current = live;
    }, [table, live, reloadList]);

    // Back in front after a while behind another tab: catch up at once
    // instead of waiting out the interval.
    const wasActive = useRef(active);
    useEffect(() => {
        if (active && !wasActive.current && polling) void reloadTable();
        wasActive.current = active;
    }, [active, polling, reloadTable]);

    const [query, setQuery] = useState("");
    const [sort, setSort] = useState<GridSort | null>(null);
    const [retryingRow, setRetryingRow] = useState<number | null>(null);
    const [retryingAll, setRetryingAll] = useState(false);
    const [confirmCancel, setConfirmCancel] = useState(false);

    const rows = useMemo(
        () => (table ? sortRows(filterRows(table.rows, query), table.fields, sort, locale) : []),
        [table, query, sort, locale]
    );

    if (res.errorStatus === 404 || res.errorStatus === 403) {
        return (
            <div className={`${SCREEN_PAD} pt-6`}>
                <ToolNotFound
                    home="/t"
                    homeLabel={tt("title")}
                    title={t("notFoundTitle")}
                    body={t("notFoundBody")}
                />
            </div>
        );
    }
    if (!table) {
        return (
            <div className={`${SCREEN_PAD} flex flex-col gap-6 pt-6`}>
                {res.error ? (
                    <InlineError message={res.error} onRetry={() => void res.reload()} />
                ) : (
                    <>
                        <SkeletonBlock lines={2} className="max-w-[520px]" />
                        <SkeletonRows rows={8} height={36} />
                    </>
                )}
            </div>
        );
    }

    const accept = (next: ExtractionTableView) => {
        res.mutate(() => ({ table: next }));
        void reloadList();
    };

    const rerun = async (rowIds?: number[]) => {
        if (rowIds) setRetryingRow(rowIds[0] ?? null);
        else setRetryingAll(true);
        try {
            const { table: next } = await extractApi.rerun(table.id, rowIds);
            accept(next);
        } catch (e) {
            toast.error(errorText(e, t("retryFailed")));
        } finally {
            setRetryingRow(null);
            setRetryingAll(false);
        }
    };

    const cancel = async () => {
        try {
            const { table: next } = await extractApi.cancel(table.id);
            accept(next);
        } catch (e) {
            toast.error(errorText(e, t("cancelFailed")));
        }
    };

    const failed = table.counts.failed;
    /** Rows a stopped run never reached; a rerun reads them along with the failed ones. */
    const unread = live ? 0 : table.counts.pending + table.counts.running;
    const filtered = query.trim() !== "";

    return (
        <div className="flex h-full min-h-[520px] flex-col">
            <div className={`${SCREEN_PAD} @max-md:pt-4 flex shrink-0 flex-col gap-3 pb-3 pt-6`}>
                <TableHeaderBar
                    table={table}
                    onChanged={accept}
                    onDeleted={() => {
                        void reloadList();
                        navigate("/t", { replace: true });
                    }}
                    actions={
                        <>
                            {table.canManage && failed + unread > 0 && !live && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={retryingAll || retryingRow !== null}
                                    onClick={() => void rerun()}
                                >
                                    {retryingAll ? <Spinner /> : <RotateCw />}
                                    {unread > 0
                                        ? t("readRemaining", { count: failed + unread })
                                        : t("retryFailedRows", { count: failed })}
                                </Button>
                            )}
                            {table.canManage && live && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setConfirmCancel(true)}
                                >
                                    <Square />
                                    {t("cancelRun")}
                                </Button>
                            )}
                            <Button asChild variant="outline" size="sm">
                                <ToolLink
                                    href={askHref(
                                        t("askPrompt", { title: table.title, id: table.id })
                                    )}
                                >
                                    <MessageSquareText />
                                    {t("ask")}
                                </ToolLink>
                            </Button>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button type="button" variant="outline" size="sm">
                                        <Download />
                                        {t("export")}
                                        <ChevronDown className="text-ink-3 size-3.5" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="min-w-[200px]">
                                    <DropdownMenuItem asChild>
                                        <a href={extractApi.exportHref(table.id, "csv")} download>
                                            {t("exportCsv")}
                                        </a>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem asChild>
                                        <a href={extractApi.exportHref(table.id, "xlsx")} download>
                                            {t("exportXlsx")}
                                        </a>
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </>
                    }
                />

                {res.error && (
                    <InlineError
                        message={t("refreshError", { error: res.error })}
                        onRetry={() => void res.reload()}
                    />
                )}
                {table.status === "failed" && (
                    <div
                        role="alert"
                        className="border-danger/40 bg-danger-soft rounded-lg border px-4 py-2.5"
                    >
                        <div className="text-danger text-sm font-medium">{t("failedTitle")}</div>
                        {table.error && (
                            <p className="text-ink-2 mt-0.5 text-[13px]">{table.error}</p>
                        )}
                    </div>
                )}
                {table.status === "cancelled" && (
                    <p className="text-ink-2 text-[13px]">{t("cancelledNote")}</p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <div className="border-line bg-panel focus-within:border-brand focus-within:ring-brand/50 @max-sm:w-full flex w-[280px] items-center gap-2 rounded-md border px-2.5 focus-within:ring-[3px]">
                        <Search className="text-ink-3 size-3.5 shrink-0" aria-hidden />
                        <Input
                            type="search"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder={t("filterPlaceholder")}
                            aria-label={t("filterPlaceholder")}
                            className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 md:text-[13px] dark:bg-transparent"
                        />
                    </div>
                    <span className="text-ink-3 text-xs tabular-nums" aria-live="polite">
                        {filtered
                            ? t("showing", { shown: rows.length, total: table.rows.length })
                            : t("hint")}
                    </span>
                </div>
            </div>

            <div className={`${SCREEN_PAD} @max-md:pb-4 flex min-h-0 flex-1 flex-col pb-6`}>
                <ResultsGrid
                    table={table}
                    rows={rows}
                    sort={sort}
                    onSort={column => setSort(current => nextSort(current, column))}
                    onRetryRow={rowId => void rerun([rowId])}
                    retryingRow={retryingRow}
                    emptyMessage={filtered ? tg("noMatch") : tg("noRows")}
                />
            </div>

            <ConfirmDialog
                open={confirmCancel}
                onOpenChange={setConfirmCancel}
                title={t("cancelTitle")}
                description={t("cancelBody")}
                confirmLabel={t("cancelConfirm")}
                cancelLabel={t("cancelKeep")}
                onConfirm={() => void cancel()}
            />
        </div>
    );
}

/** The title line: what the table is, where it stands, and everything that can be done with it. */
function TableHeaderBar({
    table,
    actions,
    onChanged,
    onDeleted,
}: {
    table: ExtractionTableView;
    actions: React.ReactNode;
    onChanged: (table: ExtractionTableView) => void;
    onDeleted: () => void;
}) {
    const t = useTranslations("extract.table");
    const tl = useTranslations("extract.list");
    const tw = useTranslations("extract.words");
    const format = useFormatter();
    const now = useNow();
    const when = format.relativeTime(new Date(table.createdAt), now);
    const live = isLive(table.status);
    const { finished, total, percent } = progressOf(table.counts);
    return (
        <header className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                        <h1 className="display text-ink @max-md:text-[20px] truncate text-[22px] leading-[1.2] tracking-[-0.02em]">
                            {table.title}
                        </h1>
                        {table.shared && (
                            <Badge variant="secondary" className="shrink-0">
                                {tl("shared")}
                            </Badge>
                        )}
                    </div>
                    <p className="text-ink-3 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums">
                        <StatusPill table={table} />
                        <span aria-hidden>·</span>
                        <span>
                            {tw("size", {
                                documents: table.counts.total,
                                fields: table.fieldCount,
                            })}
                        </span>
                        <span aria-hidden>·</span>
                        <span>
                            {table.mine || !table.createdByName
                                ? when
                                : tl("byWhen", { name: table.createdByName, when })}
                        </span>
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {actions}
                    {table.canManage && (
                        <TableMenu
                            table={table}
                            onChanged={onChanged}
                            onDeleted={onDeleted}
                            className="border-line border"
                        />
                    )}
                </div>
            </div>
            {live && (
                <div className="flex items-center gap-3">
                    <Progress
                        value={percent}
                        className="h-1.5 max-w-[320px]"
                        aria-label={tw("progressAria", { title: table.title })}
                    />
                    <span className="text-ink-2 shrink-0 text-xs tabular-nums">
                        {t("progress", { finished, total })}
                    </span>
                </div>
            )}
        </header>
    );
}
