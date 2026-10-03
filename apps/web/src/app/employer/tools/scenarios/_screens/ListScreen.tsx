"use client";

import { Plus } from "lucide-react";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import type { ScenarioSummary } from "~/lib/scenarios/types";
import { relativeTime } from "~/lib/tools/format";

import { StatusPill } from "../_components/Bits";
import { useScenarios } from "../_lib/context";
import { runPath } from "../_lib/screens";
import { sizeWords } from "~/lib/scenarios/words";

/**
 * Every scenario this member started, and the ones others shared with the
 * workspace, newest first. A run in progress says which round it is on and
 * the list keeps polling until it is done.
 */
export function ListScreen() {
    const { list } = useScenarios();
    const runs = list.data?.runs ?? [];
    const newButton = (
        <Button asChild size="sm">
            <ToolLink href="/new">
                <Plus aria-hidden />
                New scenario
            </ToolLink>
        </Button>
    );

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
            <PageHeader
                title="What happens"
                accent="if…"
                sub="People built from your records react to a situation, round by round. You read what they said and who changed their mind."
                actions={runs.length > 0 ? newButton : undefined}
            />
            {list.error && <InlineError message={list.error} onRetry={() => void list.reload()} />}
            {list.loading ? (
                <SkeletonRows rows={4} height={72} />
            ) : runs.length === 0 && !list.error ? (
                <EmptyState
                    title="No scenarios yet"
                    body="A scenario is a small simulated social network. People are built from what your workspace already knows — files, prospects, comments on your posts, the company profile — and react to a situation you describe over several rounds: posting, replying, changing their minds. You get the feed, the people and a report of what moved them. It is something to think with, not a forecast."
                    action={newButton}
                />
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
                            Shared
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
                <span className="text-ink-3 whitespace-nowrap text-xs">{sizeWords(run)}</span>
                <span className="text-ink-3 whitespace-nowrap text-xs">
                    {run.createdByMe ? "" : `${run.createdByName} · `}
                    {relativeTime(run.createdAt)}
                </span>
            </div>
        </ToolLink>
    );
}
