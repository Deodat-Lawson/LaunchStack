"use client";

import { CornerDownRight } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonBlock } from "~/components/tools/SkeletonRows";
import type { ScenarioDetail, ScenarioPost } from "~/lib/scenarios/types";
import { cn } from "~/lib/utils";

import { FACTION_BG, formatPercent, formatSigned, isLive, moodLabel } from "~/lib/scenarios/words";
import { PersonHoverCard, Portrait } from "./Portrait";
import { StanceChart } from "./StanceChart";

/** A link to a post in the Feed: "@mayabooks, round 3". */
export function PostRef({
    post,
    onJump,
}: {
    post: ScenarioPost | undefined;
    onJump: (postId: string) => void;
}) {
    const t = useTranslations("scenarios.report");
    if (!post) return null;
    const who = post.authorKind === "narrator" ? t("narrator") : `@${post.authorHandle}`;
    const when = post.round === 0 ? t("opening") : t("round", { round: post.round });
    return (
        <button
            type="button"
            onClick={() => onJump(post.id)}
            className={cn(
                "border-line text-ink-2 hover:bg-panel-2 hover:text-ink focus-visible:ring-brand/50 inline-flex items-center gap-1 rounded-full border py-0.5 pr-2 text-[11.5px] outline-none focus-visible:ring-2",
                post.authorKind === "agent" ? "pl-0.5" : "pl-2"
            )}
            aria-label={t("postRefAria", { who, when })}
        >
            {post.authorKind === "agent" ? (
                <Portrait handle={post.authorHandle} size={18} />
            ) : (
                <CornerDownRight className="size-3" aria-hidden />
            )}
            {t("postRef", { who, when })}
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
    const t = useTranslations("scenarios.report");
    const tw = useTranslations("scenarios.words");
    const locale = useLocale();
    const report = run.report;
    const postById = new Map(run.posts.map(p => [p.id, p]));
    const people = new Map(run.people.map(p => [p.id, p]));
    const live = isLive(run.status);
    const format = useFormatter();
    const lastRound = run.roundStats[run.roundStats.length - 1];

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
                <p className="text-ink-2 max-w-[72ch] text-[13px]">{t("liveIntro")}</p>
            ) : (
                <p className="text-ink-2 max-w-[72ch] text-[13px]">
                    {run.round > 0 ? t("stoppedAfter") : t("stoppedBefore")}
                </p>
            )}

            {run.reception && (
                <section>
                    <SectionHeading title={t("receptionTitle")} />
                    <div className="border-line bg-panel grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] overflow-hidden rounded-lg border">
                        {(
                            [
                                [
                                    t("engaged"),
                                    t("engagedValue", {
                                        engaged: run.reception.engaged,
                                        exposed: run.reception.exposed,
                                        rate: formatPercent(run.reception.engagementRate, locale),
                                    }),
                                ],
                                [t("likes"), format.number(run.reception.likes)],
                                [t("comments"), format.number(run.reception.comments)],
                                [t("shares"), format.number(run.reception.shares)],
                                [t("dislikes"), format.number(run.reception.dislikes)],
                                [
                                    t("mood"),
                                    t("moodValue", {
                                        from: formatSigned(run.reception.startingSentiment, locale),
                                        to: formatSigned(run.reception.sentiment, locale),
                                    }),
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
                    title={t("opinionTitle")}
                    aside={
                        lastRound
                            ? t("opinionAside", {
                                  mean: formatSigned(lastRound.meanStance, locale),
                                  round: run.roundStats.length,
                                  mood: moodLabel(tw, lastRound.meanStance),
                              })
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
                        <p className="text-ink-3 mt-3 text-xs">{t("chartPending")}</p>
                    </div>
                ) : (
                    <p className="text-ink-3 text-[13px]">{t("noRound")}</p>
                )}
            </section>

            {(live || !report) && run.roundStats.length > 0 && (
                <section>
                    <SectionHeading title={t("roundByRound")} />
                    <RoundTable run={run} />
                </section>
            )}

            {report && report.factions.length > 0 && (
                <section>
                    <SectionHeading title={t("factionsTitle")} />
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
                                            {formatPercent(f.share, locale)}
                                        </span>
                                    </div>
                                    <div
                                        className="bg-panel-2 mt-1.5 h-1.5 overflow-hidden rounded-full"
                                        role="img"
                                        aria-label={t("factionShare", {
                                            share: formatPercent(f.share, locale),
                                        })}
                                    >
                                        <div
                                            className={cn(
                                                "h-full rounded-full",
                                                FACTION_BG[f.stance]
                                            )}
                                            style={{ width: `${Math.max(2, f.share * 100)}%` }}
                                        />
                                    </div>
                                    <div className="text-ink-3 mt-1 text-xs">
                                        {t(`faction.${f.stance}`)}
                                    </div>
                                </div>
                                <div className="min-w-0">
                                    <p className="text-ink-2 text-[13px] leading-relaxed">
                                        {f.text}
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {f.agentIds.map(id => {
                                            const person = people.get(id);
                                            if (!person) return null;
                                            return (
                                                <PersonHoverCard key={id} person={person}>
                                                    <button
                                                        type="button"
                                                        onClick={() => onPerson(id)}
                                                        className="border-line text-ink-2 hover:bg-panel-2 hover:text-ink focus-visible:ring-brand/50 inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs outline-none focus-visible:ring-2"
                                                    >
                                                        <Portrait handle={person.handle} size={20} />
                                                        {person.name}
                                                    </button>
                                                </PersonHoverCard>
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
                    <SectionHeading title={t("drivers")} />
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
                    <SectionHeading title={t("turningPoints")} />
                    <ol className="border-line bg-panel overflow-hidden rounded-lg border">
                        {report.turningPoints.map((point, i) => (
                            <li
                                key={i}
                                className="border-line-2 grid grid-cols-[72px_minmax(0,1fr)] gap-3 border-t px-4 py-3 first:border-t-0"
                            >
                                <span className="text-ink-3 font-mono text-xs tabular-nums">
                                    {t("turningRound", { round: point.round })}
                                </span>
                                <div className="min-w-0">
                                    <p className="text-ink-2 text-[13.5px] leading-relaxed">
                                        {point.text}
                                    </p>
                                    {point.postIds.length > 0 && (
                                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                                            {point.postIds.map(id => (
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
                    <SectionHeading title={t("watchFor")} />
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
                        {t("numbersPerRound")}
                    </summary>
                    <div className="mt-3">
                        <RoundTable run={run} />
                    </div>
                </details>
            )}

            <p className="text-ink-3 text-xs tabular-nums">
                {t(live ? "usageLive" : "usage", {
                    calls: run.usage.calls,
                    credits: run.usage.credits,
                    estimate: run.estimate.credits,
                })}
            </p>
        </div>
    );
}

function RoundTable({ run }: { run: ScenarioDetail }) {
    const t = useTranslations("scenarios.report");
    const tw = useTranslations("scenarios.words");
    const locale = useLocale();
    const format = useFormatter();
    return (
        <div className="border-line bg-panel overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                    <tr className="text-ink-3 text-left text-xs">
                        <th className="px-4 py-2 font-medium">{t("table.round")}</th>
                        <th className="px-2 py-2 text-right font-medium">{t("table.active")}</th>
                        <th className="px-2 py-2 text-right font-medium">{t("table.posts")}</th>
                        <th className="px-2 py-2 text-right font-medium">{t("table.comments")}</th>
                        <th className="px-2 py-2 text-right font-medium">{t("table.likes")}</th>
                        <th className="px-2 py-2 text-right font-medium">{t("table.shares")}</th>
                        <th className="px-4 py-2 text-right font-medium">{t("table.mood")}</th>
                    </tr>
                </thead>
                <tbody>
                    {run.roundStats.map(r => (
                        <tr key={r.round} className="border-line-2 border-t">
                            <td className="text-ink px-4 py-2 tabular-nums">{r.round}</td>
                            <td className="text-ink-2 px-2 py-2 text-right tabular-nums">
                                {format.number(r.active)}
                            </td>
                            <td className="text-ink-2 px-2 py-2 text-right tabular-nums">
                                {format.number(r.posts)}
                            </td>
                            <td className="text-ink-2 px-2 py-2 text-right tabular-nums">
                                {format.number(r.comments)}
                            </td>
                            <td className="text-ink-2 px-2 py-2 text-right tabular-nums">
                                {format.number(r.likes)}
                            </td>
                            <td className="text-ink-2 px-2 py-2 text-right tabular-nums">
                                {format.number(r.shares)}
                            </td>
                            <td className="text-ink-2 whitespace-nowrap px-4 py-2 text-right tabular-nums">
                                {t("roundMood", {
                                    mean: formatSigned(r.meanStance, locale),
                                    mood: moodLabel(tw, r.meanStance),
                                })}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
