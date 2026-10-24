"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { SectionHeading } from "~/components/tools/PageHeader";
import { Button } from "~/components/ui/button";

import { vantageApi, type MetricObservationDto, type WeeklySignals } from "../api";
import { setAside, SET_ASIDE_DAYS, type Outcome } from "../_lib/actions";
import { useVantageFormat, type VantageFormat } from "../_lib/format";
import { SuggestionCard, SuggestionNudge } from "./Suggestion";

type Conflict = WeeklySignals["metricConflicts"][number];

const conflictId = (c: Conflict) => `conflict:${c.a.observationId}:${c.b.observationId}`;

/**
 * Keep one of two disagreeing numbers: the other is removed, and Undo
 * records it again exactly as it was (value, period, source, note).
 */
async function keepOne(
    fmt: VantageFormat,
    keep: Conflict["a"],
    drop: Conflict["b"],
    metricId: string,
    name: string,
    observations: MetricObservationDto[]
): Promise<Outcome> {
    const dropped = observations.find(o => o.id === drop.observationId);
    await vantageApi.deleteObservation(drop.observationId);
    return {
        message: fmt.t("metricSuggestions.kept", { value: fmt.number(keep.value), name }),
        description: fmt.t("metricSuggestions.removed", {
            value: fmt.number(drop.value),
            source: drop.source ?? fmt.t("metricSuggestions.noSource"),
        }),
        undo: () =>
            vantageApi.addObservation({
                metricId,
                value: drop.value,
                periodStart: drop.periodStart,
                periodEnd: drop.periodEnd,
                source: drop.source,
                note: dropped?.note ?? null,
            }),
    };
}

/**
 * What Vantage suggests about the numbers: settle two sources that
 * disagree, and record the metrics that have no number this week.
 */
export function MetricSuggestions({
    signals,
    week,
    observations,
    act,
    gone,
    hidden,
    onRecord,
}: {
    signals: WeeklySignals;
    /** The agenda week the signals were computed for; keys the "no number" nudges. */
    week: string;
    observations: MetricObservationDto[];
    act: (id: string, work: () => Promise<Outcome>) => Promise<void>;
    gone: ReadonlySet<string>;
    hidden: ReadonlySet<string>;
    onRecord: (metricId: string) => void;
}) {
    const t = useTranslations("vantage.metricSuggestions");
    const fmt = useVantageFormat();
    const show = (id: string) => !gone.has(id) && !hidden.has(id);
    const conflicts = signals.metricConflicts.filter(c => show(conflictId(c)));
    const missing = signals.metricsWithoutData
        .map(m => ({ ...m, id: `numbers:${week}:${m.metricId}` }))
        .filter(m => show(m.id));
    if (conflicts.length === 0 && missing.length === 0) return null;
    return (
        <section aria-label={t("title")}>
            <SectionHeading
                title={t("title")}
                aside={t("toSettle", { count: conflicts.length + missing.length })}
            />
            <div className="flex flex-col gap-2.5">
                {conflicts.map(c => {
                    const id = conflictId(c);
                    const src = (s: string | null) => s ?? t("noSource");
                    return (
                        <SuggestionCard
                            key={id}
                            label={t("conflictLabel", { name: c.name })}
                            kicker={t("conflictKicker")}
                            meta={t("period", {
                                start: fmt.date(c.a.periodStart),
                                end: fmt.date(c.a.periodEnd),
                            })}
                            title={t.rich("conflictTitle", {
                                name: c.name,
                                a: fmt.number(c.a.value),
                                sourceA: src(c.a.source),
                                b: fmt.number(c.b.value),
                                sourceB: src(c.b.source),
                                num: chunks => (
                                    <span className="font-mono tabular-nums">{chunks}</span>
                                ),
                            })}
                            reason={t("conflictReason")}
                            actions={
                                <>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() =>
                                            void act(id, () =>
                                                keepOne(
                                                    fmt,
                                                    c.a,
                                                    c.b,
                                                    c.metricId,
                                                    c.name,
                                                    observations
                                                )
                                            )
                                        }
                                    >
                                        {t("keep", {
                                            value: fmt.number(c.a.value),
                                            source: src(c.a.source),
                                        })}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() =>
                                            void act(id, () =>
                                                keepOne(
                                                    fmt,
                                                    c.b,
                                                    c.a,
                                                    c.metricId,
                                                    c.name,
                                                    observations
                                                )
                                            )
                                        }
                                    >
                                        {t("keep", {
                                            value: fmt.number(c.b.value),
                                            source: src(c.b.source),
                                        })}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() =>
                                            void act(id, () =>
                                                setAside(
                                                    id,
                                                    SET_ASIDE_DAYS.conflict,
                                                    t("ignoredBoth")
                                                )
                                            )
                                        }
                                    >
                                        <X aria-hidden="true" />
                                        {t("ignore")}
                                    </Button>
                                </>
                            }
                        />
                    );
                })}
                {missing.map(m => (
                    <SuggestionNudge
                        key={m.id}
                        label={t("recordLabel", { name: m.name })}
                        title={t("noNumber", { name: m.name })}
                        actions={
                            <>
                                <Button size="sm" onClick={() => onRecord(m.metricId)}>
                                    {t("recordIt")}
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                        void act(m.id, () =>
                                            setAside(m.id, SET_ASIDE_DAYS.nudge, t("hiddenWeek"))
                                        )
                                    }
                                >
                                    <X aria-hidden="true" />
                                    {t("ignore")}
                                </Button>
                            </>
                        }
                    />
                ))}
            </div>
        </section>
    );
}
