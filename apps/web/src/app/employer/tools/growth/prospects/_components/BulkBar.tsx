"use client";

import { cn } from "~/lib/utils";

/**
 * Floats up from the bottom when something is selected. The only element on
 * the Companies screen with a shadow, because it is the only thing floating.
 *
 * Sticky, not fixed: the screen sits in a tab whose content column is the
 * scroller, beside the tool's rail. Pinned to the foot of that column it
 * stays centred on the list, where `fixed` would centre it on the whole tab
 * and slide it under the rail in a narrow one. Render it as the last child
 * of the screen's column.
 */
export function BulkBar({
    count,
    children,
    onClear,
    className,
}: {
    count: number;
    children: React.ReactNode;
    onClear: () => void;
    className?: string;
}) {
    if (count === 0) return null;
    return (
        <div
            role="toolbar"
            aria-label={`${count} selected`}
            className={cn(
                "bg-panel border-line shadow-3 animate-in fade-in-0 slide-in-from-bottom-2 sticky bottom-5 z-30 flex max-w-full flex-wrap items-center gap-2 self-center rounded-lg border px-3 py-2 text-sm duration-200 motion-reduce:animate-none",
                className
            )}
        >
            <span className="text-ink mr-1 font-medium tabular-nums">{count} selected</span>
            {children}
            <button
                type="button"
                onClick={onClear}
                className="text-ink-2 hover:text-ink focus-visible:ring-brand/50 ml-1 rounded-md px-2 py-1 text-xs outline-none focus-visible:ring-[3px]"
            >
                Clear
            </button>
        </div>
    );
}
