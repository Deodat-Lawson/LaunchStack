"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Skeleton } from "~/components/ui/skeleton";

import { useProspects } from "../_lib/context";
import { NewSegmentDialog } from "./NewSegmentDialog";

/** Which segment the workspace is about. Every list and count below it follows. */
export function SegmentSwitcher() {
    const { segments, segment, segmentId, setSegmentId, segmentsLoading } = useProspects();
    const [creating, setCreating] = useState(false);
    if (segmentsLoading && !segment) return <Skeleton className="h-8 w-48 rounded-md" />;
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="border-line bg-panel hover:bg-panel-2 focus-visible:ring-brand/50 flex h-8 max-w-[260px] items-center gap-2 rounded-md border px-2.5 text-left outline-none transition-colors focus-visible:ring-[3px]"
                    aria-label="Switch segment"
                >
                    <span className="min-w-0 flex-1">
                        <span className="text-ink block truncate text-[13px] font-medium">
                            {segment?.name ?? "No segment"}
                        </span>
                    </span>
                    <ChevronsUpDown className="text-ink-3 size-3.5 shrink-0" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[260px] p-1.5">
                <div className="text-ink-3 px-2 pb-1 pt-1 text-[11.5px]">Segments</div>
                {segments.map(s => (
                    <button
                        key={s.id}
                        type="button"
                        onClick={() => setSegmentId(s.id)}
                        className="hover:bg-panel-2 focus-visible:ring-brand/50 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-[3px]"
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
                    </button>
                ))}
                {segments.length === 0 && (
                    <p className="text-ink-3 px-2 py-1.5 text-[12.5px]">
                        No segment yet. Create one to start.
                    </p>
                )}
                <div className="border-line mt-1 border-t pt-1">
                    <button
                        type="button"
                        onClick={() => setCreating(true)}
                        className="text-brand-ink hover:bg-panel-2 focus-visible:ring-brand/50 w-full rounded-md px-2 py-1.5 text-left text-[13px] outline-none focus-visible:ring-[3px]"
                    >
                        New segment
                    </button>
                </div>
            </PopoverContent>
            <NewSegmentDialog open={creating} onOpenChange={setCreating} />
        </Popover>
    );
}
