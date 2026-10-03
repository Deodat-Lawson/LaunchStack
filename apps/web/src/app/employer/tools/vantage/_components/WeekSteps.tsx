import { Check } from "lucide-react";

import { cn } from "~/lib/utils";

import type { AgendaDto } from "../api";
import { plural } from "../_lib/format";

export interface WeekStep {
    label: string;
    detail: string;
    done: boolean;
}

/**
 * The week's four steps, from Vantage's draft to the promises that come
 * out of the meeting, read off the agenda: which are done, which is next.
 * Plain data so the rule is testable; `WeekSteps` draws it.
 */
export function weekSteps(agenda: AgendaDto): WeekStep[] {
    const live = agenda.topics.filter(t => t.status !== "dismissed");
    const waiting = live.filter(t => t.status === "suggested" && !t.decision).length;
    const kept = live.filter(t => t.status === "kept");
    const decided = kept.filter(t => t.decision).length;
    const past = agenda.status === "held" || agenda.status === "closed";
    return [
        {
            label: "Review Vantage's suggestions",
            detail: waiting > 0 ? `${plural(waiting, "suggestion")} waiting` : "all answered",
            done: waiting === 0,
        },
        {
            label: "Ready for the meeting",
            detail: plural(kept.length, "topic") + " on the agenda",
            done: agenda.status !== "draft",
        },
        {
            label: "Hold the meeting",
            detail: past ? "held" : "mark it held afterwards",
            done: past,
        },
        {
            label: "Commit to next steps",
            detail:
                kept.length > 0 ? `${decided} of ${kept.length} decided` : "nothing to decide yet",
            done: kept.length > 0 && decided === kept.length,
        },
    ];
}

export function WeekSteps({ agenda, className }: { agenda: AgendaDto; className?: string }) {
    const steps = weekSteps(agenda);
    const current = steps.findIndex(s => !s.done);
    return (
        <ol
            aria-label="This week's steps"
            className={cn(
                "@max-md:grid-cols-2 @max-sm:grid-cols-1 border-line bg-line grid grid-cols-4 gap-px overflow-hidden rounded-xl border",
                className
            )}
        >
            {steps.map((s, i) => (
                <li
                    key={s.label}
                    aria-current={i === current ? "step" : undefined}
                    className={cn(
                        "bg-panel flex items-start gap-2.5 px-3.5 py-3",
                        i === current && "from-brand-soft bg-gradient-to-b to-transparent"
                    )}
                >
                    <span
                        className={cn(
                            "mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] tabular-nums",
                            s.done
                                ? "bg-success-soft text-success"
                                : i === current
                                  ? "bg-brand text-brand-fg"
                                  : "border-line text-ink-3 border"
                        )}
                    >
                        {s.done ? <Check className="size-3" aria-hidden="true" /> : i + 1}
                    </span>
                    <span className="min-w-0">
                        <span
                            className={cn(
                                "block text-[12.5px] font-medium leading-snug",
                                s.done || i === current ? "text-ink" : "text-ink-2"
                            )}
                        >
                            {s.label}
                            <span className="sr-only">{s.done ? " (done)" : ""}</span>
                        </span>
                        <span className="text-ink-3 block text-[11.5px]">{s.detail}</span>
                    </span>
                </li>
            ))}
        </ol>
    );
}
