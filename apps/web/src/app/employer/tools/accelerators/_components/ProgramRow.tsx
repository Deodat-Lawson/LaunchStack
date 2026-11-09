"use client";

import { CalendarClock, Check, ChevronRight } from "lucide-react";
import Image from "next/image";
import { useFormatter, useTranslations } from "next-intl";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { Badge } from "~/components/ui/badge";

import type { ProgramView, TrackerOpportunity } from "../api";
import { summarizeFit, type DemoLayer } from "../_lib/demo";
import { daysBetween } from "../_lib/vision-filters";
import { FitStatus, ScoreRing } from "./ProgramFacts";

/** One Program in the list: who, where and for which stage, a score or tracker tick, and only urgent dates. */
export function ProgramRow({
    view,
    demo,
    tracked,
    deadline,
    today,
    href,
}: {
    view: ProgramView;
    demo: DemoLayer;
    tracked: TrackerOpportunity | undefined;
    deadline: string | null;
    today: string;
    href: string;
}) {
    const t = useTranslations("accelerators");
    const format = useFormatter();
    const program = view.program;
    const details = demo.details[program.id];
    const fit = demo.fits[program.id];
    const stages = details?.stages.map(stage => t(`details.stages.${stage}`)) ?? [];
    const meta = [
        program.location?.text.split(/[;(]/)[0]?.trim(),
        stages.length > 0 ? stages.join(" – ") : null,
    ].filter(Boolean);
    const overall = fit ? summarizeFit(fit).overall : null;
    return (
        <ToolLink
            href={href}
            aria-label={program.name}
            className="border-line bg-panel hover:border-brand/40 hover:bg-panel-2 focus-visible:ring-brand/50 group flex min-w-0 items-center gap-4 rounded-xl border px-4 py-3 outline-none transition-colors focus-visible:ring-2"
        >
            <Image
                src={program.logo.path}
                alt=""
                width={44}
                height={44}
                className="size-11 shrink-0 rounded-lg bg-[var(--paper-panel)] object-contain p-1"
            />
            <div className="min-w-0 flex-1 space-y-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="text-ink group-hover:text-brand truncate text-sm font-semibold">
                        {program.name}
                    </h2>
                    {fit?.eligibility === "ineligible" && (
                        <Badge variant="danger">{t("dimensions.eligibility.ineligible")}</Badge>
                    )}
                </div>
                {meta.length > 0 && (
                    <p className="text-ink-3 truncate text-xs">{meta.join(" · ")}</p>
                )}
            </div>
            {deadline && (
                <div className="hidden shrink-0 text-right [@container(min-width:600px)]:block">
                    <p className="text-ink flex items-center justify-end gap-1 text-xs font-medium">
                        <CalendarClock className="text-ink-3 size-3.5" />
                        {format.dateTime(new Date(`${deadline}T00:00:00Z`), {
                            month: "short",
                            day: "numeric",
                            timeZone: "UTC",
                        })}
                    </p>
                    <p className="text-ink-3 text-xs">
                        {t("details.inDays", { days: daysBetween(today, deadline) })}
                    </p>
                </div>
            )}
            <div className="flex shrink-0 flex-col items-center gap-0.5">
                {tracked ? (
                    <div
                        role="img"
                        aria-label={t(`tracker.statuses.${tracked.status}`)}
                        className="bg-success text-brand-fg flex size-12 shrink-0 items-center justify-center rounded-full"
                    >
                        <Check aria-hidden="true" className="size-5" strokeWidth={3} />
                    </div>
                ) : fit ? (
                    <ScoreRing
                        score={overall}
                        label={
                            overall === null
                                ? t("dimensions.insufficient")
                                : t("dimensions.overall", { score: overall })
                        }
                    />
                ) : (
                    <FitStatus view={view} ring />
                )}
                <span aria-hidden={tracked ? true : undefined} className="text-ink-3 text-[10px]">
                    {tracked
                        ? t(`tracker.statuses.${tracked.status}`)
                        : view.fitStale && !fit
                          ? t("fit.stale")
                          : t("fit.short")}
                </span>
            </div>
            <ChevronRight
                aria-hidden="true"
                className="text-ink-3 hidden size-4 shrink-0 [@container(min-width:600px)]:block"
            />
        </ToolLink>
    );
}
