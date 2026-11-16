"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Circle, LoaderCircle, XCircle } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import type { WeeklyReviewStage } from "../api";
import type { ReviewGeneration } from "../_lib/useWeeklyReviewData";
import s from "./review-layout.module.css";

const stages: WeeklyReviewStage[] = ["gathering", "writing", "checking", "saving"];

export function ReviewGenerationProgress({ generation }: { generation: ReviewGeneration }) {
    const t = useTranslations("vantage.weeklyReview");
    const { running, stage, failedStage, complete, error, startedAt, visitedStages } = generation;
    const [seconds, setSeconds] = useState(0);
    useEffect(() => {
        if (!running || startedAt === null) return;
        const update = () => setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
        update();
        const timer = window.setInterval(update, 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);
    if (!running && !complete && !error) return null;
    const status = running
        ? t(`founder.generation.${stage ?? "starting"}`)
        : error
          ? failedStage
              ? t("founder.generation.failed", { stage: t(`founder.generation.${failedStage}`) })
              : t("founder.generation.failedBeforeStart")
          : t("founder.generation.complete");
    return (
        <Card className={s.panel}>
            <CardContent className={cn(s.label, "space-y-3 p-4")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p
                        aria-live="polite"
                        role="status"
                        data-testid="review-generation-stage"
                        className="font-semibold"
                    >
                        {status}
                    </p>
                    {running ? (
                        <p className="text-ink-2 tabular-nums">
                            {t("founder.generation.elapsed", { seconds })}
                        </p>
                    ) : null}
                </div>
                <ol
                    aria-label={t("founder.generation.progressLabel")}
                    className="grid gap-3 sm:grid-cols-4"
                >
                    {stages.map(item => {
                        const failed = error !== null && failedStage === item;
                        const active = running && stage === item;
                        const done = visitedStages.includes(item) && !failed && !active;
                        const state = failed
                            ? "failedStatus"
                            : active
                              ? "active"
                              : done
                                ? "done"
                                : "pending";
                        const Icon = failed
                            ? XCircle
                            : active
                              ? LoaderCircle
                              : done
                                ? CheckCircle2
                                : Circle;
                        return (
                            <li
                                key={item}
                                data-stage={item}
                                data-state={state}
                                className={cn(
                                    s.stage,
                                    "flex min-w-0 items-center gap-2",
                                    failed ? "text-danger" : active ? "text-brand" : "text-ink-2"
                                )}
                            >
                                <Icon
                                    aria-hidden="true"
                                    className={cn(
                                        "size-4 shrink-0",
                                        active && "motion-reduce:animate-none"
                                    )}
                                />
                                <span>{t(`founder.generation.${item}`)}</span>
                                <span className="sr-only">{t(`founder.generation.${state}`)}</span>
                            </li>
                        );
                    })}
                </ol>
            </CardContent>
        </Card>
    );
}
