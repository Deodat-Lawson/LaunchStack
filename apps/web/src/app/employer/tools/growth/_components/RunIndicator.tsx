"use client";

import { Loader2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { runIsLive } from "../prospects/_components/RunSheet";
import { useProspects } from "../prospects/_lib/context";

/** The bar's one-line account of a run: which step is running, with its count. */
const RUNNING_VERB: Record<string, string> = {
    sources: "searching sources",
    shortlist: "shortlisting",
    profiles: "profiling",
    people: "finding people",
};

/**
 * A run in progress. Closing the run sheet leaves the run going; this is how
 * you get back to it from any screen, Brand's included — `compact` is its
 * place in the tool's bar (a short pill, just the spinner in a narrow tab).
 * Nothing shows when no run is live.
 */
export function RunIndicator({ compact = false }: { compact?: boolean }) {
    const { activeRun, openRunSheet } = useProspects();
    if (!activeRun || !runIsLive(activeRun)) return null;
    const current = activeRun.steps.find(s => s.status === "running");
    const doing = current
        ? `${RUNNING_VERB[current.id] ?? current.label.toLowerCase()}${current.detail ? ` ${current.detail}` : ""}`
        : null;
    const label = `Finding companies${doing ? ` · ${doing}` : ""}`;
    return (
        <Button
            type="button"
            variant="ghost"
            onClick={() => openRunSheet()}
            title={label}
            aria-label={`${label}. Open the run`}
            className={cn(
                "bg-brand-soft text-brand-ink hover:bg-brand-soft/80 hover:text-brand-ink justify-start gap-2 text-left text-xs font-normal",
                compact ? "h-7 max-w-[200px] px-2.5" : "h-auto w-full px-2.5 py-2"
            )}
        >
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            <span
                className={cn(
                    "min-w-0 flex-1 truncate",
                    // A narrow tab keeps just the spinner, so the bar stays two rows.
                    compact && "[@container(max-width:719px)]:hidden"
                )}
            >
                {label}
            </span>
        </Button>
    );
}
