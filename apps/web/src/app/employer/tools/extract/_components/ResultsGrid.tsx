"use client";

import {
    ArrowDown,
    ArrowUp,
    ChevronsUpDown,
    ExternalLink,
    Lock,
    RotateCw,
    ScanEye,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { useToolActive } from "~/components/tool-app/nav";
import { Button } from "~/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "~/components/ui/popover";
import { Skeleton } from "~/components/ui/skeleton";
import { Spinner } from "~/components/ui/spinner";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import type {
    ExtractionCell,
    ExtractionField,
    ExtractionFieldType,
    ExtractionRowView,
    ExtractionTableView,
} from "~/lib/extraction/types";
import { cn } from "~/lib/utils";

import { isLive, listItems, listPreview, valueText, type GridSort } from "../_lib/cells";
import { sourceHref } from "../_lib/links";
import { TypeGlyph } from "./Bits";

/**
 * Column widths in pixels, by the kind of value. The table's layout is
 * fixed, so a long value is cut with an ellipsis instead of stretching its
 * column; when the tab is wider than the columns add up to, they share the
 * extra room in these proportions.
 */
const TYPE_PX: Record<ExtractionFieldType, number> = {
    text: 220,
    number: 140,
    date: 140,
    boolean: 110,
    list: 260,
};

/**
 * The document column's width, as a variable the grid sets: wide enough for
 * a file name, narrowed in a narrow tab so the values still show. The same
 * variable places a message that spans the value columns, which stays in
 * view beside the document column while the grid scrolls sideways.
 */
const DOC_WIDTH_VAR = "[--doc-w:260px] @max-md:[--doc-w:148px]";
const AFTER_DOC = "sticky left-[var(--doc-w)]";

const FOCUS =
    "focus-visible:ring-brand/60 outline-none focus-visible:ring-2 focus-visible:ring-inset";

/** List chips shown in a cell before "+n". */
const LIST_CHIPS = 2;

interface OpenCell {
    rowId: number;
    fieldId: string;
    anchor: HTMLElement;
}

/**
 * The table itself: a row per document, a column per field, read like a
 * spreadsheet. The header row and the document column stay put while the
 * rest scrolls in both directions — both are opaque surfaces (`bg-panel`,
 * `bg-panel-2`), so nothing shows through them. A found value is a button
 * that opens what it rests on: the full value, the quoted sentence, the page
 * and a link to the document.
 *
 * One popover serves every cell, anchored to whichever was pressed: a table
 * can be 500 × 30, and a popover per cell would be 15,000 of them.
 */
export function ResultsGrid({
    table,
    rows,
    sort,
    onSort,
    onRetryRow,
    retryingRow,
    emptyMessage,
}: {
    table: ExtractionTableView;
    /** The rows to show, already filtered and sorted. */
    rows: ExtractionRowView[];
    sort: GridSort | null;
    onSort: (column: string) => void;
    onRetryRow: (rowId: number) => void;
    retryingRow: number | null;
    /** Said in place of the rows when there are none to show. */
    emptyMessage: string;
}) {
    const t = useTranslations("extract.grid");
    const tw = useTranslations("extract.words");
    const tc = useTranslations("common.actions");
    const locale = useLocale();
    const [open, setOpen] = useState<OpenCell | null>(null);
    // The popover fades out after `open` clears; keep showing the cell it
    // was opened for until it has gone.
    const lastOpen = useRef<OpenCell | null>(null);
    if (open) lastOpen.current = open;
    const shown = open ?? lastOpen.current;
    const anchorRef = useRef<HTMLElement | null>(null);
    anchorRef.current = shown?.anchor ?? null;
    // Tabs are hidden, not unmounted: a popover left open would float over
    // whatever tab comes to the front (its own "Open source", for one).
    const active = useToolActive();
    useEffect(() => {
        if (!active) setOpen(null);
    }, [active]);
    const live = isLive(table.status);
    const words = useMemo(
        () => ({ yes: tw("yes"), no: tw("no"), listSeparator: tw("listSeparator") }),
        [tw]
    );

    const openRow = shown ? table.rows.find(r => r.id === shown.rowId) : undefined;
    const openField = shown ? table.fields.find(f => f.id === shown.fieldId) : undefined;
    const openCell = openRow && openField ? openRow.cells[openField.id] : undefined;

    const valueColumnsPx = table.fields.reduce((sum, field) => sum + TYPE_PX[field.type], 0);

    const sortIcon = (column: string) =>
        sort?.column !== column ? (
            <ChevronsUpDown aria-hidden className="text-ink-4 size-3 shrink-0" />
        ) : sort.direction === "asc" ? (
            <ArrowUp aria-hidden className="text-ink-2 size-3 shrink-0" />
        ) : (
            <ArrowDown aria-hidden className="text-ink-2 size-3 shrink-0" />
        );
    const ariaSort = (column: string) =>
        sort?.column !== column ? "none" : sort.direction === "asc" ? "ascending" : "descending";

    return (
        <div
            data-extract-grid
            className={cn(
                "border-line bg-panel flex min-h-0 flex-col overflow-hidden rounded-lg border [&>[data-slot=table-container]]:min-h-0 [&>[data-slot=table-container]]:overflow-auto",
                DOC_WIDTH_VAR
            )}
        >
            <Table
                className="min-w-full table-fixed border-separate border-spacing-0 text-[13px]"
                style={{ width: `calc(var(--doc-w) + ${valueColumnsPx}px)` }}
            >
                <colgroup>
                    <col className="w-[var(--doc-w)]" />
                    {table.fields.map(field => (
                        <col key={field.id} style={{ width: TYPE_PX[field.type] }} />
                    ))}
                </colgroup>
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        <TableHead
                            scope="col"
                            aria-sort={ariaSort("title")}
                            className="bg-panel-2 border-line sticky left-0 top-0 z-30 h-9 border-b border-r p-0"
                        >
                            <Button
                                variant="ghost"
                                type="button"
                                onClick={() => onSort("title")}
                                className={cn(
                                    "text-ink-2 hover:text-ink flex h-9 w-full items-center justify-start gap-1.5 rounded-none px-3 text-left text-xs font-semibold hover:bg-transparent",
                                    FOCUS
                                )}
                            >
                                <span className="truncate">{t("documentColumn")}</span>
                                {sortIcon("title")}
                            </Button>
                        </TableHead>
                        {table.fields.map(field => (
                            <TableHead
                                key={field.id}
                                scope="col"
                                aria-sort={ariaSort(field.id)}
                                className="bg-panel-2 border-line border-r-line-2 sticky top-0 z-20 h-9 border-b border-r p-0 last:border-r-0"
                            >
                                <Button
                                    variant="ghost"
                                    type="button"
                                    onClick={() => onSort(field.id)}
                                    title={field.instruction}
                                    className={cn(
                                        "text-ink-2 hover:text-ink flex h-9 w-full items-center justify-start gap-1.5 rounded-none px-3 text-left text-xs font-semibold hover:bg-transparent",
                                        field.type === "number" && "justify-end",
                                        FOCUS
                                    )}
                                >
                                    <TypeGlyph type={field.type} />
                                    <span className="truncate">{field.name}</span>
                                    <span className="sr-only">{tw(`types.${field.type}`)}</span>
                                    {sortIcon(field.id)}
                                </Button>
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.length === 0 && (
                        <TableRow className="hover:bg-transparent">
                            <TableCell
                                colSpan={table.fields.length + 1}
                                className="text-ink-3 h-20 px-3 text-[13px]"
                            >
                                <span className="sticky left-3 inline-block">{emptyMessage}</span>
                            </TableCell>
                        </TableRow>
                    )}
                    {rows.map(row => {
                        const waiting = row.status === "pending" || row.status === "running";
                        const span = table.fields.length;
                        return (
                            <TableRow
                                key={row.id}
                                data-row-status={row.readable ? row.status : "withheld"}
                                className="group/row hover:bg-panel-2"
                            >
                                <TableHead
                                    scope="row"
                                    className="bg-panel group-hover/row:bg-panel-2 border-line border-b-line-2 sticky left-0 z-10 h-9 border-b border-r p-0 font-normal"
                                >
                                    <div className="flex h-9 items-center gap-2 px-3">
                                        {row.readable ? (
                                            <ToolLink
                                                href={sourceHref(row.sourceId)}
                                                title={row.title}
                                                className={cn(
                                                    "text-ink hover:text-brand-ink min-w-0 truncate rounded-sm text-[13px] font-medium underline-offset-2 hover:underline",
                                                    FOCUS
                                                )}
                                            >
                                                {row.title}
                                            </ToolLink>
                                        ) : (
                                            <span
                                                title={row.title}
                                                className="text-ink-3 min-w-0 truncate text-[13px]"
                                            >
                                                {row.title}
                                            </span>
                                        )}
                                        {live && row.status === "running" && (
                                            <Spinner className="text-ink-3 ml-auto size-3.5 shrink-0" />
                                        )}
                                    </div>
                                </TableHead>
                                {!row.readable ? (
                                    <SpanCell span={span}>
                                        <Lock aria-hidden className="size-3.5 shrink-0" />
                                        <span className="truncate">{t("withheld")}</span>
                                    </SpanCell>
                                ) : row.status === "failed" ? (
                                    <SpanCell span={span} tone="danger">
                                        <span className="truncate" title={row.error ?? undefined}>
                                            {row.error ?? t("rowFailed")}
                                        </span>
                                        {table.canManage && !live && (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="text-ink h-6 shrink-0 gap-1 px-2 text-xs"
                                                disabled={retryingRow !== null}
                                                aria-label={t("retryRowAria", { title: row.title })}
                                                onClick={() => onRetryRow(row.id)}
                                            >
                                                {retryingRow === row.id ? (
                                                    <Spinner className="size-3" />
                                                ) : (
                                                    <RotateCw className="size-3" />
                                                )}
                                                {tc("retry")}
                                            </Button>
                                        )}
                                    </SpanCell>
                                ) : waiting && !live ? (
                                    <SpanCell span={span}>
                                        <span className="truncate">{t("notRead")}</span>
                                    </SpanCell>
                                ) : (
                                    table.fields.map((field, index) => {
                                        const cell = row.cells[field.id];
                                        return (
                                            <TableCell
                                                key={field.id}
                                                className="border-line-2 h-9 border-b border-r p-0 last:border-r-0"
                                            >
                                                {!cell && waiting ? (
                                                    <div
                                                        className={cn(
                                                            "flex h-9 items-center px-3",
                                                            field.type === "number" && "justify-end"
                                                        )}
                                                    >
                                                        <Skeleton
                                                            className={cn(
                                                                "h-2.5",
                                                                index % 3 === 0
                                                                    ? "w-3/5"
                                                                    : index % 3 === 1
                                                                      ? "w-2/5"
                                                                      : "w-1/2"
                                                            )}
                                                        />
                                                    </div>
                                                ) : !cell || cell.status === "not_found" ? (
                                                    <div
                                                        className={cn(
                                                            "text-ink-3 flex h-9 items-center px-3",
                                                            field.type === "number" && "justify-end"
                                                        )}
                                                    >
                                                        {t("notFound")}
                                                    </div>
                                                ) : (
                                                    <Button
                                                        variant="ghost"
                                                        type="button"
                                                        aria-haspopup="dialog"
                                                        aria-expanded={
                                                            open?.rowId === row.id &&
                                                            open.fieldId === field.id
                                                        }
                                                        onClick={event =>
                                                            setOpen({
                                                                rowId: row.id,
                                                                fieldId: field.id,
                                                                anchor: event.currentTarget,
                                                            })
                                                        }
                                                        className={cn(
                                                            "text-ink hover:bg-brand-soft/60 aria-expanded:bg-brand-soft flex h-9 w-full items-center justify-start gap-1.5 rounded-none px-3 text-left font-normal",
                                                            field.type === "number" &&
                                                                "justify-end",
                                                            FOCUS
                                                        )}
                                                    >
                                                        <CellValue
                                                            cell={cell}
                                                            type={field.type}
                                                            locale={locale}
                                                            words={words}
                                                        />
                                                        {cell.via === "vision" && (
                                                            <span
                                                                title={t("readFromImage")}
                                                                className={cn(
                                                                    "text-ink-3 shrink-0",
                                                                    // Before a number, so the digits of a column stay aligned.
                                                                    field.type === "number" &&
                                                                        "order-first"
                                                                )}
                                                            >
                                                                <ScanEye
                                                                    aria-hidden
                                                                    className="size-3.5"
                                                                />
                                                                <span className="sr-only">
                                                                    {t("readFromImage")}
                                                                </span>
                                                            </span>
                                                        )}
                                                    </Button>
                                                )}
                                            </TableCell>
                                        );
                                    })
                                )}
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>

            <Popover open={open !== null} onOpenChange={next => !next && setOpen(null)}>
                <PopoverAnchor virtualRef={anchorRef} />
                {openRow && openField && openCell && (
                    <PopoverContent
                        align="start"
                        collisionPadding={12}
                        aria-label={t("cellAria", { field: openField.name, title: openRow.title })}
                        className="flex w-[360px] max-w-[calc(100vw-1.5rem)] flex-col gap-3 p-4"
                        onCloseAutoFocus={event => {
                            // The anchor is virtual, so put the focus back by hand.
                            event.preventDefault();
                            lastOpen.current?.anchor.focus({ preventScroll: true });
                        }}
                    >
                        <CellDetail
                            row={openRow}
                            field={openField}
                            cell={openCell}
                            locale={locale}
                            words={words}
                        />
                    </PopoverContent>
                )}
            </Popover>
        </div>
    );
}

/** One message across every value column of a row: withheld, failed, never read. */
function SpanCell({
    span,
    tone = "quiet",
    children,
}: {
    span: number;
    tone?: "quiet" | "danger";
    children: React.ReactNode;
}) {
    return (
        <TableCell colSpan={span} className="border-line-2 h-9 border-b p-0">
            <div
                className={cn(
                    "inline-flex h-9 max-w-[min(560px,calc(100cqw-var(--doc-w)-82px))] items-center gap-2 px-3 text-[13px]",
                    AFTER_DOC,
                    tone === "danger" ? "text-danger" : "text-ink-3"
                )}
            >
                {children}
            </div>
        </TableCell>
    );
}

type Words = { yes: string; no: string; listSeparator: string };

/** A found value, drawn for its type, on one line. */
function CellValue({
    cell,
    type,
    locale,
    words,
}: {
    cell: ExtractionCell;
    type: ExtractionFieldType;
    locale: string;
    words: Words;
}) {
    if (type === "list" || Array.isArray(cell.value)) {
        const { shown, more } = listPreview(listItems(cell.value), LIST_CHIPS);
        return (
            <span className="flex min-w-0 flex-1 items-center gap-1">
                {shown.map((item, i) => (
                    <span
                        key={`${i}-${item}`}
                        className="border-line bg-panel-2 text-ink-2 min-w-0 max-w-[96px] truncate rounded border px-1.5 text-xs leading-5"
                    >
                        {item}
                    </span>
                ))}
                {more > 0 && (
                    <span className="text-ink-3 shrink-0 text-xs tabular-nums">+{more}</span>
                )}
            </span>
        );
    }
    const text = valueText(cell.value, type, locale, words);
    return (
        <span
            className={cn(
                "min-w-0 truncate",
                type === "number" || type === "date" ? "tabular-nums" : "flex-1"
            )}
        >
            {text}
        </span>
    );
}

/** What a value rests on: all of it, the quoted sentence, the page, and the way to the document. */
function CellDetail({
    row,
    field,
    cell,
    locale,
    words,
}: {
    row: ExtractionRowView;
    field: ExtractionField;
    cell: ExtractionCell;
    locale: string;
    words: Words;
}) {
    const t = useTranslations("extract.grid");
    const items = field.type === "list" || Array.isArray(cell.value) ? listItems(cell.value) : null;
    return (
        <>
            <div className="flex min-w-0 flex-col gap-1">
                <div className="text-ink-3 flex min-w-0 items-center gap-1.5 text-xs">
                    <TypeGlyph type={field.type} />
                    <span className="truncate">{field.name}</span>
                </div>
                {items ? (
                    <ul className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                        {items.map((item, i) => (
                            <li
                                key={`${i}-${item}`}
                                className="border-line bg-panel-2 text-ink rounded border px-1.5 text-xs leading-5"
                            >
                                {item}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="text-ink max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm font-medium tabular-nums">
                        {valueText(cell.value, field.type, locale, words)}
                    </div>
                )}
            </div>
            {cell.quote && (
                <blockquote className="border-line text-ink-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words border-l-2 pl-3 text-[13px] leading-relaxed">
                    {t("quote", { quote: cell.quote })}
                </blockquote>
            )}
            {cell.via === "vision" && (
                <p className="text-ink-3 flex items-start gap-1.5 text-xs leading-snug">
                    <ScanEye aria-hidden className="mt-px size-3.5 shrink-0" />
                    {t("readFromImageNote")}
                </p>
            )}
            <div className="flex items-center justify-between gap-3">
                <span className="text-ink-3 min-w-0 truncate text-xs tabular-nums">
                    {cell.page !== null ? t("page", { page: cell.page }) : row.title}
                </span>
                <Button asChild variant="outline" size="sm" className="h-7 shrink-0 px-2.5 text-xs">
                    <ToolLink
                        href={sourceHref(
                            row.sourceId,
                            cell.via === "text" ? { quote: cell.quote, page: cell.page } : undefined
                        )}
                    >
                        <ExternalLink className="size-3.5" />
                        {t("openSource")}
                    </ToolLink>
                </Button>
            </div>
        </>
    );
}
