"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Skeleton } from "~/components/ui/skeleton";

import { NewSegmentDialog } from "../prospects/_components/NewSegmentDialog";
import { useProspects } from "../prospects/_lib/context";

/**
 * The segment every Prospects screen is about. `compact` is its place in the
 * tool's bar (one line, the name only); the full card sits under the folded
 * screen menu on a phone. Switching it re-scopes every screen in place.
 */
export function SegmentSwitcher({ compact = false }: { compact?: boolean }) {
    const { segments, segment, segmentId, setSegmentId, segmentsLoading } = useProspects();
    const [creating, setCreating] = useState(false);
    if (segmentsLoading && !segment) {
        if (compact) return <Skeleton className="h-7 w-40 rounded-md" />;
        return (
            <div className="border-line bg-panel rounded-lg border px-2.5 py-2">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="mt-2 h-2.5 w-1/2" />
            </div>
        );
    }
    return (
        <Popover>
            <PopoverTrigger asChild>
                {compact ? (
                    <Button
                        type="button"
                        variant="outline"
                        title={segment?.subtitle}
                        // Narrower in a narrow tab, so it stays on the bar's
                        // first row beside Brand | Prospects.
                        className="border-line bg-surface hover:bg-panel-2 hover:text-ink dark:bg-surface dark:hover:bg-panel-2 h-7 max-w-[240px] gap-1.5 px-2 text-[12.5px] font-medium has-[>svg]:px-2 [@container(max-width:719px)]:max-w-[150px]"
                        aria-label={`Segment: ${segment?.name ?? "none"}. Switch segment`}
                    >
                        <span className="text-ink-3 font-normal [@container(max-width:719px)]:hidden">
                            Segment
                        </span>
                        <span className="text-ink min-w-0 truncate">{segment?.name ?? "None"}</span>
                        <ChevronsUpDown className="text-ink-3 size-3.5 shrink-0" />
                    </Button>
                ) : (
                    <Button
                        type="button"
                        variant="outline"
                        className="border-line bg-panel hover:bg-panel-2 hover:text-ink dark:bg-panel dark:hover:bg-panel-2 h-auto w-full justify-start gap-2 rounded-lg px-2.5 py-2 text-left font-normal has-[>svg]:px-2.5"
                        aria-label="Switch segment"
                    >
                        <span className="min-w-0 flex-1">
                            <span className="text-ink block truncate text-[13px] font-semibold">
                                {segment?.name ?? "No segment"}
                            </span>
                            <span className="text-ink-3 block truncate text-[11.5px]">
                                {segment?.subtitle ?? "Create one to start"}
                            </span>
                        </span>
                        <ChevronsUpDown className="text-ink-3 size-3.5 shrink-0" />
                    </Button>
                )}
            </PopoverTrigger>
            <PopoverContent align={compact ? "end" : "start"} className="w-[248px] p-1.5">
                <div className="text-ink-3 px-2 pb-1 pt-1 text-[11.5px]">Segments</div>
                {segments.map(s => (
                    <Button
                        key={s.id}
                        type="button"
                        variant="ghost"
                        onClick={() => setSegmentId(s.id)}
                        className="hover:bg-panel-2 hover:text-ink dark:hover:bg-panel-2 h-auto w-full justify-start gap-2 px-2 py-1.5 text-left font-normal has-[>svg]:px-2"
                    >
                        <span className="min-w-0 flex-1">
                            <span className="text-ink block truncate text-[13px] font-medium">
                                {s.name}
                            </span>
                            <span className="text-ink-3 block truncate text-[11.5px]">
                                {s.status === "draft" ? "Draft · confirm to search" : s.subtitle}
                            </span>
                        </span>
                        {s.id === segmentId && <Check className="text-brand size-3.5" />}
                    </Button>
                ))}
                <div className="border-line mt-1 border-t pt-1">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setCreating(true)}
                        className="text-brand-ink hover:bg-panel-2 hover:text-brand-ink dark:hover:bg-panel-2 h-auto w-full justify-start px-2 py-1.5 text-left text-[13px] font-normal"
                    >
                        New segment
                    </Button>
                </div>
            </PopoverContent>
            <NewSegmentDialog open={creating} onOpenChange={setCreating} />
        </Popover>
    );
}
