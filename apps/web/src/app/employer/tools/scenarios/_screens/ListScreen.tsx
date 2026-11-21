"use client";

import { Plus } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader } from "~/components/tools/PageHeader";
import { SkeletonBlock } from "~/components/tools/SkeletonRows";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import type { ScenarioSummary } from "~/lib/scenarios/types";
import { cn } from "~/lib/utils";

import { StatusPill } from "../_components/Bits";
import { MiniRoom } from "../_components/MiniRoom";
import { useScenarios } from "../_lib/context";
import { runPath } from "../_lib/screens";
import { isLive } from "~/lib/scenarios/words";

/**
 * Every scenario this member started, and the ones others shared with the
 * workspace, newest first, each as a small room: a seat for every person,
 * coloured by the side they ended on. A run in progress says which round it
 * is on and the list keeps polling until it is done.
 */
export function ListScreen() {
    const t = useTranslations("scenarios.list");
    const { list } = useScenarios();
    const runs = list.data?.runs ?? [];
    const newButton = (
        <Button asChild size="sm">
            <ToolLink href="/new">
                <Plus aria-hidden />
                {t("newScenario")}
            </ToolLink>
        </Button>
    );

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
            <PageHeader title={t("title")} actions={runs.length > 0 ? newButton : undefined} />
            {list.error && <InlineError message={list.error} onRetry={() => void list.reload()} />}
            {list.loading ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
                    {[0, 1, 2].map(i => (
                        <SkeletonBlock
                            key={i}
                            lines={5}
                            className="border-line rounded-2xl border p-5"
                        />
                    ))}
                </div>
            ) : runs.length === 0 && !list.error ? (
                <EmptyState title={t("emptyTitle")} body={t("emptyBody")} action={newButton} />
            ) : (
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
                    {runs.map(run => (
                        <li key={run.id}>
                            <RunCard run={run} />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function RunCard({ run }: { run: ScenarioSummary }) {
    const t = useTranslations("scenarios.list");
    const format = useFormatter();
    const now = useNow();
    const when = format.relativeTime(new Date(run.createdAt), now);
    const live = isLive(run.status);
    const stopped = run.status === "failed" || run.status === "cancelled";
    const outcome = run.status === "done" ? run.outcome : null;
    return (
        <ToolLink
            href={runPath(run.id)}
            className="border-line bg-panel hover:border-ink-4/60 hover:shadow-2 focus-visible:ring-brand/50 flex h-full flex-col overflow-hidden rounded-2xl border outline-none transition-[border-color,box-shadow] duration-150 focus-visible:ring-2"
        >
            <div className={cn("px-6 pt-5", stopped && "opacity-70")}>
                <MiniRoom
                    seats={run.agents}
                    outcome={outcome}
                    tone={live ? "brand" : "outline"}
                    label={
                        outcome
                            ? t("roomAria", {
                                  supportive: outcome.supportive,
                                  neutral: outcome.neutral,
                                  critical: outcome.critical,
                              })
                            : t("roomPending", { count: run.agents })
                    }
                />
            </div>
            <div className="flex flex-1 flex-col gap-1.5 px-5 pb-4 pt-3.5">
                <div className="flex items-start justify-between gap-2">
                    <span className="text-ink text-[15px] font-semibold leading-snug tracking-[-0.01em]">
                        {run.title}
                    </span>
                    {run.shared && (
                        <Badge variant="secondary" className="shrink-0">
                            {t("shared")}
                        </Badge>
                    )}
                </div>
                <p
                    className={cn(
                        "line-clamp-3 text-[13.5px] leading-relaxed",
                        run.headline ? "text-ink-2" : "text-ink-3"
                    )}
                >
                    {run.headline ?? run.subject}
                </p>
                <div className="text-ink-3 mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-2.5 text-xs">
                    <StatusPill run={run} />
                    <span className="tabular-nums">
                        {run.createdByMe
                            ? t("cardMeta", { count: run.agents, when })
                            : t("cardMetaBy", { count: run.agents, when, name: run.createdByName })}
                    </span>
                </div>
            </div>
        </ToolLink>
    );
}
