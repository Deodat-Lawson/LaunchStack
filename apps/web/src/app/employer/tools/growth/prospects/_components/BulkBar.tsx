"use client";

import { cn } from "~/lib/utils";

/**
 * Floats up from the bottom when something is selected. The only element on
 * the Companies screen with a shadow, because it is the only thing floating.
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
                "bg-panel border-line shadow-3 animate-in fade-in-0 slide-in-from-bottom-2 fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-lg border px-3 py-2 text-sm duration-200 motion-reduce:animate-none",
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
