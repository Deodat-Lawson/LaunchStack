"use client";

import { ArrowUpRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { InlineError } from "~/components/tools/EmptyState";
import { SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonBlock } from "~/components/tools/SkeletonRows";
import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "~/components/ui/sheet";
import { SCENARIO_LIMITS, type PostTestResult } from "~/lib/scenarios/types";
import {
    STANCE_BG,
    formatPercent,
    formatSigned,
    isLive,
    moodLabel,
    progressLabel,
    progressValue,
    stanceLabel,
} from "~/lib/scenarios/words";
import { toolTabHref } from "~/lib/tool-app/locations";
import { cn } from "~/lib/utils";

const { agents: READERS, rounds: ROUNDS } = SCENARIO_LIMITS.postTest;

/**
 * A draft run past simulated readers built from the workspace's records: the
 * test's progress, then how many engaged, what they did, how the mood moved
 * and a few of the comments, with a way into the full run in Scenarios.
 */
export function PostTestSheet({
    open,
    onOpenChange,
    test,
    error,
    onRetry,
    stale,
    onTestAgain,
    testing,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    test: PostTestResult | null;
    error: string | null;
    onRetry: () => void;
    /** The draft changed after this test. */
    stale: boolean;
    onTestAgain: () => void;
    testing: boolean;
}) {
    const t = useTranslations("growth.brand.postTest");
    const tw = useTranslations("scenarios.words");
    const locale = useLocale();
    const live = test ? isLive(test.status) : true;
    const reception = test?.reception ?? null;
    const title = !test
        ? t("titles.testing")
        : test.status === "done"
          ? t("titles.done")
          : test.status === "failed"
            ? t("titles.failed")
            : test.status === "cancelled"
              ? t("titles.cancelled")
              : t("titles.testing");

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[460px]">
                <SheetHeader className="px-6 pb-2 pt-6">
                    <SheetTitle className="text-ink text-lg font-semibold tracking-[-0.02em]">
                        {title}
                    </SheetTitle>
                    <SheetDescription className="text-ink-2 text-[13px]">
                        {t("description", { readers: READERS, rounds: ROUNDS })}
                    </SheetDescription>
                </SheetHeader>
                <div className="flex flex-col gap-6 px-6 pb-8 pt-2">
                    {stale && (
                        <div className="border-warn/40 bg-warn-soft flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
                            <span className="text-warn-ink text-xs">{t("stale")}</span>
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={testing}
                                onClick={onTestAgain}
                            >
                                {testing ? t("starting") : t("testAgain")}
                            </Button>
                        </div>
                    )}

                    {error && !test && <InlineError message={error} onRetry={onRetry} />}

                    {live && (
                        <div className="flex flex-col gap-2" aria-live="polite">
                            <div className="text-ink-2 flex items-baseline justify-between text-[13px]">
                                <span>
                                    {test
                                        ? progressLabel(tw, { ...test, agents: READERS })
                                        : tw("progress.queued")}
                                </span>
                                {test && (
                                    <span className="text-ink-3 text-xs tabular-nums">
                                        {t("rounds", { round: test.round, rounds: test.rounds })}
                                    </span>
                                )}
                            </div>
                            <Progress value={test ? progressValue(test) : 2} className="h-1.5" />
                            <SkeletonBlock lines={3} className="mt-3" />
                        </div>
                    )}

                    {test?.status === "failed" && (
                        <p role="alert" className="text-danger text-[13px]">
                            {test.error ?? t("stoppedEarly")}
                        </p>
                    )}

                    {test?.status === "done" && reception && (
                        <>
                            <div>
                                <div className="display text-ink text-[22px] tabular-nums leading-tight">
                                    {t("engaged", {
                                        engaged: reception.engaged,
                                        exposed: reception.exposed,
                                        rate: formatPercent(reception.engagementRate, locale),
                                    })}
                                </div>
                                <dl className="border-line bg-panel mt-3 grid grid-cols-4 overflow-hidden rounded-lg border">
                                    {(
                                        [
                                            [t("likes"), reception.likes],
                                            [t("comments"), reception.comments],
                                            [t("shares"), reception.shares],
                                            [t("dislikes"), reception.dislikes],
                                        ] as const
                                    ).map(([label, n]) => (
                                        <div
                                            key={label}
                                            className="border-line-2 border-l px-3 py-2 first:border-l-0"
                                        >
                                            <dt className="text-ink-3 text-[11.5px]">{label}</dt>
                                            <dd className="text-ink font-mono text-base tabular-nums">
                                                {n}
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                                <p className="text-ink-2 mt-3 text-[13px]">
                                    {t.rich("mood", {
                                        start: formatSigned(reception.startingSentiment, locale),
                                        startWords: moodLabel(tw, reception.startingSentiment),
                                        end: formatSigned(reception.sentiment, locale),
                                        endWords: moodLabel(tw, reception.sentiment),
                                        num: chunks => (
                                            <span className="tabular-nums">{chunks}</span>
                                        ),
                                    })}
                                </p>
                            </div>

                            {test.headline && (
                                <p className="text-ink text-[14px] leading-relaxed">
                                    {test.headline}
                                </p>
                            )}

                            {test.sampleComments.length > 0 && (
                                <div>
                                    <SectionHeading title={t("whatTheySaid")} />
                                    <ul className="border-line bg-panel overflow-hidden rounded-lg border">
                                        {test.sampleComments.slice(0, 5).map((c, i) => (
                                            <li
                                                key={`${c.handle}-${i}`}
                                                className="border-line-2 border-t px-3 py-2.5 first:border-t-0"
                                            >
                                                <div className="flex items-baseline justify-between gap-3">
                                                    <span className="text-ink min-w-0 truncate text-[13px] font-medium">
                                                        {c.name}
                                                        <span className="text-ink-3 font-normal">
                                                            {" "}
                                                            · {c.role}
                                                        </span>
                                                    </span>
                                                    <span className="text-ink-3 inline-flex shrink-0 items-center gap-1.5 text-[11.5px]">
                                                        <span
                                                            aria-hidden
                                                            className={cn(
                                                                "size-2 rounded-full",
                                                                STANCE_BG[c.stance]
                                                            )}
                                                        />
                                                        {stanceLabel(tw, c.stance)}
                                                    </span>
                                                </div>
                                                <p className="text-ink-2 mt-0.5 text-[13px] leading-snug">
                                                    {c.text}
                                                </p>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </>
                    )}

                    <p className="text-ink-3 text-xs leading-relaxed">{tw("caveat")}</p>

                    {test && (
                        <ToolLink
                            href={toolTabHref("scenarios", `/runs/${test.runId}`)}
                            className="text-ink-2 hover:text-ink focus-visible:ring-brand/50 inline-flex w-fit items-center gap-1 rounded-sm text-[13px] underline underline-offset-2 outline-none focus-visible:ring-2"
                        >
                            {t("openRun")}
                            <ArrowUpRight className="size-3.5" aria-hidden />
                        </ToolLink>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
