"use client";

import { useFormatter, useTranslations } from "next-intl";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { cn } from "~/lib/utils";

import type { ProgramView, TrackerOpportunity } from "../api";
import { publishedValue, type ProgramDetails } from "../_lib/details";
import { daysBetween, isConfirmedIneligible } from "../_lib/vision-filters";
import { ProgramLogo } from "./ProgramFacts";

/** One line per Program: who and for whom, then the saved fit as a number. */
export function ProgramRow({
    view,
    details,
    tracked,
    deadline,
    today,
    href,
}: {
    view: ProgramView;
    details: ProgramDetails | undefined;
    tracked: TrackerOpportunity | undefined;
    deadline: string | null;
    today: string;
    href: string;
}) {
    const t = useTranslations("accelerators");
    const format = useFormatter();
    const program = view.program;
    const stages = publishedValue(details?.audience.stages) ?? [];
    const meta = [
        publishedValue(details?.identity.location)?.split(/[;(]/)[0]?.trim(),
        stages.length > 0 ? stages.join(" – ") : null,
        deadline && daysBetween(today, deadline) >= 0
            ? t("details.closesOn", {
                  date: format.dateTime(new Date(`${deadline}T00:00:00Z`), {
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                  }),
              })
            : null,
        tracked ? t(`tracker.statuses.${tracked.status}`) : null,
    ].filter(Boolean);
    const score = view.fit?.overall.score ?? null;
    const stale = view.freshness.status === "out_of_date";
    const fitLabel =
        view.freshness.status === "not_assessed"
            ? t("fit.unmatched")
            : score === null
              ? t("fit.unknown")
              : stale
                ? `${t("fit.score", { score })} · ${t("fit.stale")}`
                : t("fit.score", { score });
    return (
        <ToolLink
            href={href}
            aria-label={program.name}
            className="hover:bg-panel-2 focus-visible:ring-brand/50 group flex min-w-0 items-center gap-3 rounded-lg px-2 py-2.5 outline-none transition-colors focus-visible:ring-2"
        >
            <ProgramLogo program={program} size="sm" />
            <div className="min-w-0 flex-1">
                <p className="text-ink group-hover:text-brand-ink truncate text-sm font-medium">
                    {program.name}
                    {isConfirmedIneligible(view) && (
                        <span className="text-danger ml-2 text-xs font-normal">
                            {t("dimensions.eligibility.ineligible")}
                        </span>
                    )}
                </p>
                {meta.length > 0 && (
                    <p className="text-ink-3 truncate text-xs">{meta.join(" · ")}</p>
                )}
            </div>
            <span
                role="img"
                aria-label={fitLabel}
                title={fitLabel}
                className={cn(
                    "w-8 shrink-0 text-right text-sm tabular-nums",
                    score === null || stale ? "text-ink-3" : "text-ink font-semibold"
                )}
            >
                {score === null ? "—" : format.number(score)}
            </span>
        </ToolLink>
    );
}
