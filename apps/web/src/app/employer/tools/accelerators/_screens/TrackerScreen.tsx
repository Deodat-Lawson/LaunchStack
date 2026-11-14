"use client";

import {
    ArrowUpRight,
    CalendarClock,
    CircleCheck,
    ListChecks,
    Loader2,
    Search,
} from "lucide-react";
import Image from "next/image";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { Button } from "~/components/ui/button";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "~/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { useErrorText } from "~/lib/tools/errorText";
import { cn } from "~/lib/utils";

import type { ProgramView, TrackerOpportunity, TrackerPriority, TrackerStatus } from "../api";
import { Notice } from "../_components/ProgramFacts";
import { OpportunityEditor } from "../_components/TrackerControls";
import { useAccelerators } from "../_lib/context";
import { programPath } from "../_lib/screens";
import { useTracker } from "../_lib/tracker";
import { daysBetween, isPending, nextDeadline } from "../_lib/vision-filters";

/** The pipeline a founder moves through; final outcomes share one stage. */
const STAGES = ["all", "shortlisted", "preparing", "applied", "interviewing", "decided"] as const;
type Stage = (typeof STAGES)[number];
const DECIDED: TrackerStatus[] = ["accepted", "rejected", "withdrawn"];
const PRIORITY_RANK: Record<TrackerPriority, number> = { high: 0, medium: 1, low: 2 };
const UP_NEXT_LIMIT = 5;
/** One grid for the header and every row so the columns line up; collapses to two lines when narrow. */
const ROW_GRID =
    "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 [@container(min-width:720px)]:grid-cols-[2rem_minmax(0,1.4fr)_6rem_4.5rem_minmax(0,1fr)_5rem_4rem]";

function stageOf(status: TrackerStatus): Exclude<Stage, "all"> {
    return DECIDED.includes(status) ? "decided" : (status as Exclude<Stage, "all" | "decided">);
}

interface UpNextItem {
    key: string;
    date: string;
    title: string;
    opportunity: TrackerOpportunity;
    kind: "task" | "deadline";
}

/**
 * What to do next, then every tracked application by stage. Editing opens in
 * a side panel so the list stays readable. It records decisions; it never
 * submits anything.
 */
export function TrackerScreen() {
    const t = useTranslations("accelerators.tracker");
    const errorText = useErrorText();
    const { home } = useAccelerators();
    const { opportunities, error, reload } = useTracker();
    const [stage, setStage] = useState<Stage>("all");
    const [openId, setOpenId] = useState<string | null>(null);
    if (!home) return null;
    const today = new Date().toISOString().slice(0, 10);
    const programs = new Map(home.programs.map(view => [view.program.id, view]));
    const all = opportunities ?? [];
    const counts = Object.fromEntries(
        STAGES.map(value => [
            value,
            value === "all"
                ? all.length
                : all.filter(item => stageOf(item.status) === value).length,
        ])
    ) as Record<Stage, number>;
    const list = all
        .filter(item => stage === "all" || stageOf(item.status) === stage)
        .sort(
            (left, right) =>
                Number(DECIDED.includes(left.status)) - Number(DECIDED.includes(right.status)) ||
                PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] ||
                right.updatedAt.localeCompare(left.updatedAt)
        );
    /** The deadline this application plans against: its own Cycle when chosen, else the Program's next one. */
    const deadlineOf = (item: TrackerOpportunity) => {
        const planned = item.plannedDeadline?.slice(0, 10) ?? item.plannedDeadlineOn;
        if (planned) return planned;
        const view = programs.get(item.programId);
        if (!view) return null;
        if (item.cycleId) {
            const cycle = home.details[item.programId]?.batches.cycles.find(
                entry => entry.id === item.cycleId
            );
            const value = cycle?.announcedDeadline;
            if (value && ["available", "partial", "stale"].includes(value.state))
                return value.value?.at?.slice(0, 10) ?? value.value?.dateOnly ?? null;
            return null;
        }
        return nextDeadline(view.program, home.details, today);
    };
    const subtitleOf = (item: TrackerOpportunity) => {
        const view = programs.get(item.programId);
        const cycle = view?.program.cycles.find(entry => entry.id === item.cycleId);
        return [view?.program.name ?? item.programId, cycle?.label].filter(Boolean).join(" · ");
    };
    const tasksDue: UpNextItem[] = all.flatMap(item =>
        item.tasks.flatMap(task =>
            task.done || !task.dueOn
                ? []
                : [
                      {
                          key: task.id,
                          date: task.dueOn,
                          title: task.title,
                          opportunity: item,
                          kind: "task" as const,
                      },
                  ]
        )
    );
    const deadlinesDue: UpNextItem[] = all
        .filter(item => item.status === "shortlisted" || item.status === "preparing")
        .flatMap(item => {
            const date = deadlineOf(item);
            return date && date >= today
                ? [
                      {
                          key: `deadline-${item.id}`,
                          date,
                          title: t("deadlineItem"),
                          opportunity: item,
                          kind: "deadline" as const,
                      },
                  ]
                : [];
        });
    const upNext = [...tasksDue, ...deadlinesDue]
        .sort((left, right) => left.date.localeCompare(right.date))
        .slice(0, UP_NEXT_LIMIT);
    const open = all.find(item => item.id === openId) ?? null;
    const openView = open ? programs.get(open.programId) : undefined;

    return (
        <div className="min-w-0 space-y-6">
            <header className="flex flex-wrap items-end justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="display text-ink text-2xl tracking-tight">{t("title")}</h1>
                    <p className="text-ink-3 text-sm">
                        {t("summary", {
                            tracked: all.length,
                            pending: all.filter(isPending).length,
                        })}
                    </p>
                </div>
                <Button asChild variant="outline" size="sm">
                    <ToolLink href="/programs">
                        <Search />
                        {t("findPrograms")}
                    </ToolLink>
                </Button>
            </header>

            {opportunities === null ? (
                error ? (
                    <Notice danger>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <span>{errorText(error, t("loadFailed"))}</span>
                            <Button variant="outline" size="sm" onClick={() => void reload()}>
                                {t("retry")}
                            </Button>
                        </div>
                    </Notice>
                ) : (
                    <p role="status" className="text-ink-3 flex items-center gap-2 text-sm">
                        <Loader2 className="size-4 animate-spin" />
                        {t("loading")}
                    </p>
                )
            ) : all.length === 0 ? (
                <div className="border-line flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center">
                    <ListChecks className="text-ink-3 size-8" />
                    <div className="space-y-1">
                        <p className="text-ink text-sm font-medium">{t("emptyTitle")}</p>
                        <p className="text-ink-3 max-w-sm text-xs leading-relaxed">
                            {t("emptyBody")}
                        </p>
                    </div>
                    <Button asChild size="sm">
                        <ToolLink href="/programs">{t("findPrograms")}</ToolLink>
                    </Button>
                </div>
            ) : (
                <>
                    {upNext.length > 0 && (
                        <section aria-labelledby="up-next" className="space-y-2">
                            <h2 id="up-next" className="text-ink text-sm font-semibold">
                                {t("upNext")}
                            </h2>
                            <ul className="grid grid-cols-1 gap-2 [@container(min-width:640px)]:grid-cols-2">
                                {upNext.map(item => (
                                    <UpNextRow
                                        key={item.key}
                                        item={item}
                                        today={today}
                                        subtitle={subtitleOf(item.opportunity)}
                                        onOpen={() => setOpenId(item.opportunity.id)}
                                    />
                                ))}
                            </ul>
                        </section>
                    )}

                    <section aria-labelledby="pipeline" className="space-y-3">
                        <h2 id="pipeline" className="sr-only">
                            {t("pipeline")}
                        </h2>
                        <ToggleGroup
                            type="single"
                            variant="outline"
                            size="sm"
                            value={stage}
                            onValueChange={value => value && setStage(value as Stage)}
                            aria-label={t("pipeline")}
                            className="flex-wrap justify-start"
                        >
                            {STAGES.map(value => (
                                <ToggleGroupItem
                                    key={value}
                                    value={value}
                                    className="gap-1.5 px-3 text-xs"
                                >
                                    {t(`stages.${value}`)}
                                    <span className="text-ink-3 tabular-nums">{counts[value]}</span>
                                </ToggleGroupItem>
                            ))}
                        </ToggleGroup>
                        {list.length === 0 ? (
                            <p className="text-ink-3 py-6 text-center text-sm">{t("noMatch")}</p>
                        ) : (
                            <div className="border-line bg-panel overflow-hidden rounded-xl border">
                                <div
                                    aria-hidden="true"
                                    className={`${ROW_GRID} text-ink-3 border-line hidden border-b py-2 text-xs font-medium [@container(min-width:720px)]:grid`}
                                >
                                    <span />
                                    <span>{t("columns.accelerator")}</span>
                                    <span>{t("columns.status")}</span>
                                    <span>{t("columns.priority")}</span>
                                    <span>{t("columns.nextAction")}</span>
                                    <span>{t("columns.deadline")}</span>
                                    <span className="text-right">{t("columns.tasks")}</span>
                                </div>
                                <ul className="divide-line divide-y">
                                    {list.map(item => (
                                        <ApplicationRow
                                            key={item.id}
                                            opportunity={item}
                                            view={programs.get(item.programId)}
                                            deadline={deadlineOf(item)}
                                            today={today}
                                            onOpen={() => setOpenId(item.id)}
                                        />
                                    ))}
                                </ul>
                            </div>
                        )}
                    </section>
                </>
            )}

            <Sheet open={open !== null} onOpenChange={value => !value && setOpenId(null)}>
                <SheetContent className="w-full overflow-y-auto sm:max-w-md">
                    {open && (
                        <>
                            <SheetHeader className="border-line border-b">
                                <div className="flex items-center gap-3">
                                    {openView && (
                                        <Image
                                            src={openView.program.logo.path}
                                            alt=""
                                            width={36}
                                            height={36}
                                            className="size-9 rounded-lg bg-[var(--paper-panel)] object-contain p-1"
                                        />
                                    )}
                                    <div className="min-w-0">
                                        <SheetTitle className="truncate">
                                            {openView?.program.name ?? open.programId}
                                        </SheetTitle>
                                        <SheetDescription className="text-xs">
                                            {openView?.program.cycles.find(
                                                cycle => cycle.id === open.cycleId
                                            )?.label ?? t("noCycle")}
                                        </SheetDescription>
                                    </div>
                                </div>
                                <ToolLink
                                    href={programPath(open.programId)}
                                    className="text-brand-ink inline-flex items-center gap-1 text-xs underline underline-offset-2"
                                    onClick={() => setOpenId(null)}
                                >
                                    {t("viewProgram")}
                                    <ArrowUpRight className="size-3" />
                                </ToolLink>
                            </SheetHeader>
                            <div className="p-4">
                                <OpportunityEditor
                                    opportunity={open}
                                    cycles={openView?.program.cycles ?? []}
                                    canEdit={home.canEdit}
                                    detailsOpen
                                />
                            </div>
                        </>
                    )}
                </SheetContent>
            </Sheet>
        </div>
    );
}

function DueLabel({ date, today }: { date: string; today: string }) {
    const t = useTranslations("accelerators");
    const format = useFormatter();
    const days = daysBetween(today, date);
    return (
        <span
            className={cn("text-xs tabular-nums", days < 0 ? "text-ink font-medium" : "text-ink-3")}
        >
            {days < 0
                ? t("tracker.overdue")
                : days <= 7
                  ? t("details.inDays", { days })
                  : format.dateTime(new Date(`${date}T00:00:00Z`), {
                        month: "short",
                        day: "numeric",
                        timeZone: "UTC",
                    })}
        </span>
    );
}

function UpNextRow({
    item,
    today,
    subtitle,
    onOpen,
}: {
    item: UpNextItem;
    today: string;
    subtitle: string;
    onOpen: () => void;
}) {
    const Icon = item.kind === "task" ? CircleCheck : CalendarClock;
    return (
        <li>
            <button
                type="button"
                onClick={onOpen}
                className="border-line bg-panel hover:bg-panel-2 focus-visible:ring-brand/50 flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left outline-none focus-visible:ring-2"
            >
                <Icon className="text-ink-3 size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                    <span className="text-ink block truncate text-sm">{item.title}</span>
                    <span className="text-ink-3 block truncate text-xs">{subtitle}</span>
                </span>
                <DueLabel date={item.date} today={today} />
            </button>
        </li>
    );
}

function ApplicationRow({
    opportunity,
    view,
    deadline,
    today,
    onOpen,
}: {
    opportunity: TrackerOpportunity;
    view: ProgramView | undefined;
    deadline: string | null;
    today: string;
    onOpen: () => void;
}) {
    const t = useTranslations("accelerators.tracker");
    const cycle = view?.program.cycles.find(item => item.id === opportunity.cycleId);
    const done = opportunity.tasks.filter(task => task.done).length;
    return (
        <li>
            <button
                type="button"
                onClick={onOpen}
                className={`${ROW_GRID} hover:bg-panel-2 focus-visible:ring-brand/50 w-full py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset`}
            >
                {view ? (
                    <Image
                        src={view.program.logo.path}
                        alt=""
                        width={32}
                        height={32}
                        className="size-8 rounded-md bg-[var(--paper-panel)] object-contain p-0.5"
                    />
                ) : (
                    <span className="size-8" />
                )}
                <span className="min-w-0">
                    <span className="text-ink block truncate text-sm font-medium">
                        {view?.program.name ?? opportunity.programId}
                    </span>
                    <span className="text-ink-3 block truncate text-xs">
                        {cycle?.label ?? t("noCycle")}
                    </span>
                </span>
                <span className="text-ink-2 justify-self-end text-xs [@container(min-width:720px)]:justify-self-start">
                    {t(`statuses.${opportunity.status}`)}
                </span>
                <span className="text-ink-3 hidden text-xs [@container(min-width:720px)]:block">
                    {t(`priorities.${opportunity.priority}`)}
                </span>
                <span className="text-ink-2 col-span-2 col-start-2 truncate text-xs [@container(min-width:720px)]:col-span-1 [@container(min-width:720px)]:col-start-auto">
                    {opportunity.nextAction ?? (
                        <span className="text-ink-3">{t("noNextAction")}</span>
                    )}
                </span>
                <span className="hidden [@container(min-width:720px)]:block">
                    {deadline ? (
                        <DueLabel date={deadline} today={today} />
                    ) : (
                        <span className="text-ink-3 text-xs">—</span>
                    )}
                </span>
                <span className="text-ink-3 hidden text-right text-xs tabular-nums [@container(min-width:720px)]:block">
                    {opportunity.tasks.length > 0
                        ? t("taskProgress", { done, total: opportunity.tasks.length })
                        : "—"}
                </span>
            </button>
        </li>
    );
}
