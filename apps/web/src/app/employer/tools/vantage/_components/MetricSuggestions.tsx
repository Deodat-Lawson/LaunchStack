"use client";

import { X } from "lucide-react";

import { SectionHeading } from "~/components/tools/PageHeader";
import { Button } from "~/components/ui/button";

import { vantageApi, type MetricObservationDto, type WeeklySignals } from "../api";
import { setAside, SET_ASIDE_DAYS, type Outcome } from "../_lib/actions";
import { fmtDate, fmtNumber } from "../_lib/format";
import { SuggestionCard, SuggestionNudge } from "./Suggestion";

type Conflict = WeeklySignals["metricConflicts"][number];

const conflictId = (c: Conflict) => `conflict:${c.a.observationId}:${c.b.observationId}`;

/**
 * Keep one of two disagreeing numbers: the other is removed, and Undo
 * records it again exactly as it was (value, period, source, note).
 */
async function keepOne(
    keep: Conflict["a"],
    drop: Conflict["b"],
    metricId: string,
    name: string,
    observations: MetricObservationDto[]
): Promise<Outcome> {
    const dropped = observations.find(o => o.id === drop.observationId);
    await vantageApi.deleteObservation(drop.observationId);
    return {
        message: `Kept ${fmtNumber(keep.value)} for ${name}`,
        description: `Removed ${fmtNumber(drop.value)} (${drop.source ?? "no source"})`,
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
    const show = (id: string) => !gone.has(id) && !hidden.has(id);
    const conflicts = signals.metricConflicts.filter(c => show(conflictId(c)));
    const missing = signals.metricsWithoutData
        .map(m => ({ ...m, id: `numbers:${week}:${m.metricId}` }))
        .filter(m => show(m.id));
    if (conflicts.length === 0 && missing.length === 0) return null;
    return (
        <section aria-label="Suggested by Vantage">
            <SectionHeading
                title="Suggested by Vantage"
                aside={`${conflicts.length + missing.length} to settle`}
            />
            <div className="flex flex-col gap-2.5">
                {conflicts.map(c => {
                    const id = conflictId(c);
                    const src = (s: string | null) => s ?? "no source";
                    return (
                        <SuggestionCard
                            key={id}
                            label={`${c.name}: two numbers disagree`}
                            kicker="Two numbers disagree"
                            meta={`${fmtDate(c.a.periodStart)}–${fmtDate(c.a.periodEnd)}`}
                            title={
                                <>
                                    {c.name}:{" "}
                                    <span className="font-mono tabular-nums">
                                        {fmtNumber(c.a.value)}
                                    </span>{" "}
                                    from {src(c.a.source)}, or{" "}
                                    <span className="font-mono tabular-nums">
                                        {fmtNumber(c.b.value)}
                                    </span>{" "}
                                    from {src(c.b.source)}?
                                </>
                            }
                            reason="Every draft that cites this metric depends on which one counts. Keep one and the other is removed — Undo puts it back."
                            actions={
                                <>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() =>
                                            void act(id, () =>
                                                keepOne(c.a, c.b, c.metricId, c.name, observations)
                                            )
                                        }
                                    >
                                        Keep {fmtNumber(c.a.value)} · {src(c.a.source)}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() =>
                                            void act(id, () =>
                                                keepOne(c.b, c.a, c.metricId, c.name, observations)
                                            )
                                        }
                                    >
                                        Keep {fmtNumber(c.b.value)} · {src(c.b.source)}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() =>
                                            void act(id, () =>
                                                setAside(
                                                    id,
                                                    SET_ASIDE_DAYS.conflict,
                                                    "Ignored — both numbers stay"
                                                )
                                            )
                                        }
                                    >
                                        <X aria-hidden="true" />
                                        Ignore
                                    </Button>
                                </>
                            }
                        />
                    );
                })}
                {missing.map(m => (
                    <SuggestionNudge
                        key={m.id}
                        label={`Record ${m.name}`}
                        title={<>No number yet this week for {m.name}.</>}
                        actions={
                            <>
                                <Button size="sm" onClick={() => onRecord(m.metricId)}>
                                    Record it
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                        void act(m.id, () =>
                                            setAside(
                                                m.id,
                                                SET_ASIDE_DAYS.nudge,
                                                "Hidden for the rest of the week"
                                            )
                                        )
                                    }
                                >
                                    <X aria-hidden="true" />
                                    Ignore
                                </Button>
                            </>
                        }
                    />
                ))}
            </div>
        </section>
    );
}
