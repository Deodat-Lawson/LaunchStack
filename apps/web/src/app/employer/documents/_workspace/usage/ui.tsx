"use client";

/**
 * The pieces every Usage screen draws: the window and filter bar, a stat
 * tile with its change from the previous window, the tile grid, and the line
 * a screen shows when its numbers could not be loaded.
 */

import React, { useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarRange, Download, Minus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { USAGE_PRESETS, isoDay, parseUsageWindow, type UsagePreset } from "~/lib/usage/range";
import type { UsageWindow } from "~/lib/usage/types";
import { cn } from "~/lib/utils";

import { ErrorLine } from "../team/ui";
import { useUsageFilters } from "./data";
import { useUsageFormat } from "./format";

const EVERYONE = "everyone";
const CUSTOM = "custom";

/**
 * The window (7, 30, 90 days or a custom range), the group filter when the
 * screen has one, and Export. One row above the numbers, the same on every
 * screen of the tab.
 */
export function WindowBar({
    groups,
    onExport,
    exportDisabled = false,
}: {
    /** The workspace's groups; leave out on a screen the group filter doesn't apply to. */
    groups?: { id: number; name: string }[];
    onExport?: () => void;
    exportDisabled?: boolean;
}) {
    const t = useTranslations("usage.window");
    const format = useUsageFormat();
    const { choice, setChoice, groupId, setGroupId } = useUsageFilters();
    const [open, setOpen] = useState(false);
    const today = isoDay(new Date());
    const [from, setFrom] = useState(choice.kind === "custom" ? choice.from : "");
    const [to, setTo] = useState(choice.kind === "custom" ? choice.to : today);
    const valid = Boolean(from && to) && parseUsageWindow(new URLSearchParams({ from, to })).ok;

    const customLabel =
        choice.kind === "custom"
            ? t("range", { from: format.day(choice.from), to: format.day(choice.to) })
            : t("custom");

    return (
        <div className="flex flex-wrap items-center gap-2" data-testid="usage-window-bar">
            <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={choice.kind === "preset" ? String(choice.days) : CUSTOM}
                onValueChange={value => {
                    if (!value || value === CUSTOM) return;
                    setChoice({ kind: "preset", days: Number(value) as UsagePreset });
                }}
                aria-label={t("label")}
            >
                {USAGE_PRESETS.map(days => (
                    <ToggleGroupItem
                        key={days}
                        value={String(days)}
                        className="h-8 shrink-0 px-2.5 text-[12.5px]"
                        data-testid={`usage-window-${days}`}
                    >
                        {t("days", { days })}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant={choice.kind === "custom" ? "secondary" : "outline"}
                        size="sm"
                        className="h-8 gap-1.5 text-[12.5px]"
                        data-testid="usage-window-custom"
                    >
                        <CalendarRange className="size-3.5" />
                        {customLabel}
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72">
                    <form
                        className="flex flex-col gap-3"
                        onSubmit={event => {
                            event.preventDefault();
                            if (!valid) return;
                            setChoice({ kind: "custom", from, to });
                            setOpen(false);
                        }}
                    >
                        <div className="text-ink text-[13px] font-medium">{t("customTitle")}</div>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="flex flex-col gap-1">
                                <Label htmlFor="usage-from" className="text-[12px]">
                                    {t("from")}
                                </Label>
                                <Input
                                    id="usage-from"
                                    type="date"
                                    value={from}
                                    max={to || today}
                                    onChange={e => setFrom(e.target.value)}
                                    className="h-8 text-[12.5px]"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <Label htmlFor="usage-to" className="text-[12px]">
                                    {t("to")}
                                </Label>
                                <Input
                                    id="usage-to"
                                    type="date"
                                    value={to}
                                    min={from || undefined}
                                    max={today}
                                    onChange={e => setTo(e.target.value)}
                                    className="h-8 text-[12.5px]"
                                />
                            </div>
                        </div>
                        <p className="text-ink-3 m-0 text-[12px] leading-normal">
                            {t("customHint")}
                        </p>
                        <Button type="submit" size="sm" disabled={!valid}>
                            {t("apply")}
                        </Button>
                    </form>
                </PopoverContent>
            </Popover>
            {groups && groups.length > 0 && (
                <Select
                    value={groupId === null ? EVERYONE : String(groupId)}
                    onValueChange={value => setGroupId(value === EVERYONE ? null : Number(value))}
                >
                    <SelectTrigger
                        className="h-8 w-44 text-[12.5px]"
                        aria-label={t("groupLabel")}
                        data-testid="usage-group"
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={EVERYONE}>{t("everyone")}</SelectItem>
                        {groups.map(group => (
                            <SelectItem key={group.id} value={String(group.id)}>
                                {group.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            )}
            {onExport && (
                <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-[12.5px]"
                    onClick={onExport}
                    disabled={exportDisabled}
                    data-testid="usage-export"
                >
                    <Download className="size-3.5" />
                    {t("export")}
                </Button>
            )}
        </div>
    );
}

/** "Sep 28 – Oct 27", for a screen's subtitle. */
export function useWindowLabel(window: UsageWindow | undefined): string {
    const t = useTranslations("usage.window");
    const format = useUsageFormat();
    return window ? t("range", { from: format.day(window.from), to: format.day(window.to) }) : "";
}

/** Tiles in a row that folds by the tab's width. */
export function TileGrid({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "@max-xl:grid-cols-3 @max-md:grid-cols-2 grid grid-cols-6 gap-3",
                className
            )}
        >
            {children}
        </div>
    );
}

/**
 * One figure: what it is, the number, and under it either its change from
 * the previous window of the same length ("+12% · was 410") or a line of
 * context. A change is written in ink with an arrow, never in red or green:
 * more AI use is not good or bad by itself.
 */
export function StatTile({
    label,
    value,
    change,
    previous,
    previousDays,
    sub,
    testId,
}: {
    label: string;
    value: string;
    /** Percent change from the previous window; null when it went up from nothing. */
    change?: number | null;
    /** The previous window's figure, formatted like `value`. */
    previous?: string;
    previousDays?: number;
    sub?: React.ReactNode;
    testId?: string;
}) {
    const t = useTranslations("usage.change");
    const format = useUsageFormat();
    const compared = change !== undefined && previousDays !== undefined;
    const Arrow =
        change === undefined || change === 0
            ? Minus
            : change === null || change > 0
              ? ArrowUpRight
              : ArrowDownRight;
    return (
        <div
            className="border-line bg-panel flex min-w-0 flex-col rounded-lg border px-3.5 py-3"
            data-testid={testId}
        >
            <div className="text-ink-3 truncate text-[12px]">{label}</div>
            <div className="text-ink mt-1 truncate text-[24px] font-semibold tabular-nums leading-tight tracking-tight">
                {value}
            </div>
            {compared ? (
                <div
                    className="text-ink-3 mt-1 flex min-w-0 items-center gap-1 text-[11.5px]"
                    title={t("versus", { days: previousDays })}
                >
                    <Arrow className="text-ink-2 size-3 shrink-0" aria-hidden />
                    <span className="truncate tabular-nums">
                        {change === null
                            ? t("none")
                            : change === 0
                              ? t("flat", { previous: previous ?? "" })
                              : t("changed", {
                                    sign: change > 0 ? "+" : "−",
                                    percent: format.percent(Math.abs(change)),
                                    previous: previous ?? "",
                                })}
                    </span>
                    <span className="sr-only">{t("versus", { days: previousDays })}</span>
                </div>
            ) : sub ? (
                <div className="text-ink-3 mt-1 truncate text-[11.5px]">{sub}</div>
            ) : null}
        </div>
    );
}

/** The line a screen shows when its numbers could not be loaded. */
export function LoadFailed({ status, onRetry }: { status: number; onRetry: () => void }) {
    const t = useTranslations("usage.errors");
    return (
        <ErrorLine
            flush
            message={
                status === 403
                    ? t("forbidden")
                    : status === 0
                      ? t("offline")
                      : t("loadFailed", { status })
            }
            onRetry={onRetry}
        />
    );
}
