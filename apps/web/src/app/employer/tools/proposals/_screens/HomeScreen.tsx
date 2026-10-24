"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { useToolRouter } from "~/components/tool-app/nav";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { companyProfileApi } from "~/lib/company-profile/api";
import { cn } from "~/lib/utils";

import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { useToolFormat } from "~/lib/tools/format";
import { useResource } from "~/lib/tools/useResource";
import { useErrorText } from "~/lib/tools/errorText";
import { NewApplicationDialog } from "../_components/NewApplicationDialog";
import { ApplicationStatusPill, ReadinessMeter } from "../_components/Pills";
import { useProposals } from "../_lib/context";
import { amountWords, closeWords, deadlineTone, deadlineWords } from "../_lib/words";
import { proposalsApi, type ApplicationRow, type TodoItem } from "../api";

function ApplicationLine({
    app,
    href,
    compact = false,
}: {
    app: ApplicationRow;
    href: string;
    /** In a half-width panel: deadline and status fold into the second line. */
    compact?: boolean;
}) {
    const tp = useTranslations("proposals.common");
    const tWords = useTranslations("proposals.words");
    const tone = deadlineTone(app.daysLeft);
    const deadline = deadlineWords(tWords, app.deadline, app.daysLeft);
    return (
        <ToolLink
            href={href}
            className={cn(
                "border-line-2 hover:bg-panel-2 focus-visible:bg-panel-2 grid items-center gap-4 border-t px-4 py-2.5 outline-none first:border-t-0",
                compact
                    ? "grid-cols-[minmax(0,1fr)_auto]"
                    : "@max-md:grid-cols-[minmax(0,1fr)_auto] grid-cols-[minmax(0,1fr)_140px_120px_auto]"
            )}
        >
            <span className="min-w-0">
                <span className="text-ink block truncate text-sm font-medium">{app.title}</span>
                <span className="text-ink-3 block truncate text-xs">
                    {app.funder ?? tp("funderNotSet")}
                    {compact && (
                        <>
                            {" · "}
                            <span
                                className={cn(
                                    tone === "warn" && "text-warn-ink",
                                    tone === "lost" && "text-danger"
                                )}
                            >
                                {deadline}
                            </span>
                        </>
                    )}
                </span>
            </span>
            {!compact && (
                <span
                    className={cn(
                        "@max-md:hidden text-xs",
                        tone === "warn" && "text-warn-ink",
                        tone === "lost" && "text-danger",
                        tone === "quiet" && "text-ink-3"
                    )}
                >
                    {deadline}
                </span>
            )}
            {!compact && (
                <span className="@max-md:hidden">
                    <ApplicationStatusPill status={app.status} />
                </span>
            )}
            <ReadinessMeter value={app.readiness} />
        </ToolLink>
    );
}

/**
 * The week at a glance: what to do next, what is due, what is in flight,
 * and which funders are worth a look. No tiles; short lists and the two
 * things to do next.
 */
export function HomeScreen() {
    const t = useTranslations("proposals.home");
    const errorText = useErrorText();
    const tp = useTranslations("proposals.common");
    const tWords = useTranslations("proposals.words");
    const format = useToolFormat();
    const { href, finishedTick } = useProposals();
    const router = useToolRouter();
    const home = useResource("proposals:home", () => proposalsApi.home());
    const [creating, setCreating] = useState(false);
    const reload = home.reload;
    useEffect(() => {
        if (finishedTick > 0) void reload();
    }, [finishedTick, reload]);

    const d = home.data;
    // The profile is the shared company profile now: start it reading, then
    // show it, where the build's progress and what it sets aside are visible.
    const buildProfile = async () => {
        try {
            await companyProfileApi.rebuild();
            router.push(href("/profile"));
        } catch (e) {
            toast.error(errorText(e, t("buildProfileFailed")));
        }
    };

    const sub = d
        ? [
              t("subOpen", { count: d.deadlines.length + d.inProgress.length }),
              t("subSaved", { count: d.funders.saved }),
              d.profile.status === "ready"
                  ? t("subProfileBuilt", { time: format.relativeTime(d.profile.builtAt) })
                  : t("subNoProfile"),
          ].join(" · ")
        : undefined;

    return (
        <div className="mx-auto flex max-w-[1080px] flex-col gap-7">
            <PageHeader
                title={t("title")}
                accent={t("accent")}
                sub={sub ?? <Skeleton className="h-3 w-64" />}
                actions={
                    <>
                        <Button variant="outline" size="sm" asChild>
                            <ToolLink href={href("/funders")}>{tp("findFunders")}</ToolLink>
                        </Button>
                        <Button size="sm" onClick={() => setCreating(true)}>
                            {tp("newApplication")}
                        </Button>
                    </>
                }
            />
            {home.error && <InlineError message={home.error} onRetry={() => void home.reload()} />}

            <section>
                <SectionHeading
                    title={t("todo")}
                    aside={d ? t("todoCount", { count: d.todo.length }) : undefined}
                />
                {home.loading ? (
                    <SkeletonRows rows={3} height={56} />
                ) : d && d.todo.length === 0 ? (
                    <EmptyState title={t("nothingWaiting")} body={t("nothingWaitingBody")} />
                ) : (
                    <div className="border-line bg-panel overflow-hidden rounded-lg border">
                        {d?.todo.map(item => (
                            <div
                                key={item.id}
                                className="border-line-2 flex items-center gap-4 border-t px-4 py-3 first:border-t-0"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="text-ink text-sm font-medium">
                                        {todoText(t, item).title}
                                    </div>
                                    <div className="text-ink-3 truncate text-xs">
                                        {todoText(t, item).detail}
                                    </div>
                                </div>
                                {item.id === "profile" ? (
                                    <Button size="sm" onClick={() => void buildProfile()}>
                                        {t("buildProfile")}
                                    </Button>
                                ) : (
                                    // The server still builds the old page URLs
                                    // (/employer/tools/proposals/write/12); ToolLink
                                    // resolves them to the screen in this tab.
                                    <Button variant="outline" size="sm" asChild>
                                        <ToolLink href={item.action.href}>
                                            {todoText(t, item).action}
                                        </ToolLink>
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section>
                <SectionHeading
                    title={t("deadlines")}
                    aside={d && d.deadlines.length > 0 ? t("nearestFirst") : undefined}
                />
                {home.loading ? (
                    <SkeletonRows rows={3} height={52} />
                ) : d && d.deadlines.length === 0 ? (
                    <EmptyState
                        title={t("noDated")}
                        body={t("noDatedBody")}
                        action={
                            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                                {tp("newApplication")}
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

            <div className="@max-lg:grid-cols-1 grid grid-cols-2 gap-7">
                <section className="min-w-0">
                    <SectionHeading title={t("inProgress")} aside={t("noDeadlineThisWeek")} />
                    {home.loading ? (
                        <SkeletonRows rows={3} height={52} />
                    ) : d && d.inProgress.length === 0 ? (
                        <p className="text-ink-3 text-[13px]">{t("nothingElse")}</p>
                    ) : (
                        <div className="border-line bg-panel overflow-hidden rounded-lg border">
                            {d?.inProgress.map(app => (
                                <ApplicationLine
                                    key={app.id}
                                    app={app}
                                    href={href(`/write/${app.id}`)}
                                    compact
                                />
                            ))}
                        </div>
                    )}
                </section>
                <section className="min-w-0">
                    <SectionHeading
                        title={t("fundersWorth")}
                        aside={
                            d
                                ? t("strongOf", {
                                      strong: d.funders.strong,
                                      candidates: d.funders.candidates,
                                  })
                                : undefined
                        }
                    />
                    {home.loading ? (
                        <SkeletonRows rows={3} height={52} />
                    ) : d && d.funders.top.length === 0 ? (
                        <EmptyState
                            title={t("noFunders")}
                            body={
                                d.profile.status === "ready"
                                    ? t("noFundersReady")
                                    : t("noFundersNoProfile")
                            }
                            action={
                                <Button size="sm" variant="outline" asChild>
                                    <ToolLink href={href("/funders")}>{tp("findFunders")}</ToolLink>
                                </Button>
                            }
                        />
                    ) : (
                        <div className="border-line bg-panel overflow-hidden rounded-lg border">
                            {d?.funders.top.map(f => (
                                <ToolLink
                                    key={f.id}
                                    href={href("/funders")}
                                    className="border-line-2 hover:bg-panel-2 focus-visible:bg-panel-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t px-4 py-2.5 outline-none first:border-t-0"
                                >
                                    <span className="min-w-0">
                                        <span className="text-ink block truncate text-sm font-medium">
                                            {f.title}
                                        </span>
                                        <span className="text-ink-3 block truncate text-xs">
                                            {f.funder} ·{" "}
                                            {closeWords(tWords, f.closesOn, f.daysLeft)}
                                            {amountWords(tWords, f.amountMin, f.amountMax)
                                                ? ` · ${amountWords(tWords, f.amountMin, f.amountMax)}`
                                                : ""}
                                        </span>
                                    </span>
                                    <span className="text-ink text-xs font-medium tabular-nums">
                                        {f.fit === null ? "—" : t("fit", { fit: f.fit })}
                                    </span>
                                </ToolLink>
                            ))}
                        </div>
                    )}
                </section>
            </div>

            {d && d.profile.status === "ready" && (
                <p className="text-ink-3 max-w-[70ch] text-[13px]">
                    {t.rich("profileNote", {
                        facts: d.profile.facts,
                        documents: d.profile.documents,
                        time: format.relativeTime(d.profile.builtAt),
                        link: chunks => (
                            <ToolLink
                                href={href("/profile")}
                                className="text-brand-ink hover:underline"
                            >
                                {chunks}
                            </ToolLink>
                        ),
                    })}
                </p>
            )}
            <NewApplicationDialog open={creating} onOpenChange={setCreating} />
        </div>
    );
}

type HomeTranslator = ReturnType<typeof useTranslations<"proposals.home">>;

/** A to-do item in the reader's language; the server's English when it sent no copy. */
function todoText(
    t: HomeTranslator,
    item: TodoItem
): { title: string; detail: string; action: string } {
    const copy = item.copy;
    if (!copy) return { title: item.title, detail: item.detail, action: item.action.label };
    switch (copy.key) {
        case "profile":
            return {
                title: t("todoItems.profile.title"),
                detail: t("todoItems.profile.detail", { sources: copy.sources }),
                action: t("todoItems.profile.action"),
            };
        case "deadline":
            return {
                title:
                    copy.daysLeft < 0
                        ? t("todoItems.deadline.pastTitle", { application: copy.application })
                        : t("todoItems.deadline.title", {
                              application: copy.application,
                              daysLeft: copy.daysLeft,
                          }),
                detail: t("todoItems.deadline.detail", {
                    readiness: copy.readiness,
                    written: copy.written,
                    total: copy.total,
                    blockers: copy.blockers,
                }),
                action: t("todoItems.deadline.action"),
            };
        case "funders":
            return {
                title: t("todoItems.funders.title", { count: copy.count }),
                // The funders' own names.
                detail: item.detail,
                action: t("todoItems.funders.action"),
            };
        case "sections":
            return {
                title: t("todoItems.sections.title", {
                    count: copy.count,
                    application: copy.application,
                }),
                detail: copy.funder ?? t("todoItems.sections.noFunder"),
                action: t("todoItems.sections.action"),
            };
    }
}
