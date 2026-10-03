"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";

import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { plural, relativeTime } from "~/lib/tools/format";
import { useResource } from "~/lib/tools/useResource";
import { NewApplicationDialog } from "../_components/NewApplicationDialog";
import { ApplicationStatusPill, ReadinessMeter } from "../_components/Pills";
import { useProposals } from "../_lib/context";
import { deadlineTone, deadlineWords } from "../_lib/words";
import { proposalsApi, type ApplicationRow } from "../api";

type View = "open" | "closed" | "all";
const OPEN = new Set(["draft", "in_progress", "in_review", "ready"]);

function byUrgency(a: ApplicationRow, b: ApplicationRow): number {
    if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return b.updatedAt.localeCompare(a.updatedAt);
}

/** Every application, nearest deadline first; closed ones by when they last moved. */
export function ApplicationsScreen() {
    const { href, finishedTick } = useProposals();
    const res = useResource("proposals:applications", () => proposalsApi.applications());
    const reload = res.reload;
    useEffect(() => {
        if (finishedTick > 0) void reload();
    }, [finishedTick, reload]);
    const [view, setView] = useState<View>("open");
    const [creating, setCreating] = useState(false);

    const all = useMemo(() => res.data?.applications ?? [], [res.data]);
    const rows = useMemo(() => {
        const filtered =
            view === "all"
                ? all
                : all.filter(a => (view === "open" ? OPEN.has(a.status) : !OPEN.has(a.status)));
        return [...filtered].sort(byUrgency);
    }, [all, view]);
    const openCount = all.filter(a => OPEN.has(a.status)).length;

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
            <PageHeader
                title="Applications"
                accent="in flight"
                sub={
                    res.data
                        ? `${plural(openCount, "application")} open · ${all.length - openCount} closed`
                        : undefined
                }
                actions={
                    <Button size="sm" onClick={() => setCreating(true)}>
                        New application
                    </Button>
                }
            />
            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}

            <ToggleGroup
                type="single"
                value={view}
                onValueChange={v => v && setView(v as View)}
                size="sm"
                variant="outline"
                className="self-start"
            >
                <ToggleGroupItem value="open">Open</ToggleGroupItem>
                <ToggleGroupItem value="closed">Closed</ToggleGroupItem>
                <ToggleGroupItem value="all">All</ToggleGroupItem>
            </ToggleGroup>

            {res.loading ? (
                <SkeletonRows rows={5} height={52} />
            ) : rows.length === 0 ? (
                <EmptyState
                    title={all.length === 0 ? "No applications yet" : "Nothing in this view"}
                    body={
                        all.length === 0
                            ? "Start one from a funder you found, or paste a call you already have. Its requirements become a checklist and every section can be drafted from your sources."
                            : "Change the view to see the rest."
                    }
                    action={
                        all.length === 0 ? (
                            <Button size="sm" onClick={() => setCreating(true)}>
                                New application
                            </Button>
                        ) : undefined
                    }
                />
            ) : (
                <div className="border-line bg-panel overflow-hidden rounded-lg border">
                    <div className="text-ink-3 border-line-2 hidden grid-cols-[minmax(0,1fr)_150px_120px_120px_100px] gap-4 border-b px-4 py-2 text-xs md:grid">
                        <span>Application</span>
                        <span>Deadline</span>
                        <span>Status</span>
                        <span>Sections</span>
                        <span>Ready</span>
                    </div>
                    {rows.map(app => {
                        const tone = deadlineTone(app.daysLeft);
                        return (
                            <Link
                                key={app.id}
                                href={href(`/write/${app.id}`)}
                                className="border-line-2 hover:bg-panel-2 focus-visible:bg-panel-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t px-4 py-2.5 outline-none first:border-t-0 md:grid-cols-[minmax(0,1fr)_150px_120px_120px_100px]"
                            >
                                <span className="min-w-0">
                                    <span className="text-ink block truncate text-sm font-medium">
                                        {app.title}
                                    </span>
                                    <span className="text-ink-3 block truncate text-xs">
                                        {app.funder ?? "Funder not set"} · moved{" "}
                                        {relativeTime(app.updatedAt)}
                                    </span>
                                </span>
                                <span
                                    className={cn(
                                        "hidden text-xs md:block",
                                        tone === "warn" && "text-warn",
                                        tone === "lost" && "text-danger",
                                        tone === "quiet" && "text-ink-3"
                                    )}
                                >
                                    {OPEN.has(app.status)
                                        ? deadlineWords(app.deadline, app.daysLeft)
                                        : (app.deadline ?? "—")}
                                </span>
                                <span className="hidden md:block">
                                    <ApplicationStatusPill status={app.status} />
                                </span>
                                <span className="text-ink-2 hidden text-xs tabular-nums md:block">
                                    {app.sections.total === 0
                                        ? "none yet"
                                        : `${app.sections.written} of ${app.sections.total} written`}
                                </span>
                                <ReadinessMeter value={app.readiness} />
                            </Link>
                        );
                    })}
                </div>
            )}
            <NewApplicationDialog open={creating} onOpenChange={setCreating} />
        </div>
    );
}
