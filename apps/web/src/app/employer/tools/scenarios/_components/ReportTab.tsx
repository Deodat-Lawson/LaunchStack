"use client";

import { Eye } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import type { ScenarioDetail } from "~/lib/scenarios/types";
import { cn } from "~/lib/utils";

import { formatPercent, formatSigned, isLive, moodLabel, stanceLabel } from "~/lib/scenarios/words";
import { mostMoved, moves } from "../_lib/room";
import { StanceTrail } from "./Bits";
import { Portrait } from "./Portrait";
import { PostRef } from "./PostRef";
import { Room } from "./Room";

function Heading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
    return (
        <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-ink text-[17px] font-semibold tracking-[-0.012em]">{children}</h2>
            {aside && <span className="text-ink-3 text-xs">{aside}</span>}
        </div>
    );
}

/**
 * The report, answer first: the verdict, then the Room (everyone seated by
 * where they stand, round by round), what happened and who moved most, what
 * moved them in their own words, the turning points, what to watch for
 * outside the simulation, and the numbers per round. While the run is going,
 * the Room follows the latest round and the table fills in below it.
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
    const format = useFormatter();
    const report = run.report;
    const live = isLive(run.status);
    const postById = new Map(run.posts.map(p => [p.id, p]));
    const movers = mostMoved(run.people, 4);

    return (
        <div className="flex flex-col gap-10">
            {report ? (
                <p className="display text-ink @max-md:text-[19px] max-w-[34em] text-balance text-[22px] font-semibold leading-[1.3] tracking-[-0.016em]">
                    {report.headline}
                </p>
            ) : (
                <p className="text-ink-2 max-w-[72ch] text-[14px] leading-relaxed">
                    {live ? t("liveIntro") : run.round > 0 ? t("stoppedAfter") : t("stoppedBefore")}
                </p>
            )}

            {run.reception && (
                <section>
                    <Heading>{t("receptionTitle")}</Heading>
                    <dl className="border-line bg-panel grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] overflow-hidden rounded-xl border">
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
                            <div key={label} className="border-line-2 border-b border-r px-4 py-3">
                                <dt className="text-ink-3 text-xs">{label}</dt>
                                <dd className="text-ink mt-0.5 text-sm tabular-nums">{value}</dd>
                            </div>
                        ))}
                    </dl>
                </section>
            )}

            {(run.people.length > 0 || live) && (
                <Room run={run} onPerson={onPerson} onJump={onJump} />
            )}

            {report && (
                <section className="@max-lg:grid-cols-1 @max-lg:gap-8 grid grid-cols-[minmax(0,1fr)_300px] gap-12">
                    <div>
                        <Heading>{t("whatHappened")}</Heading>
                        <p className="text-ink-2 max-w-[66ch] text-pretty text-[15px] leading-[1.65]">
                            {report.summary}
                        </p>
                    </div>
                    {movers.length > 0 && (
                        <div>
                            <h3 className="text-ink mb-1 text-[13px] font-semibold">
                                {t("whoMoved")}
                            </h3>
                            <ul>
                                {movers.map(p => (
                                    <li
                                        key={p.id}
                                        className="border-line-2 border-t first:border-t-0"
                                    >
                                        <button
                                            type="button"
                                            onClick={() => onPerson(p.id)}
                                            className="hover:bg-panel-2 focus-visible:ring-brand/50 -mx-2 grid w-[calc(100%+1rem)] grid-cols-[36px_minmax(0,1fr)] items-center gap-3 rounded-lg px-2 py-2.5 text-left outline-none focus-visible:ring-2"
                                        >
                                            <Portrait handle={p.handle} size={36} />
                                            <span className="min-w-0">
                                                <span className="text-ink block truncate text-[13.5px] font-semibold">
                                                    {p.name}
                                                </span>
                                                <span className="text-ink-2 mt-0.5 flex items-center gap-2 text-xs">
                                                    <StanceTrail
                                                        history={p.stanceHistory}
                                                        width={56}
                                                        height={14}
                                                    />
                                                    <span className="truncate">
                                                        {t("moverLine", {
                                                            from: stanceLabel(tw, p.startStance),
                                                            to: stanceLabel(
                                                                tw,
                                                                p.stance
                                                            ).toLowerCase(),
                                                            count: moves(p),
                                                        })}
                                                    </span>
                                                </span>
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </section>
            )}

            {report && report.dynamics.length > 0 && (
                <section>
                    <Heading>{t("whatMoved")}</Heading>
                    <ul>
                        {report.dynamics.map((d, i) => (
                            <li
                                key={i}
                                className="border-line-2 @max-lg:grid-cols-1 @max-lg:gap-3.5 grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-8 border-t py-5"
                            >
                                <p className="text-ink text-[15px] leading-relaxed">{d.text}</p>
                                <div className="flex flex-col gap-3">
                                    {d.postIds.slice(0, 2).map(id => {
                                        const post = postById.get(id);
                                        if (!post?.text.trim()) return null;
                                        const who =
                                            post.authorKind === "narrator"
                                                ? t("narrator")
                                                : post.authorName;
                                        return (
                                            <button
                                                key={id}
                                                type="button"
                                                onClick={() => onJump(id)}
                                                aria-label={t("postRefAria", {
                                                    who,
                                                    when: t("round", { round: post.round }),
                                                })}
                                                className="hover:bg-panel-2 focus-visible:ring-brand/50 -mx-2 grid grid-cols-[28px_minmax(0,1fr)] gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-2"
                                            >
                                                {post.authorKind === "agent" ? (
                                                    <Portrait
                                                        handle={post.authorHandle}
                                                        size={28}
                                                    />
                                                ) : (
                                                    <Portrait
                                                        handle="narrator"
                                                        kind="narrator"
                                                        size={28}
                                                    />
                                                )}
                                                <span className="min-w-0">
                                                    <span className="text-ink-2 line-clamp-3 block text-[13.5px] leading-snug">
                                                        “{post.text}”
                                                    </span>
                                                    <span className="text-ink-3 mt-0.5 block text-xs">
                                                        {t("quoteBy", { who, round: post.round })}
                                                    </span>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {report && report.turningPoints.length > 0 && (
                <section>
                    <Heading>{t("turningPoints")}</Heading>
                    <ol>
                        {report.turningPoints.map((point, i) => (
                            <li
                                key={i}
                                className="border-line-2 @max-sm:grid-cols-1 @max-sm:gap-1 grid grid-cols-[96px_minmax(0,1fr)] gap-4 border-t py-3.5 first:border-t-0 first:pt-0"
                            >
                                <span className="text-ink text-[13px] font-semibold tabular-nums">
                                    {t("turningRound", { round: point.round })}
                                </span>
                                <div className="min-w-0">
                                    <p className="text-ink text-[14.5px] leading-relaxed">
                                        {point.text}
                                    </p>
                                    {point.postIds.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-1.5">
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
                <section>
                    <Heading>{t("watchFor")}</Heading>
                    <ul className="@max-md:grid-cols-1 grid grid-cols-2 gap-3">
                        {report.watchFor.map((w, i) => (
                            <li
                                key={i}
                                className="border-line bg-panel text-ink flex gap-3 rounded-xl border px-4 py-3.5 text-[14px] leading-relaxed"
                            >
                                <Eye className="text-ink-3 mt-1 size-4 shrink-0" aria-hidden />
                                {w}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {(live || !report) && run.roundStats.length > 0 && (
                <section>
                    <Heading>{t("roundByRound")}</Heading>
                    <RoundTable run={run} />
                </section>
            )}

            {report && run.roundStats.length > 0 && (
                <details className="group">
                    <summary className="text-ink-2 hover:text-ink focus-visible:ring-brand/50 w-fit cursor-pointer rounded-sm text-[13.5px] outline-none focus-visible:ring-2">
                        {t("numbersPerRound")}
                    </summary>
                    <div className="mt-3">
                        <RoundTable run={run} />
                    </div>
                </details>
            )}

            <p className={cn("border-line-2 text-ink-3 border-t pt-4 text-xs leading-relaxed")}>
                {tw("caveat")}{" "}
                <span className="tabular-nums">
                    {t(live ? "usageLive" : "usage", {
                        calls: run.usage.calls,
                        credits: run.usage.credits,
                        estimate: run.estimate.credits,
                    })}
                </span>
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
        <div className="border-line bg-panel overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                    <tr className="text-ink-3 text-left text-xs">
                        <th className="px-4 py-2.5 font-medium">{t("table.round")}</th>
                        <th className="px-2 py-2.5 text-right font-medium">{t("table.active")}</th>
                        <th className="px-2 py-2.5 text-right font-medium">{t("table.posts")}</th>
                        <th className="px-2 py-2.5 text-right font-medium">
                            {t("table.comments")}
                        </th>
                        <th className="px-2 py-2.5 text-right font-medium">{t("table.likes")}</th>
                        <th className="px-2 py-2.5 text-right font-medium">{t("table.shares")}</th>
                        <th className="px-4 py-2.5 text-right font-medium">{t("table.mood")}</th>
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
