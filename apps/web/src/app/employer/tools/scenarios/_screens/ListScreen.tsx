"use client";

import { Plus } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import type { ScenarioSummary } from "~/lib/scenarios/types";

import { StatusPill } from "../_components/Bits";
import { useScenarios } from "../_lib/context";
import { runPath } from "../_lib/screens";
import { sizeLabel } from "~/lib/scenarios/words";

/**
 * Every scenario this member started, and the ones others shared with the
 * workspace, newest first. A run in progress says which round it is on and
 * the list keeps polling until it is done.
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
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
            <PageHeader
                title={t("title")}
                accent={t("accent")}
                sub={t("sub")}
                actions={runs.length > 0 ? newButton : undefined}
            />
            {list.error && <InlineError message={list.error} onRetry={() => void list.reload()} />}
            {list.loading ? (
                <SkeletonRows rows={4} height={72} />
            ) : runs.length === 0 && !list.error ? (
                <EmptyState title={t("emptyTitle")} body={t("emptyBody")} action={newButton} />
            ) : (
                <div className="border-line bg-panel overflow-hidden rounded-lg border">
                    {runs.map(run => (
                        <RunRow key={run.id} run={run} />
                    ))}
                </div>
            )}
        </div>
    );
}

function RunRow({ run }: { run: ScenarioSummary }) {
    const t = useTranslations("scenarios.list");
    const tw = useTranslations("scenarios.words");
    const format = useFormatter();
    const now = useNow();
    const when = format.relativeTime(new Date(run.createdAt), now);
    return (
        <ToolLink
            href={runPath(run.id)}
            className="border-line-2 hover:bg-panel-2 focus-visible:ring-brand/50 @max-sm:grid-cols-1 grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1.5 border-t px-4 py-3 outline-none first:border-t-0 focus-visible:ring-2 focus-visible:ring-inset"
        >
            <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="text-ink truncate text-sm font-medium">{run.title}</span>
                    {run.shared && (
                        <Badge variant="secondary" className="shrink-0">
                            {t("shared")}
                        </Badge>
                    )}
                </div>
                <p className="text-ink-3 mt-0.5 truncate text-xs">{run.subject}</p>
                {run.headline && (
                    <p className="text-ink-2 mt-1.5 line-clamp-2 max-w-[80ch] text-[13px] leading-snug">
                        {run.headline}
                    </p>
                )}
            </div>
            <div className="@max-sm:items-start @max-sm:text-left flex flex-col items-end gap-1 text-right">
                <StatusPill run={run} />
                <span className="text-ink-3 whitespace-nowrap text-xs">{sizeLabel(tw, run)}</span>
                <span className="text-ink-3 whitespace-nowrap text-xs">
                    {run.createdByMe ? when : t("byWhen", { name: run.createdByName, when })}
                </span>
            </div>
        </ToolLink>
    );
}
