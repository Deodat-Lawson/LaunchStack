"use client";

import { Checkbox } from "~/components/ui/checkbox";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import { cn } from "~/lib/utils";

import type { CompanyRow } from "../api";
import { relativeTime } from "~/lib/tools/format";
import { FitMeter } from "~/components/tools/FitMeter";
import { FoundViaChips } from "./SourceChip";
import { StagePill } from "./StagePill";

/**
 * The companies list: dense rows, a checkbox for bulk work, a focus ring for
 * the keyboard cursor. Opening a row is the parent's business (a side panel),
 * so a click anywhere but a control opens it.
 */
export function CompaniesTable({
    rows,
    selected,
    cursor,
    activeId,
    onToggle,
    onToggleAll,
    onOpen,
}: {
    rows: CompanyRow[];
    selected: Set<string>;
    cursor: number;
    /** The company open in the side panel, marked in the list. */
    activeId: string | null;
    onToggle: (id: string) => void;
    onToggleAll: (checked: boolean) => void;
    onOpen: (id: string) => void;
}) {
    const allChecked = rows.length > 0 && rows.every(c => selected.has(c.id));
    return (
        <div className="border-line bg-panel overflow-x-auto rounded-lg border">
            <Table className="text-[13px]">
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        <TableHead className="w-9 pl-3">
                            <Checkbox
                                aria-label="Select all"
                                checked={allChecked}
                                onCheckedChange={checked => onToggleAll(checked === true)}
                            />
                        </TableHead>
                        <TableHead className="text-ink-3 text-xs font-medium">Company</TableHead>
                        <TableHead className="text-ink-3 text-xs font-medium">Why them</TableHead>
                        <TableHead className="text-ink-3 w-[120px] text-xs font-medium">
                            Fit
                        </TableHead>
                        <TableHead className="text-ink-3 w-[150px] text-xs font-medium">
                            Stage
                        </TableHead>
                        <TableHead className="text-ink-3 w-[72px] text-right text-xs font-medium">
                            People
                        </TableHead>
                        <TableHead className="text-ink-3 w-[120px] text-xs font-medium">
                            Activity
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((c, i) => (
                        <TableRow
                            key={c.id}
                            data-row-index={i}
                            data-state={selected.has(c.id) ? "selected" : undefined}
                            aria-current={activeId === c.id ? "true" : undefined}
                            className={cn(
                                "cursor-pointer",
                                selected.has(c.id) && "bg-brand-soft/60 hover:bg-brand-soft/80",
                                activeId === c.id && "bg-panel-2",
                                i === cursor && "outline-brand outline outline-2 -outline-offset-2"
                            )}
                            onClick={e => {
                                if ((e.target as HTMLElement).closest("[data-no-open]")) return;
                                onOpen(c.id);
                            }}
                        >
                            <TableCell className="pl-3" data-no-open>
                                <Checkbox
                                    aria-label={`Select ${c.name}`}
                                    checked={selected.has(c.id)}
                                    onCheckedChange={() => onToggle(c.id)}
                                />
                            </TableCell>
                            <TableCell className="min-w-[220px] max-w-[300px] whitespace-normal">
                                <button
                                    type="button"
                                    className="text-ink focus-visible:ring-brand/50 block max-w-full truncate rounded-sm text-left font-medium outline-none hover:underline focus-visible:ring-2"
                                    onClick={e => {
                                        e.stopPropagation();
                                        onOpen(c.id);
                                    }}
                                >
                                    {c.name}
                                    {c.isNew && (
                                        <span className="bg-brand-soft text-brand-ink ml-2 rounded px-1.5 py-px align-middle text-[10.5px] font-medium">
                                            new
                                        </span>
                                    )}
                                </button>
                                <span
                                    className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1"
                                    data-no-open
                                >
                                    {c.domain && (
                                        <span className="text-ink-3 font-mono text-[11px]">
                                            {c.domain}
                                        </span>
                                    )}
                                    <FoundViaChips items={c.foundVia} max={2} />
                                </span>
                            </TableCell>
                            <TableCell className="text-ink-2 min-w-[240px] max-w-[380px] whitespace-normal">
                                <span className="line-clamp-2 leading-snug">{c.why}</span>
                                {c.excluded && c.excludedReason && (
                                    <span className="text-ink-3 mt-0.5 block text-xs">
                                        {c.excludedReason}
                                    </span>
                                )}
                            </TableCell>
                            <TableCell>
                                <FitMeter value={c.fit} threshold={c.fitThreshold} />
                            </TableCell>
                            <TableCell>
                                <StagePill stage={c.stage} staleDays={c.staleDays} />
                            </TableCell>
                            <TableCell className="text-ink-2 text-right tabular-nums">
                                {c.people}
                            </TableCell>
                            <TableCell className="text-ink-3 whitespace-normal text-xs">
                                {c.isNew ? "found in the last run" : relativeTime(c.lastActivityAt)}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
