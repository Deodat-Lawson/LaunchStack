"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Skeleton } from "~/components/ui/skeleton";

import { NewSegmentDialog } from "../prospects/_components/NewSegmentDialog";
import { useProspects } from "../prospects/_lib/context";

/**
 * The segment every Prospects screen is about, at the head of the
 * Prospects group in the rail (and under the folded screen menu when the
 * tab is narrow). Switching it re-scopes every screen in place.
 */
export function SegmentSwitcher() {
    const { segments, segment, segmentId, setSegmentId, segmentsLoading } = useProspects();
    const [creating, setCreating] = useState(false);
    if (segmentsLoading && !segment) {
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
                <Button
                    type="button"
                    variant="outline"
                    className="border-line bg-panel hover:bg-panel-2 hover:text-ink h-auto w-full justify-start gap-2 rounded-lg px-2.5 py-2 text-left font-normal"
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
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[248px] p-1.5">
                <div className="text-ink-3 px-2 pb-1 pt-1 text-[11.5px]">Segments</div>
                {segments.map(s => (
                    <Button
                        key={s.id}
                        type="button"
                        variant="ghost"
                        onClick={() => setSegmentId(s.id)}
                        className="hover:bg-panel-2 hover:text-ink h-auto w-full justify-start gap-2 px-2 py-1.5 text-left font-normal"
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
                        className="text-brand-ink hover:bg-panel-2 hover:text-brand-ink h-auto w-full justify-start px-2 py-1.5 text-left text-[13px] font-normal"
                    >
                        New segment
                    </Button>
                </div>
            </PopoverContent>
            <NewSegmentDialog open={creating} onOpenChange={setCreating} />
        </Popover>
    );
}
