"use client";

import { Loader2 } from "lucide-react";

import { Button } from "~/components/ui/button";

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
 * A run in progress, as a short pill in the tool's bar. Closing the run sheet
 * leaves the run going; this is how you get back to it from any screen,
 * Brand's included. In a narrow tab it is just the spinner. Nothing shows
 * when no run is live.
 */
export function RunIndicator() {
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
            className="bg-brand-soft text-brand-ink hover:bg-brand-soft/80 hover:text-brand-ink h-7 max-w-[200px] justify-start gap-2 px-2.5 text-left text-xs font-normal"
        >
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            {/* Under 900px of tab width, just the spinner: the bar keeps its rows. */}
            <span className="min-w-0 flex-1 truncate [@container(max-width:899px)]:hidden">
                {label}
            </span>
        </Button>
    );
}
