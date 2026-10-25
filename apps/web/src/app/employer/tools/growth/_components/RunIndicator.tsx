"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";

import { useCopyText } from "~/lib/tools/copyText";
import { runIsLive } from "../prospects/_components/RunSheet";
import { useProspects } from "../prospects/_lib/context";

/** The bar's one-line account of a run: which step is running, with its count. */
const RUNNING_VERB = ["sources", "shortlist", "profiles", "people"] as const;
type RunningVerb = (typeof RUNNING_VERB)[number];

function isRunningVerb(id: string): id is RunningVerb {
    return (RUNNING_VERB as readonly string[]).includes(id);
}

/**
 * A run in progress, as a short pill in the tool's bar. Closing the run sheet
 * leaves the run going; this is how you get back to it from any screen,
 * Brand's included. In a narrow tab it is just the spinner. Nothing shows
 * when no run is live.
 */
export function RunIndicator() {
    const t = useTranslations("growth.runIndicator");
    const { activeRun, openRunSheet } = useProspects();
    const word = useCopyText();
    if (!activeRun || !runIsLive(activeRun)) return null;
    const current = activeRun.steps.find(s => s.status === "running");
    // A step the bar has no verb for says the server's own label.
    const verb = current
        ? isRunningVerb(current.id)
            ? t(`verbs.${current.id}`)
            : word(current.labelCopy, current.label).toLowerCase()
        : null;
    const detail = current?.detail ? word(current.detailCopy, current.detail) : null;
    const doing = verb && detail ? t("doingDetail", { verb, detail }) : verb;
    const label = doing ? t("labelDoing", { doing }) : t("label");
    return (
        <Button
            type="button"
            variant="ghost"
            onClick={() => openRunSheet()}
            title={label}
            aria-label={t("open", { label })}
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
