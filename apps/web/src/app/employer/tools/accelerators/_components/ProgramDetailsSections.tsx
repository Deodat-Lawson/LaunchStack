"use client";

import {
    CalendarClock,
    ChevronDown,
    ExternalLink,
    Library,
    Mail,
    MapPin,
    Phone,
    Repeat,
} from "lucide-react";
import Image from "next/image";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import MarkdownMessage from "~/app/_components/MarkdownMessage";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { cn } from "~/lib/utils";

import type { ProgramCycle, ProgramView, TrackerOpportunity } from "../api";
import type { ProgramDetails } from "../_lib/demo";
import { daysBetween } from "../_lib/vision-filters";
import { Narrative, Notice } from "./ProgramFacts";

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
    return (
        <div className="min-w-0 space-y-0.5">
            <dt className="text-ink-3 text-xs">{label}</dt>
            <dd className="text-ink text-sm font-semibold">{value}</dd>
            {hint && <dd className="text-ink-3 text-xs">{hint}</dd>}
        </div>
    );
}

function useDeadlineText() {
    const t = useTranslations("accelerators.details");
    const format = useFormatter();
    return (date: string, today: string) => ({
        date: format.dateTime(new Date(`${date}T00:00:00Z`), {
            dateStyle: "medium",
            timeZone: "UTC",
        }),
        relative: t("inDays", { days: daysBetween(today, date) }),
    });
}

/** Who the Program is, the four facts that decide whether to look further, and how to apply. */
export function ProgramHero({
    view,
    details,
    deadline,
    today,
    tracked,
    mobileScore,
}: {
    view: ProgramView;
    details: ProgramDetails | undefined;
    deadline: string | null;
    today: string;
    tracked: TrackerOpportunity | undefined;
    mobileScore: ReactNode;
}) {
    const t = useTranslations("accelerators");
    const format = useFormatter();
    const deadlineText = useDeadlineText();
    const program = view.program;
    const deal = details?.deal ?? null;
    const rolling =
        program.cycles.some(cycle => cycle.rolling) ||
        (details?.applyRoutes.includes("rolling_application") ?? false);
    const stages = details?.stages ?? [];
    return (
        <Card className="border-line gap-0 py-0">
            <CardContent className="space-y-5 p-5">
                <div className="flex flex-wrap items-start gap-4">
                    <Image
                        src={program.logo.path}
                        alt=""
                        width={64}
                        height={64}
                        className="size-16 shrink-0 rounded-xl bg-[var(--paper-panel)] object-contain p-1.5"
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <h1 className="display text-ink min-w-0 break-words text-2xl tracking-tight">
                                    {program.name}
                                </h1>
                                {details && details.operatingStatus !== "active" && (
                                    <Badge variant="secondary">
                                        {t(`details.operatingStatus.${details.operatingStatus}`)}
                                    </Badge>
                                )}
                                {tracked && (
                                    <Badge variant="info">
                                        {t(`tracker.statuses.${tracked.status}`)}
                                    </Badge>
                                )}
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-2">
                                <Button asChild variant="outline" size="sm">
                                    <a
                                        href={program.websiteUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        {t("common.website")}
                                        <ExternalLink className="size-3.5" />
                                    </a>
                                </Button>
                                <Button asChild size="sm">
                                    <a
                                        href={program.applyUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        {t("common.portal")}
                                        <ExternalLink className="size-3.5" />
                                    </a>
                                </Button>
                            </div>
                        </div>
                        {program.location && (
                            <p className="text-ink-3 flex items-start gap-1.5 text-sm">
                                <MapPin className="mt-0.5 size-3.5 shrink-0" />
                                <span className="min-w-0">{program.location.text}</span>
                            </p>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5">
                            {stages.length > 0 && (
                                <Badge variant="outline">
                                    {stages.map(stage => t(`details.stages.${stage}`)).join(" – ")}
                                </Badge>
                            )}
                            {details?.generalist && (
                                <Badge variant="secondary">{t("details.generalist")}</Badge>
                            )}
                            {details?.sectors.map(sector => (
                                <Badge key={sector} variant="secondary">
                                    {t(`details.sectors.${sector}`)}
                                </Badge>
                            ))}
                        </div>
                    </div>
                    <div className="[@container(min-width:860px)]:hidden">{mobileScore}</div>
                </div>

                <dl className="border-line grid grid-cols-2 gap-4 border-t pt-4 [@container(min-width:640px)]:grid-cols-4">
                    <Stat
                        label={t("details.cash")}
                        value={
                            deal?.cashUsd != null
                                ? format.number(deal.cashUsd, {
                                      style: "currency",
                                      currency: "USD",
                                      maximumFractionDigits: 0,
                                  })
                                : deal
                                  ? t("details.varies")
                                  : t("details.unknown")
                        }
                    />
                    <Stat
                        label={t("details.fixedEquity")}
                        value={
                            deal?.equityPercent === 0
                                ? t("details.equityFree")
                                : deal?.equityPercent != null
                                  ? t("details.percent", { value: deal.equityPercent })
                                  : t("details.unknown")
                        }
                    />
                    <Stat
                        label={t("details.nextDeadline")}
                        value={
                            deadline
                                ? deadlineText(deadline, today).date
                                : rolling
                                  ? t("details.rolling")
                                  : t("details.notAnnounced")
                        }
                        hint={deadline ? deadlineText(deadline, today).relative : undefined}
                    />
                    <Stat
                        label={t("details.selectivity")}
                        value={
                            details?.selectivity.acceptanceRatePercent != null
                                ? t("details.percent", {
                                      value: details.selectivity.acceptanceRatePercent,
                                  })
                                : t("details.unknown")
                        }
                    />
                </dl>
            </CardContent>
        </Card>
    );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="min-w-0 space-y-1">
            <dt className="text-ink-3 text-xs">{label}</dt>
            <dd className="text-ink-2 text-sm leading-relaxed">{children}</dd>
        </div>
    );
}

/** What the Program is and who it is for, with logistics and sources on the side. */
export function OverviewTab({
    view,
    details,
}: {
    view: ProgramView;
    details: ProgramDetails | undefined;
}) {
    const t = useTranslations("accelerators");
    const program = view.program;
    const sources = [
        ...(details?.sources ?? []),
        ...program.sources.map(({ title, url, checkedAt }) => ({ title, url, checkedAt })),
    ].filter((source, index, all) => all.findIndex(item => item.url === source.url) === index);
    return (
        <div className="space-y-6">
            <Narrative title={t("program.description")} narrative={program.description} />
            <Narrative title={t("program.targetApplicants")} narrative={program.targetApplicants} />
            {details && (
                <dl className="bg-panel-2 grid grid-cols-1 gap-4 rounded-xl p-4 [@container(min-width:560px)]:grid-cols-2">
                    <Fact label={t("details.format")}>
                        {details.format ?? t("details.unknown")}
                        {details.durationWeeks !== null && (
                            <span className="text-ink-3">
                                {" "}
                                · {t("details.weeks", { weeks: details.durationWeeks })}
                            </span>
                        )}
                    </Fact>
                    <Fact label={t("details.regions")}>
                        {details.regions.length === 0
                            ? t("details.unknown")
                            : details.regions
                                  .map(region => t(`details.regionNames.${region}`))
                                  .join(" · ")}
                    </Fact>
                    <Fact label={t("details.contact")}>
                        <ContactLinks details={details} />
                    </Fact>
                </dl>
            )}
            <Collapsible>
                <CollapsibleTrigger className="text-ink-3 hover:text-ink group flex items-center gap-1.5 text-xs font-medium">
                    <Library className="size-3.5" />
                    {t("details.sourcesCount", { count: sources.length })}
                    <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <SourceList sources={sources} />
                </CollapsibleContent>
            </Collapsible>
        </div>
    );
}

function SourceList({ sources }: { sources: { title: string; url: string; checkedAt: string }[] }) {
    const t = useTranslations("accelerators.details");
    const format = useFormatter();
    return (
        <ul className="mt-3 space-y-2">
            {sources.map(source => (
                <li key={source.url} className="text-xs">
                    <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-ink inline-flex items-center gap-1 underline underline-offset-2"
                    >
                        {source.title}
                        <ExternalLink className="size-3" />
                    </a>
                    <span className="text-ink-3 ml-2">
                        {t("checked", {
                            date: format.dateTime(new Date(source.checkedAt), {
                                dateStyle: "medium",
                            }),
                        })}
                    </span>
                </li>
            ))}
        </ul>
    );
}

function ContactLinks({ details }: { details: ProgramDetails }) {
    const t = useTranslations("accelerators.details");
    const { email, phone, contactUrl } = details.contact;
    if (!email && !phone && !contactUrl) return <>{t("noPublicContact")}</>;
    const link = "text-brand-ink inline-flex items-center gap-1 underline underline-offset-2";
    return (
        <span className="flex flex-col gap-1">
            {email && (
                <a href={`mailto:${email}`} className={link}>
                    <Mail className="size-3.5" />
                    {email}
                </a>
            )}
            {phone && (
                <a href={`tel:${phone.replace(/[^+\d]/g, "")}`} className={link}>
                    <Phone className="size-3.5" />
                    {phone}
                </a>
            )}
            {contactUrl && (
                <a href={contactUrl} target="_blank" rel="noopener noreferrer" className={link}>
                    {t("contactPage")}
                    <ExternalLink className="size-3.5" />
                </a>
            )}
        </span>
    );
}

/** The terms page as published, under a one-line headline; nothing is derived from it. */
export function DealTab({ details }: { details: ProgramDetails | undefined }) {
    const t = useTranslations("accelerators.details");
    const deal = details?.deal;
    if (!deal) return <Notice>{t("noDeal")}</Notice>;
    return (
        <div className="space-y-4">
            <div className="space-y-1">
                <p className="text-ink text-base font-semibold">{deal.summary}</p>
                {deal.instrument && (
                    <p className="text-ink-3 text-sm">
                        {t("instrumentIs", { instrument: deal.instrument })}
                    </p>
                )}
            </div>
            <p className="bg-panel-2 text-ink-3 rounded-lg px-3 py-2 text-xs leading-relaxed">
                {t("dealHint")}
            </p>
            <MarkdownMessage
                content={deal.terms}
                className="text-ink-2 [&_h2]:text-ink [&_h3]:text-ink space-y-2 text-sm [&_h2]:mt-4 [&_h2]:font-semibold [&_h3]:font-medium"
            />
        </div>
    );
}

/** When to apply and how: the recorded Cycles as a timeline, then cadence, odds and routes. */
export function ApplyingTab({
    view,
    details,
    today,
}: {
    view: ProgramView;
    details: ProgramDetails | undefined;
    today: string;
}) {
    const t = useTranslations("accelerators");
    const program = view.program;
    const next = details?.batches.next;
    return (
        <div className="space-y-6">
            {program.cycles.length > 0 ? (
                <ol className="space-y-2">
                    {program.cycles.map(cycle => (
                        <CycleItem key={cycle.id} cycle={cycle} today={today} />
                    ))}
                </ol>
            ) : next ? (
                <ol>
                    <CycleItem
                        today={today}
                        expected={next.deadlineKind === "expected"}
                        cycle={{
                            id: "announced",
                            label: next.label,
                            deadlineAt: null,
                            deadlineTimezone: null,
                            rolling: false,
                            sourceIds: [],
                            ...(next.deadline ? { dateOnly: next.deadline } : {}),
                        }}
                    />
                </ol>
            ) : (
                <Notice>{t("program.noCycles")}</Notice>
            )}
            {details && (
                <dl className="bg-panel-2 grid grid-cols-1 gap-4 rounded-xl p-4 [@container(min-width:560px)]:grid-cols-2">
                    <Fact label={t("details.cadence")}>
                        {details.batches.cadence ?? t("details.unknown")}
                    </Fact>
                    <Fact label={t("details.howToApply")}>
                        {details.applyRoutes.length === 0
                            ? t("details.unknown")
                            : details.applyRoutes
                                  .map(route => t(`details.applyRoutes.${route}`))
                                  .join(" · ")}
                    </Fact>
                    {details.selectivity.note && (
                        <Fact label={t("details.selectivity")}>{details.selectivity.note}</Fact>
                    )}
                </dl>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-ink-3 max-w-md text-xs leading-relaxed">
                    {t("program.portalNote")}
                </p>
                <Button asChild size="sm">
                    <a href={program.applyUrl} target="_blank" rel="noopener noreferrer">
                        {t("common.portal")}
                        <ExternalLink className="size-3.5" />
                    </a>
                </Button>
            </div>
        </div>
    );
}

function CycleItem({
    cycle,
    today,
    expected = false,
}: {
    cycle: ProgramCycle;
    today: string;
    expected?: boolean;
}) {
    const t = useTranslations("accelerators");
    const format = useFormatter();
    const iso = cycle.deadlineAt?.slice(0, 10) ?? cycle.dateOnly ?? null;
    const date = cycle.deadlineAt
        ? new Date(cycle.deadlineAt)
        : cycle.dateOnly
          ? new Date(`${cycle.dateOnly}T00:00:00Z`)
          : null;
    const days = iso ? daysBetween(today, iso) : null;
    let when = t("program.deadlineUnknown");
    if (cycle.deadlineAt && cycle.deadlineTimezone) {
        when = t("program.deadlineTimezone", {
            date: format.dateTime(new Date(cycle.deadlineAt), {
                dateStyle: "long",
                timeStyle: "short",
                timeZone: cycle.deadlineTimezone,
            }),
            timezone: cycle.deadlineTimezone,
        });
    } else if (cycle.dateOnly) {
        when = t("program.deadline", {
            date: format.dateTime(new Date(`${cycle.dateOnly}T00:00:00Z`), {
                dateStyle: "long",
                timeZone: "UTC",
            }),
        });
    } else if (cycle.rolling) when = t("program.rolling");
    const status =
        days === null ? null : days < 0 ? (
            <Badge variant="secondary">{t("details.closed")}</Badge>
        ) : (
            <Badge variant={days <= 30 ? "warn" : "secondary"}>
                {t("details.inDays", { days })}
            </Badge>
        );
    return (
        <li
            className={cn(
                "border-line flex items-center gap-4 rounded-xl border p-3",
                days !== null && days >= 0 && "border-brand/40 bg-brand-soft/20"
            )}
        >
            <div className="bg-panel-2 text-ink flex size-12 shrink-0 flex-col items-center justify-center rounded-lg">
                {date ? (
                    <>
                        <span className="text-ink-3 text-[10px] uppercase leading-none">
                            {format.dateTime(date, { month: "short", timeZone: "UTC" })}
                        </span>
                        <span className="text-lg font-semibold tabular-nums leading-tight">
                            {format.dateTime(date, { day: "numeric", timeZone: "UTC" })}
                        </span>
                    </>
                ) : cycle.rolling ? (
                    <Repeat className="text-ink-3 size-5" />
                ) : (
                    <CalendarClock className="text-ink-3 size-5" />
                )}
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-ink text-sm font-medium">{cycle.label}</p>
                <p className="text-ink-3 text-xs">
                    {when}
                    {expected && ` · ${t("details.deadlineKind.expected")}`}
                </p>
            </div>
            {status ?? (cycle.rolling && <Badge variant="info">{t("details.rolling")}</Badge>)}
        </li>
    );
}
