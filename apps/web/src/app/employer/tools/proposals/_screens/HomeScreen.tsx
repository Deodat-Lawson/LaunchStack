"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { plural, relativeTime } from "~/lib/tools/format";
import { useResource } from "~/lib/tools/useResource";
import { NewApplicationDialog } from "../_components/NewApplicationDialog";
import { ApplicationStatusPill, ReadinessMeter } from "../_components/Pills";
import { useProposals } from "../_lib/context";
import { amountWords, closeWords, deadlineTone, deadlineWords } from "../_lib/words";
import { proposalsApi, type ApplicationRow } from "../api";

function ApplicationLine({ app, href }: { app: ApplicationRow; href: string }) {
    const tone = deadlineTone(app.daysLeft);
    return (
        <Link
            href={href}
            className="border-line-2 hover:bg-panel-2 focus-visible:bg-panel-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t px-4 py-2.5 outline-none first:border-t-0 md:grid-cols-[minmax(0,1fr)_140px_120px_auto]"
        >
            <span className="min-w-0">
                <span className="text-ink block truncate text-sm font-medium">{app.title}</span>
                <span className="text-ink-3 block truncate text-xs">
                    {app.funder ?? "Funder not set"}
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
                {deadlineWords(app.deadline, app.daysLeft)}
            </span>
            <span className="hidden md:block">
                <ApplicationStatusPill status={app.status} />
            </span>
            <ReadinessMeter value={app.readiness} />
        </Link>
    );
}

/**
 * The week at a glance: what to do next, what is due, what is in flight,
 * and which funders are worth a look. No tiles; short lists and the two
 * things to do next.
 */
export function HomeScreen() {
    const { href, finishedTick, trackRun } = useProposals();
    const home = useResource("proposals:home", () => proposalsApi.home());
    const [creating, setCreating] = useState(false);
    const reload = home.reload;
    useEffect(() => {
        if (finishedTick > 0) void reload();
    }, [finishedTick, reload]);

    const d = home.data;
    const buildProfile = async () => {
        try {
            const { run } = await proposalsApi.buildProfile();
            trackRun(run);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not start building the profile");
        }
    };

    const sub = d
        ? [
              plural(d.deadlines.length + d.inProgress.length, "application") + " open",
              plural(d.funders.saved, "funder") + " saved",
              d.profile.status === "ready"
                  ? `profile built ${relativeTime(d.profile.builtAt)}`
                  : "no profile yet",
          ].join(" · ")
        : undefined;

    return (
        <div className="mx-auto flex max-w-[1080px] flex-col gap-7">
            <PageHeader
                title="Your proposals,"
                accent="this week"
                sub={sub ?? <Skeleton className="h-3 w-64" />}
                actions={
                    <>
                        <Button variant="outline" size="sm" asChild>
                            <Link href={href("/funders")}>Find funders</Link>
                        </Button>
                        <Button size="sm" onClick={() => setCreating(true)}>
                            New application
                        </Button>
                    </>
                }
            />
            {home.error && <InlineError message={home.error} onRetry={() => void home.reload()} />}

            <section>
                <SectionHeading
                    title="To do"
                    aside={d ? plural(d.todo.length, "item") : undefined}
                />
                {home.loading ? (
                    <SkeletonRows rows={3} height={56} />
                ) : d && d.todo.length === 0 ? (
                    <EmptyState
                        title="Nothing waiting on you"
                        body="Deadlines this week, strong-fit funders and unwritten sections show up here."
                    />
                ) : (
                    <div className="border-line bg-panel overflow-hidden rounded-lg border">
                        {d?.todo.map(item => (
                            <div
                                key={item.id}
                                className="border-line-2 flex items-center gap-4 border-t px-4 py-3 first:border-t-0"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="text-ink text-sm font-medium">{item.title}</div>
                                    <div className="text-ink-3 truncate text-xs">{item.detail}</div>
                                </div>
                                {item.id === "profile" ? (
                                    <Button size="sm" onClick={() => void buildProfile()}>
                                        Build profile
                                    </Button>
                                ) : (
                                    <Button variant="outline" size="sm" asChild>
                                        <Link href={item.action.href}>{item.action.label}</Link>
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section>
                <SectionHeading
                    title="Deadlines"
                    aside={d && d.deadlines.length > 0 ? "nearest first" : undefined}
                />
                {home.loading ? (
                    <SkeletonRows rows={3} height={52} />
                ) : d && d.deadlines.length === 0 ? (
                    <EmptyState
                        title="No dated applications"
                        body="An application with a deadline lists here, nearest first."
                        action={
                            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                                New application
                            </Button>
                        }
                    />
                ) : (
                    <div className="border-line bg-panel overflow-hidden rounded-lg border">
                        {d?.deadlines.map(app => (
                            <ApplicationLine
                                key={app.id}
                                app={app}
                                href={href(`/write/${app.id}`)}
                            />
                        ))}
                    </div>
                )}
            </section>

            <div className="grid grid-cols-1 gap-7 lg:grid-cols-2">
                <section className="min-w-0">
                    <SectionHeading title="In progress" aside="no deadline this week" />
                    {home.loading ? (
                        <SkeletonRows rows={3} height={52} />
                    ) : d && d.inProgress.length === 0 ? (
                        <p className="text-ink-3 text-[13px]">Nothing else in flight.</p>
                    ) : (
                        <div className="border-line bg-panel overflow-hidden rounded-lg border">
                            {d?.inProgress.map(app => (
                                <ApplicationLine
                                    key={app.id}
                                    app={app}
                                    href={href(`/write/${app.id}`)}
                                />
                            ))}
                        </div>
                    )}
                </section>
                <section className="min-w-0">
                    <SectionHeading
                        title="Funders worth a look"
                        aside={
                            d
                                ? `${d.funders.strong} strong of ${d.funders.candidates} found`
                                : undefined
                        }
                    />
                    {home.loading ? (
                        <SkeletonRows rows={3} height={52} />
                    ) : d && d.funders.top.length === 0 ? (
                        <EmptyState
                            title="No funders found yet"
                            body={
                                d.profile.status === "ready"
                                    ? "Search Grants.gov and the web for calls that fit your profile."
                                    : "Build your profile first; the search is planned from it."
                            }
                            action={
                                <Button size="sm" variant="outline" asChild>
                                    <Link href={href("/funders")}>Find funders</Link>
                                </Button>
                            }
                        />
                    ) : (
                        <div className="border-line bg-panel overflow-hidden rounded-lg border">
                            {d?.funders.top.map(f => (
                                <Link
                                    key={f.id}
                                    href={href("/funders")}
                                    className="border-line-2 hover:bg-panel-2 focus-visible:bg-panel-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t px-4 py-2.5 outline-none first:border-t-0"
                                >
                                    <span className="min-w-0">
                                        <span className="text-ink block truncate text-sm font-medium">
                                            {f.title}
                                        </span>
                                        <span className="text-ink-3 block truncate text-xs">
                                            {f.funder} · {closeWords(f.closesOn, f.daysLeft)}
                                            {amountWords(f.amountMin, f.amountMax)
                                                ? ` · ${amountWords(f.amountMin, f.amountMax)}`
                                                : ""}
                                        </span>
                                    </span>
                                    <span className="text-ink text-xs font-medium tabular-nums">
                                        {f.fit === null ? "—" : `fit ${f.fit}`}
                                    </span>
                                </Link>
                            ))}
                        </div>
                    )}
                </section>
            </div>

            {d && d.profile.status === "ready" && (
                <p className="text-ink-3 max-w-[70ch] text-[13px]">
                    Every draft starts from your profile: {plural(d.profile.facts, "fact")} from{" "}
                    {plural(d.profile.documents, "source")}, built {relativeTime(d.profile.builtAt)}
                    .{" "}
                    <Link href={href("/profile")} className="text-brand-ink hover:underline">
                        Review it
                    </Link>{" "}
                    after you add reports or proposals.
                </p>
            )}
            <NewApplicationDialog open={creating} onOpenChange={setCreating} />
        </div>
    );
}
