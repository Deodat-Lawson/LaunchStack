"use client";

import { CornerDownRight } from "lucide-react";

import { SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonBlock } from "~/components/tools/SkeletonRows";
import type { ScenarioDetail, ScenarioPost } from "~/lib/scenarios/types";
import { cn } from "~/lib/utils";

import { FACTION_BG, isLive, moodWords, percent, signed } from "~/lib/scenarios/words";
import { StanceChart } from "./StanceChart";

/** A link to a post in the Feed: "@mayabooks, round 3". */
export function PostRef({
    post,
    onJump,
}: {
    post: ScenarioPost | undefined;
    onJump: (postId: string) => void;
}) {
    if (!post) return null;
    const who = post.authorKind === "narrator" ? "the narrator" : `@${post.authorHandle}`;
    const when = post.round === 0 ? "opening" : `round ${post.round}`;
    return (
        <button
            type="button"
            onClick={() => onJump(post.id)}
            className="border-line text-ink-2 hover:bg-panel-2 hover:text-ink focus-visible:ring-brand/50 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] outline-none focus-visible:ring-2"
            aria-label={`See the post by ${who} in ${when}`}
        >
            <CornerDownRight className="size-3" aria-hidden />
            {who}, {when}
        </button>
    );
}

/**
 * The report once the run is done: headline, what happened, how opinion
 * moved, the camps people ended in, and what to watch for outside the
 * simulation. While it runs, the same chart and the numbers per round.
 */
export function ReportTab({
    run,
    onJump,
    onPerson,
}: {
    run: ScenarioDetail;
    onJump: (postId: string) => void;
    onPerson: (personId: string) => void;
}) {
    const report = run.report;
    const postById = new Map(run.posts.map(p => [p.id, p]));
    const people = new Map(run.people.map(p => [p.id, p]));
    const live = isLive(run.status);

    return (
        <div className="flex flex-col gap-8">
            {report ? (
                <section className="max-w-[72ch]">
                    <h2 className="display text-ink text-[20px] leading-snug tracking-[-0.01em]">
                        {report.headline}
                    </h2>
                    <p className="text-ink-2 mt-3 text-[14px] leading-relaxed">{report.summary}</p>
                </section>
            ) : live ? (
                <p className="text-ink-2 max-w-[72ch] text-[13px]">
                    The report is written after the last round. Until then, here is how opinion is
                    moving and what each round looked like.
                </p>
            ) : (
                <p className="text-ink-2 max-w-[72ch] text-[13px]">
                    {run.round > 0
                        ? "This scenario stopped before its report was written. What happened up to then is below and in the Feed."
                        : "This scenario stopped before the first round finished, so there is nothing to report."}
                </p>
            )}

            {run.reception && (
                <section>
                    <SectionHeading title="How the draft was received" />
                    <div className="border-line bg-panel grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] overflow-hidden rounded-lg border">
                        {(
                            [
                                [
                                    "Engaged",
                                    `${run.reception.engaged} of ${run.reception.exposed} (${percent(run.reception.engagementRate)})`,
                                ],
                                ["Likes", String(run.reception.likes)],
                                ["Comments", String(run.reception.comments)],
                                ["Shares", String(run.reception.shares)],
                                ["Dislikes", String(run.reception.dislikes)],
                                [
                                    "Mood",
                                    `${signed(run.reception.startingSentiment)} → ${signed(run.reception.sentiment)}`,
                                ],
                            ] as const
                        ).map(([label, value]) => (
                            <div
                                key={label}
                                className="border-line-2 border-b border-r px-4 py-2.5"
                            >
                                <div className="text-ink-3 text-xs">{label}</div>
                                <div className="text-ink text-sm tabular-nums">{value}</div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            <section>
                <SectionHeading
                    title="How opinion moved"
                    aside={
                        run.roundStats.length > 0
                            ? `mean ${signed(run.roundStats[run.roundStats.length - 1]!.meanStance)} after round ${run.roundStats.length} · ${moodWords(run.roundStats[run.roundStats.length - 1]!.meanStance)}`
                            : undefined
                    }
                />
                {run.roundStats.length > 0 && run.people.length > 0 ? (
                    <div className="border-line bg-panel rounded-lg border px-3 pb-3 pt-4">
                        <StanceChart people={run.people} rounds={run.roundStats} />
                    </div>
                ) : live ? (
                    <div className="border-line bg-panel rounded-lg border p-4">
                        <SkeletonBlock lines={3} />
                        <p className="text-ink-3 mt-3 text-xs">
                            The chart starts when the first round finishes.
                        </p>
                    </div>
                ) : (
                    <p className="text-ink-3 text-[13px]">No round finished.</p>
                )}
            </section>

            {(live || !report) && run.roundStats.length > 0 && (
                <section>
                    <SectionHeading title="Round by round" />
                    <RoundTable run={run} />
                </section>
            )}

            {report && report.factions.length > 0 && (
                <section>
                    <SectionHeading title="Where people ended up" />
                    <div className="border-line bg-panel overflow-hidden rounded-lg border">
                        {report.factions.map(f => (
                            <div
                                key={f.stance}
                                className="border-line-2 @max-md:grid-cols-1 grid grid-cols-[minmax(0,220px)_minmax(0,1fr)] gap-x-6 gap-y-2 border-t px-4 py-3.5 first:border-t-0"
                            >
                                <div>
                                    <div className="flex items-baseline justify-between gap-3">
                                        <span className="text-ink text-sm font-medium">
                                            {f.label}
                                        </span>
                                        <span className="text-ink-2 font-mono text-xs tabular-nums">
                                            {percent(f.share)}
                                        </span>
                                    </div>
                                    <div
                                        className="bg-panel-2 mt-1.5 h-1.5 overflow-hidden rounded-full"
                                        role="img"
                                        aria-label={`${percent(f.share)} of people`}
                                    >
                                        <div
                                            className={cn(
                                                "h-full rounded-full",
                                                FACTION_BG[f.stance]
                                            )}
                                            style={{ width: `${Math.max(2, f.share * 100)}%` }}
                                        />
                                    </div>
                                    <div className="text-ink-3 mt-1 text-xs capitalize">
                                        {f.stance}
                                    </div>
                                </div>
                                <div className="min-w-0">
                                    <p className="text-ink-2 text-[13px] leading-relaxed">
                                        {f.text}
                                    </p>
                                    <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1">
                                        {f.agentIds.map(id => {
                                            const person = people.get(id);
                                            if (!person) return null;
                                            return (
                                                <button
                                                    key={id}
                                                    type="button"
                                                    onClick={() => onPerson(id)}
                                                    className="text-ink-2 hover:text-ink focus-visible:ring-brand/50 decoration-line rounded-sm text-xs underline underline-offset-2 outline-none focus-visible:ring-2"
                                                >
                                                    {person.name}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {report && report.dynamics.length > 0 && (
                <section className="max-w-[80ch]">
                    <SectionHeading title="What drove it" />
                    <ul className="flex flex-col gap-3">
                        {report.dynamics.map((d, i) => (
                            <li key={i} className="text-ink-2 text-[13.5px] leading-relaxed">
                                {d.text}
                                {d.postIds.length > 0 && (
                                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                                        {d.postIds.map(id => (
                                            <PostRef
                                                key={id}
                                                post={postById.get(id)}
                                                onJump={onJump}
                                            />
                                        ))}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {report && report.turningPoints.length > 0 && (
                <section className="max-w-[80ch]">
                    <SectionHeading title="Turning points" />
                    <ol className="border-line bg-panel overflow-hidden rounded-lg border">
                        {report.turningPoints.map((t, i) => (
                            <li
                                key={i}
                                className="border-line-2 grid grid-cols-[72px_minmax(0,1fr)] gap-3 border-t px-4 py-3 first:border-t-0"
                            >
                                <span className="text-ink-3 font-mono text-xs tabular-nums">
                                    Round {t.round}
                                </span>
                                <div className="min-w-0">
                                    <p className="text-ink-2 text-[13.5px] leading-relaxed">
                                        {t.text}
                                    </p>
                                    {t.postIds.length > 0 && (
                                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                                            {t.postIds.map(id => (
                                                <PostRef
                                                    key={id}
                                                    post={postById.get(id)}
                                                    onJump={onJump}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ol>
                </section>
            )}

            {report && report.watchFor.length > 0 && (
                <section className="max-w-[80ch]">
                    <SectionHeading title="Watch for in the real world" />
                    <ul className="text-ink-2 flex list-disc flex-col gap-1.5 pl-5 text-[13.5px] leading-relaxed">
                        {report.watchFor.map((w, i) => (
                            <li key={i}>{w}</li>
                        ))}
                    </ul>
                </section>
            )}

            {report && run.roundStats.length > 0 && (
                <details className="group">
                    <summary className="text-ink-2 hover:text-ink focus-visible:ring-brand/50 w-fit cursor-pointer rounded-sm text-[13px] outline-none focus-visible:ring-2">
                        Numbers per round
                    </summary>
                    <div className="mt-3">
                        <RoundTable run={run} />
                    </div>
                </details>
            )}

            <p className="text-ink-3 text-xs tabular-nums">
                {live ? "Used so far" : "Used"}: about {run.usage.calls.toLocaleString()} model
                calls · {run.usage.credits.toLocaleString()} credits (estimated{" "}
                {run.estimate.credits.toLocaleString()}).
            </p>
        </div>
    );
}

function RoundTable({ run }: { run: ScenarioDetail }) {
    return (
        <div className="border-line bg-panel overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                    <tr className="text-ink-3 text-left text-xs">
                        <th className="px-4 py-2 font-medium">Round</th>
                        <th className="px-2 py-2 text-right font-medium">Active</th>
                        <th className="px-2 py-2 text-right font-medium">Posts</th>
                        <th className="px-2 py-2 text-right font-medium">Comments</th>
                        <th className="px-2 py-2 text-right font-medium">Likes</th>
                        <th className="px-2 py-2 text-right font-medium">Shares</th>
                        <th className="px-4 py-2 text-right font-medium">Mood</th>
                    </tr>
                </thead>
                <tbody>
                    {run.roundStats.map(r => (
                        <tr key={r.round} className="border-line-2 border-t">
                            <td className="text-ink px-4 py-2 tabular-nums">{r.round}</td>
                            <td className="text-ink-2 px-2 py-2 text-right tabular-nums">
                                {r.active}
                            </td>
                            <td className="text-ink-2 px-2 py-2 text-right tabular-nums">
                                {r.posts}
                            </td>
                            <td className="text-ink-2 px-2 py-2 text-right tabular-nums">
                                {r.comments}
                            </td>
                            <td className="text-ink-2 px-2 py-2 text-right tabular-nums">
                                {r.likes}
                            </td>
                            <td className="text-ink-2 px-2 py-2 text-right tabular-nums">
                                {r.shares}
                            </td>
                            <td className="text-ink-2 whitespace-nowrap px-4 py-2 text-right tabular-nums">
                                {signed(r.meanStance)} · {moodWords(r.meanStance)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
