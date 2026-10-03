"use client";

import { Loader2 } from "lucide-react";

import { Button } from "~/components/ui/button";

import { runIsLive } from "../prospects/_components/RunSheet";
import { useProspects } from "../prospects/_lib/context";

/** The rail's one-line account of a run: which step is running, with its count. */
const RUNNING_VERB: Record<string, string> = {
    sources: "searching sources",
    shortlist: "shortlisting",
    profiles: "profiling",
    people: "finding people",
};

/**
 * A run in progress, at the foot of the Prospects group. Closing the run
 * sheet leaves the run going; this is how you get back to it from any
 * screen. Nothing shows when no run is live.
 */
export function RunIndicator() {
    const { activeRun, openRunSheet } = useProspects();
    if (!activeRun || !runIsLive(activeRun)) return null;
    const current = activeRun.steps.find(s => s.status === "running");
    const doing = current
        ? `${RUNNING_VERB[current.id] ?? current.label.toLowerCase()}${current.detail ? ` ${current.detail}` : ""}`
        : null;
    return (
        <Button
            type="button"
            variant="ghost"
            onClick={() => openRunSheet()}
            className="bg-brand-soft text-brand-ink hover:bg-brand-soft/80 hover:text-brand-ink h-auto w-full justify-start gap-2 px-2.5 py-2 text-left text-xs font-normal"
        >
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            <span className="min-w-0 flex-1 truncate">
                Finding companies{doing ? ` · ${doing}` : ""}
            </span>
        </Button>
    );
}
