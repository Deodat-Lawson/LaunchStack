"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "~/components/ui/chart";
import type { ScenarioPerson, ScenarioRoundStats, Stance } from "~/lib/scenarios/types";

import { STANCES, STANCE_BG, STANCE_COLOR, STANCE_KEY, STANCE_LABEL } from "~/lib/scenarios/words";

const CONFIG: ChartConfig = Object.fromEntries(
    STANCES.map(s => [STANCE_KEY[s], { label: STANCE_LABEL[s], color: STANCE_COLOR[s] }])
);

/** Supportive on top, critical at the bottom: the stack reads like the scale. */
const STACK_ORDER: readonly Stance[] = [-2, -1, 0, 1, 2];

function counts(stances: Stance[]): [number, number, number, number, number] {
    const out: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    for (const s of stances) out[s + 2] = (out[s + 2] ?? 0) + 1;
    return out;
}

/**
 * How many people stood where, from the start through each finished round,
 * as stacked areas. The start comes from the people's first stance; every
 * round after from `stanceCounts`.
 */
export function StanceChart({
    people,
    rounds,
}: {
    people: ScenarioPerson[];
    rounds: ScenarioRoundStats[];
}) {
    const start = counts(people.map(p => p.stanceHistory[0] ?? p.startStance));
    const rows = [
        { label: "Start", counts: start },
        ...rounds.map(r => ({ label: `R${r.round}`, counts: r.stanceCounts })),
    ].map(row => ({
        label: row.label,
        ...Object.fromEntries(STANCES.map(s => [STANCE_KEY[s], row.counts[s + 2]])),
    }));
    const last = rounds[rounds.length - 1];
    const describe = (c: readonly number[]) =>
        `${c[0]! + c[1]!} critical, ${c[2]} neutral, ${c[3]! + c[4]!} supportive`;
    const summary = last
        ? `Opinion by round. At the start: ${describe(start)}. After round ${last.round}: ${describe(last.stanceCounts)}.`
        : "Opinion by round.";

    return (
        <div className="flex flex-col gap-2">
            <ChartContainer
                config={CONFIG}
                className="aspect-auto h-[240px] w-full"
                role="img"
                aria-label={summary}
            >
                <AreaChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid vertical={false} stroke="var(--line-2)" />
                    <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                        interval="preserveStartEnd"
                        minTickGap={12}
                    />
                    <YAxis
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                        width={32}
                        tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                    />
                    <ChartTooltip
                        cursor={{ stroke: "var(--line)" }}
                        content={<ChartTooltipContent indicator="dot" />}
                    />
                    {STACK_ORDER.map(s => (
                        <Area
                            key={s}
                            type="linear"
                            dataKey={STANCE_KEY[s]}
                            stackId="stance"
                            stroke="var(--panel)"
                            strokeWidth={1}
                            fill={`var(--color-${STANCE_KEY[s]})`}
                            fillOpacity={1}
                            isAnimationActive={false}
                        />
                    ))}
                </AreaChart>
            </ChartContainer>
            <ul
                className="text-ink-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs"
                aria-hidden
            >
                {STANCES.map(s => (
                    <li key={s} className="inline-flex items-center gap-1.5">
                        <span className={`size-2 rounded-[2px] ${STANCE_BG[s]}`} />
                        {STANCE_LABEL[s]}
                    </li>
                ))}
            </ul>
        </div>
    );
}
