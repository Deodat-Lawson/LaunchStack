"use client";

import { Sparkles } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId } from "react";

import { ToolLink } from "~/components/tool-app/ToolLink";

import type { ProgramView, TrackerOpportunity } from "../api";
import { hasRollingIntake, publishedValue, type ProgramDetailsMap } from "../_lib/details";
import { daysBetween } from "../_lib/vision-filters";
import { ProgramLogo, ScoreRing } from "./ProgramFacts";

/** The best current fits in the list as cards: who they are, when to apply, and the score. */
export function RecommendedPrograms({
    views,
    details,
    hrefFor,
    trackedFor,
    deadlineFor,
    today,
}: {
    views: readonly ProgramView[];
    details: ProgramDetailsMap;
    hrefFor: (programId: string) => string;
    trackedFor: (programId: string) => TrackerOpportunity | undefined;
    deadlineFor: (view: ProgramView) => string | null;
    today: string;
}) {
    const t = useTranslations("accelerators");
    const headingId = useId();
    if (views.length === 0) return null;
    return (
        <section aria-labelledby={headingId} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2
                    id={headingId}
                    className="text-ink flex items-center gap-2 text-sm font-semibold"
                >
                    <Sparkles className="text-brand size-4" aria-hidden />
                    {t("recommended.title")}
                </h2>
                <p className="text-ink-3 text-xs">{t("recommended.hint")}</p>
            </div>
            <ul className="grid grid-cols-3 gap-3 [@container(max-width:719px)]:grid-cols-1">
                {views.map(view => (
                    <li key={view.program.id} className="min-w-0">
                        <RecommendedCard
                            view={view}
                            details={details}
                            href={hrefFor(view.program.id)}
                            tracked={trackedFor(view.program.id)}
                            deadline={deadlineFor(view)}
                            today={today}
                        />
                    </li>
                ))}
            </ul>
        </section>
    );
}

function RecommendedCard({
    view,
    details,
    href,
    tracked,
    deadline,
    today,
}: {
    view: ProgramView;
    details: ProgramDetailsMap;
    href: string;
    tracked: TrackerOpportunity | undefined;
    deadline: string | null;
    today: string;
}) {
    const t = useTranslations("accelerators");
    const format = useFormatter();
    const program = view.program;
    const dossier = details[program.id];
    const score = view.fit?.overall.score ?? null;
    const stages = publishedValue(dossier?.audience.stages) ?? [];
    // One line: when to apply if that is known, otherwise who it is for.
    const meta = [
        deadline !== null
            ? t("recommended.closes", {
                  date: format.dateTime(new Date(`${deadline}T00:00:00Z`), {
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                  }),
                  days: daysBetween(today, deadline),
              })
            : hasRollingIntake(dossier)
              ? t("details.rolling")
              : stages.length > 0
                ? stages.join(" – ")
                : null,
        tracked ? t(`tracker.statuses.${tracked.status}`) : null,
    ].filter(Boolean);
    return (
        <ToolLink
            href={href}
            aria-label={program.name}
            className="border-line bg-panel hover:border-brand/40 hover:bg-panel-2 focus-visible:ring-brand/50 group flex h-full min-w-0 items-center gap-3 rounded-xl border p-3 outline-none transition-colors focus-visible:ring-2"
        >
            <ProgramLogo program={program} size="sm" />
            <div className="min-w-0 flex-1">
                <p className="text-ink group-hover:text-brand-ink truncate text-sm font-medium">
                    {program.name}
                </p>
                {meta.length > 0 && (
                    <p className="text-ink-3 truncate text-xs">{meta.join(" · ")}</p>
                )}
            </div>
            <ScoreRing score={score} label={t("fit.score", { score: score ?? 0 })} size="xs" />
        </ToolLink>
    );
}
