"use client";

import { ArrowDown, ArrowUp, CircleDot, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import type { ScenarioDetail, ScenarioPerson } from "~/lib/scenarios/types";
import { cn } from "~/lib/utils";
import { STANCE_BG, stanceLabel } from "~/lib/scenarios/words";

import { stanceAt } from "../_lib/room";
import { StanceKey } from "./Bits";
import { Portrait } from "./Portrait";

/**
 * Everyone by every round: one square per person per finished round, in the
 * stance's colour, sorted by where they ended. Who moved, when and how far
 * reads off a row; the round where an event landed or opinion turned is
 * marked in the header. A name opens the person.
 */
export function StanceGrid({
    run,
    people,
    onPerson,
}: {
    run: ScenarioDetail;
    people: ScenarioPerson[];
    onPerson: (personId: string) => void;
}) {
    const t = useTranslations("scenarios.people");
    const tw = useTranslations("scenarios.words");
    const tr = useTranslations("scenarios.room");
    const done = Math.min(run.roundStats.length, run.rounds);
    const rounds = Array.from({ length: done + 1 }, (_, r) => r);
    const markers = useMemo(() => {
        const m = new Map<number, "event" | "turn">();
        for (const p of run.report?.turningPoints ?? []) m.set(p.round, "turn");
        for (const i of run.injections) if (i.round !== null) m.set(i.round, "event");
        return m;
    }, [run.report, run.injections]);
    const rows = useMemo(
        () =>
            [...people].sort(
                (a, b) =>
                    stanceAt(b, done) - stanceAt(a, done) ||
                    stanceAt(b, done) - b.startStance - (stanceAt(a, done) - a.startStance) ||
                    a.name.localeCompare(b.name)
            ),
        [people, done]
    );

    return (
        <div className="flex flex-col gap-3">
            <div className="border-line bg-panel w-fit max-w-full overflow-x-auto rounded-xl border px-3 py-2">
                <table className="border-separate border-spacing-x-[3px] border-spacing-y-[3px] text-[13px]">
                    <caption className="sr-only">{t("gridLabel")}</caption>
                    <thead>
                        <tr>
                            <th
                                scope="col"
                                className="text-ink-3 px-1 pb-1 text-left text-xs font-medium"
                            >
                                {t("gridPerson")}
                            </th>
                            {rounds.map(r => {
                                const mark = markers.get(r);
                                return (
                                    <th
                                        key={r}
                                        scope="col"
                                        className={cn(
                                            "w-[30px] pb-1 text-center text-xs font-medium tabular-nums",
                                            mark === "event"
                                                ? "text-warn-ink"
                                                : mark === "turn"
                                                  ? "text-brand-ink"
                                                  : "text-ink-3"
                                        )}
                                    >
                                        <span
                                            className="flex h-3.5 items-center justify-center"
                                            aria-hidden
                                        >
                                            {mark === "event" ? (
                                                <Zap className="size-3" />
                                            ) : mark === "turn" ? (
                                                <CircleDot className="size-3" />
                                            ) : null}
                                        </span>
                                        {r === 0 ? (
                                            tr("start")
                                        ) : (
                                            <>
                                                <span className="sr-only">
                                                    {tr("round", { round: r })}
                                                </span>
                                                <span aria-hidden>{r}</span>
                                            </>
                                        )}
                                    </th>
                                );
                            })}
                            <th
                                scope="col"
                                className="text-ink-3 pb-1 pl-2 text-right text-xs font-medium"
                            >
                                {t("gridChange")}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(p => {
                            const change = stanceAt(p, done) - p.startStance;
                            return (
                                <tr key={p.id} className="group">
                                    <th scope="row" className="pr-2 text-left font-normal">
                                        <button
                                            type="button"
                                            onClick={() => onPerson(p.id)}
                                            className="hover:bg-panel-2 focus-visible:ring-brand/50 flex w-[220px] min-w-0 items-center gap-2.5 rounded-md px-1 py-0.5 text-left outline-none focus-visible:ring-2"
                                        >
                                            <Portrait handle={p.handle} size={26} />
                                            <span className="min-w-0 leading-tight">
                                                <span className="text-ink block truncate text-[13px] font-medium">
                                                    {p.name}
                                                </span>
                                                <span className="text-ink-3 block truncate text-xs">
                                                    {p.role}
                                                </span>
                                            </span>
                                        </button>
                                    </th>
                                    {rounds.map(r => {
                                        const s = stanceAt(p, r);
                                        return (
                                            <td key={r} className="p-0">
                                                <span
                                                    className={cn(
                                                        "group-hover:ring-ink-4/50 block h-7 w-[30px] rounded-[4px] group-hover:ring-1",
                                                        STANCE_BG[s]
                                                    )}
                                                    title={`${p.name}, ${r === 0 ? tr("atStart") : tr("afterRound", { round: r })}: ${stanceLabel(tw, s)}`}
                                                >
                                                    <span className="sr-only">
                                                        {stanceLabel(tw, s)}
                                                    </span>
                                                </span>
                                            </td>
                                        );
                                    })}
                                    <td
                                        className={cn(
                                            "whitespace-nowrap pl-2 text-right text-[12.5px] font-semibold tabular-nums",
                                            change > 0
                                                ? "text-info-ink"
                                                : change < 0
                                                  ? "text-danger-ink"
                                                  : "text-ink-3 font-medium"
                                        )}
                                    >
                                        <span className="inline-flex items-center gap-0.5">
                                            {change > 0 ? (
                                                <ArrowUp className="size-3.5" aria-hidden />
                                            ) : change < 0 ? (
                                                <ArrowDown className="size-3.5" aria-hidden />
                                            ) : null}
                                            {Math.abs(change)}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <StanceKey />
                <ul className="text-ink-2 flex gap-4 text-xs" aria-hidden>
                    <li className="inline-flex items-center gap-1.5">
                        <CircleDot className="text-brand-ink size-3" />
                        {tr("turningPoint")}
                    </li>
                    <li className="inline-flex items-center gap-1.5">
                        <Zap className="text-warn-ink size-3" />
                        {tr("eventAdded")}
                    </li>
                </ul>
            </div>
        </div>
    );
}
