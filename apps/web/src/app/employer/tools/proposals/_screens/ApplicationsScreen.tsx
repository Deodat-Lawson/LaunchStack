"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { cn } from "~/lib/utils";

import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { useToolFormat } from "~/lib/tools/format";
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
    const t = useTranslations("proposals.applications");
    const tp = useTranslations("proposals.common");
    const tWords = useTranslations("proposals.words");
    const format = useToolFormat();
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
                title={t("title")}
                accent={t("accent")}
                sub={
                    res.data
                        ? t("sub", { open: openCount, closed: all.length - openCount })
                        : undefined
                }
                actions={
                    <Button size="sm" onClick={() => setCreating(true)}>
                        {tp("newApplication")}
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
                <ToggleGroupItem value="open">{t("views.open")}</ToggleGroupItem>
                <ToggleGroupItem value="closed">{t("views.closed")}</ToggleGroupItem>
                <ToggleGroupItem value="all">{t("views.all")}</ToggleGroupItem>
            </ToggleGroup>

            {res.loading ? (
                <SkeletonRows rows={5} height={52} />
            ) : rows.length === 0 ? (
                <EmptyState
                    title={all.length === 0 ? t("emptyTitle") : tp("nothingInView")}
                    body={all.length === 0 ? t("emptyBody") : t("emptyViewBody")}
                    action={
                        all.length === 0 ? (
                            <Button size="sm" onClick={() => setCreating(true)}>
                                {tp("newApplication")}
                            </Button>
                        ) : undefined
                    }
                />
            ) : (
                <div className="border-line bg-panel overflow-hidden rounded-lg border">
                    <div className="text-ink-3 border-line-2 @max-lg:grid-cols-[minmax(0,1fr)_130px_120px_100px] @max-md:hidden grid grid-cols-[minmax(0,1fr)_150px_120px_120px_100px] gap-4 border-b px-4 py-2 text-xs">
                        <span>{t("columns.application")}</span>
                        <span>{t("columns.deadline")}</span>
                        <span>{t("columns.status")}</span>
                        <span className="@max-lg:hidden">{t("columns.sections")}</span>
                        <span>{t("columns.ready")}</span>
                    </div>
                    {rows.map(app => {
                        const tone = deadlineTone(app.daysLeft);
                        return (
                            <ToolLink
                                key={app.id}
                                href={href(`/write/${app.id}`)}
                                className="border-line-2 hover:bg-panel-2 focus-visible:bg-panel-2 @max-lg:grid-cols-[minmax(0,1fr)_130px_120px_100px] @max-md:grid-cols-[minmax(0,1fr)_auto] grid grid-cols-[minmax(0,1fr)_150px_120px_120px_100px] items-center gap-4 border-t px-4 py-2.5 outline-none first:border-t-0"
                            >
                                <span className="min-w-0">
                                    <span className="text-ink block truncate text-sm font-medium">
                                        {app.title}
                                    </span>
                                    <span className="text-ink-3 block truncate text-xs">
                                        {t("moved", {
                                            funder: app.funder ?? tp("funderNotSet"),
                                            time: format.relativeTime(app.updatedAt),
                                        })}
                                    </span>
                                </span>
                                <span
                                    className={cn(
                                        "@max-md:hidden text-xs",
                                        tone === "warn" && "text-warn-ink",
                                        tone === "lost" && "text-danger",
                                        tone === "quiet" && "text-ink-3"
                                    )}
                                >
                                    {OPEN.has(app.status)
                                        ? deadlineWords(tWords, app.deadline, app.daysLeft)
                                        : (app.deadline ?? "—")}
                                </span>
                                <span className="@max-md:hidden">
                                    <ApplicationStatusPill status={app.status} />
                                </span>
                                <span className="text-ink-2 @max-lg:hidden text-xs tabular-nums">
                                    {app.sections.total === 0
                                        ? t("noSections")
                                        : t("sectionsWritten", {
                                              written: app.sections.written,
                                              total: app.sections.total,
                                          })}
                                </span>
                                <ReadinessMeter value={app.readiness} />
                            </ToolLink>
                        );
                    })}
                </div>
            )}
            <NewApplicationDialog open={creating} onOpenChange={setCreating} />
        </div>
    );
}
