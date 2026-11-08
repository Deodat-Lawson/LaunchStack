"use client";

import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "~/components/ui/sheet";

import type { PeopleSearchProgress, RunStep, StepStatus } from "../api";
import { useGrowthFormat } from "../../_lib/format";
import { StepRow, useElapsed } from "./RunSheet";

const ORDER = ["site", "team", "named", "slug", "people", "save"] as const;

function stepStatus(
    id: (typeof ORDER)[number] | "start",
    progress: PeopleSearchProgress | null,
    run: "running" | "done" | "failed"
): StepStatus {
    if (id === "start") return "done";
    if (run === "done") return id === "team" && !progress?.teamPages ? "skipped" : "done";
    const current = progress?.step ?? "site";
    const at = ORDER.indexOf(id);
    const cur = ORDER.indexOf(current);
    if (run === "failed") {
        if (at < cur) return id === "team" && !progress?.teamPages ? "skipped" : "done";
        return at === cur ? "failed" : "waiting";
    }
    if (at < cur) return id === "team" && !progress?.teamPages ? "skipped" : "done";
    return at === cur ? "running" : "waiting";
}

/**
 * The people search as a run: the same step list as finding companies, fed by
 * the step the server reports while it re-reads this one site.
 */
export function PeopleSheet({
    open,
    onOpenChange,
    companyName,
    progress,
    run,
    startedAt,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    companyName: string;
    progress: PeopleSearchProgress | null;
    run: "running" | "done" | "failed";
    startedAt: number | null;
}) {
    const t = useTranslations("growth.prospects.peopleSheet");
    const tr = useTranslations("growth.prospects.runSheet");
    const tc = useTranslations("common.actions");
    const { duration } = useGrowthFormat();
    const live = run === "running";
    const elapsedMs = useElapsed(startedAt ? new Date(startedAt).toISOString() : null, live);

    const count = (id: (typeof ORDER)[number] | "start"): string | null => {
        if (id === "site" && progress && progress.pages > 0)
            return t("pages", { count: progress.pages });
        if (id === "team" && progress && progress.teamPages > 0)
            return t("pages", { count: progress.teamPages });
        if (id === "named" && progress && progress.named > 0)
            return t("people", { count: progress.named });
        if (id === "slug" && progress && progress.slug > 0)
            return t("profiles", { count: progress.slug });
        if (id === "people" && progress && (run === "done" || progress.people > 0))
            return t("people", { count: progress.people });
        return null;
    };

    const steps: RunStep[] = [
        { id: "start", label: t("steps.start"), detail: null, status: "done", right: null },
        ...ORDER.map(id => ({
            id,
            label: t(`steps.${id}`),
            detail:
                id === "people" && run === "done" && !progress?.people
                    ? t("noPeople")
                    : id === "named" &&
                        (run === "done" || stepStatus(id, progress, run) === "done") &&
                        !progress?.named
                      ? t("noNamed")
                      : id === "slug" &&
                          (run === "done" || stepStatus(id, progress, run) === "done") &&
                          !progress?.slug
                        ? t("noSlug")
                        : id === "team" && stepStatus(id, progress, run) === "skipped"
                          ? t("noTeamPage")
                          : null,
            status: stepStatus(id, progress, run),
            right: count(id),
        })),
    ];

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[460px]">
                <SheetHeader className="px-6 pb-2 pt-6">
                    <SheetTitle className="text-ink text-lg font-semibold tracking-[-0.02em]">
                        {run === "done"
                            ? t("titleDone")
                            : run === "failed"
                              ? t("titleFailed")
                              : t("titleRunning")}
                    </SheetTitle>
                    <SheetDescription className="text-ink-2 text-[13px]">
                        {t("description", { company: companyName })}
                    </SheetDescription>
                </SheetHeader>
                <div className="px-6 pb-6">
                    <div className="mt-2">
                        {steps.map(step => (
                            <StepRow key={step.id} step={step} />
                        ))}
                    </div>
                    <div className="border-line text-ink-2 mt-4 flex items-center justify-between gap-3 border-t pt-3 text-xs tabular-nums">
                        <span>
                            {live
                                ? tr("elapsed", { time: duration(elapsedMs) })
                                : tr("took", { time: duration(elapsedMs) })}
                        </span>
                        <span className="text-ink-3">{t("expected")}</span>
                    </div>
                    <div className="mt-5 flex justify-end">
                        {live ? (
                            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                                {tr("background")}
                            </Button>
                        ) : (
                            <Button size="sm" onClick={() => onOpenChange(false)}>
                                {tc("done")}
                            </Button>
                        )}
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}
