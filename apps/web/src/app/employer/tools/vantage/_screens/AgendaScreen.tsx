"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { useToolRouter } from "~/components/tool-app/nav";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { useResource } from "~/lib/tools/useResource";
import { Button } from "~/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";
import { useErrorText } from "~/lib/tools/errorText";

import { vantageApi, type AgendaDto, type TopicDto, type VantageAgendaStatus } from "../api";
import { StatusWord } from "../_components/Primitives";
import { AllCaughtUp, DraftingCard, SuggestionMark } from "../_components/Suggestion";
import { AgendaTopicRow, IgnoredTopicRow, TopicSuggestion } from "../_components/TopicCard";
import { DecisionDialog, TopicDialog } from "../_components/TopicDialogs";
import { WeekSteps } from "../_components/WeekSteps";
import {
    commitToNextStep,
    ignoreTopic,
    keepTopic,
    setAside,
    SET_ASIDE_DAYS,
    useOneClick,
} from "../_lib/actions";
import { addDaysIso, useVantageFormat } from "../_lib/format";
import { unhideSuggestion, useHiddenSuggestions } from "../_lib/hidden";
import { vantagePath } from "../_lib/paths";
import { draftedWords, hasMaterial } from "../_lib/suggestions";
import { useAutoDraft } from "../_lib/useAutoDraft";

function isIsoWeek(v: string | null): v is string {
    return Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
}

/**
 * The agenda for one week, in the order the week runs. Vantage's drafted
 * topics wait at the top as suggestions — Add to agenda or Ignore, one
 * click each. What was added is the agenda: numbered, reorderable, shared
 * or private, and each undecided topic carries Vantage's proposed next step
 * as a one-click Commit. Ignored topics fold away with Restore. The next
 * meeting's week drafts itself on arrival when there is no agenda yet;
 * fresh suggestions replace only untouched ones.
 *
 * `week` is the tab's `?week=` (null for the default week by the Thursday
 * rule); the week arrows and past weeks move the tab to another `?week=`.
 */
export function AgendaScreen({ week: weekParam = null }: { week?: string | null }) {
    const errorText = useErrorText();
    const t = useTranslations("vantage.agenda");
    const fmt = useVantageFormat();
    const router = useToolRouter();
    const key = isIsoWeek(weekParam) ? weekParam : "default";
    const res = useResource(`vantage:agenda:${key}`, () =>
        vantageApi.agendas(isIsoWeek(weekParam) ? weekParam : undefined)
    );
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState<TopicDto | null | "new">(null);
    const [deciding, setDeciding] = useState<TopicDto | null>(null);
    const [showIgnored, setShowIgnored] = useState(false);
    const { act, gone } = useOneClick(res.reload);
    const hidden = useHiddenSuggestions();

    const week = res.data?.week ?? weekParam ?? "";
    const agenda = res.data?.agenda ?? null;
    const history = res.data?.agendas ?? [];

    // No agenda: is this the next meeting's week, with something on file to
    // draft from? Then Vantage drafts it now instead of offering a button.
    const missing = Boolean(res.data && !agenda);
    const ov = useResource(missing ? "vantage:overview" : null, () => vantageApi.overview());
    const nextMeeting = ov.data ? ov.data.agendaWeek === week : false;
    const auto = useAutoDraft({
        week: isIsoWeek(week) ? week : null,
        // The overview read comes after the agendas read; if a draft landed in
        // between (This week drafting as you switched tabs), it shows here.
        auto: missing && nextMeeting && Boolean(ov.data && !ov.data.agenda && hasMaterial(ov.data)),
        // Read the agenda back rather than trusting the draft's copy: the read
        // is what this workspace has (the drafting state holds until it lands).
        onDrafted: () => res.reload(),
    });

    // The overview has this week's agenda but the agendas read said none: it
    // landed in between (This week drafting as you switched tabs). Read again.
    const reloadAgenda = res.reload;
    const landedMeanwhile = missing && nextMeeting && Boolean(ov.data?.agenda);
    useEffect(() => {
        if (landedMeanwhile) void reloadAgenda();
    }, [landedMeanwhile, reloadAgenda]);

    const goTo = (w: string) => router.push(vantagePath(`/agenda?week=${w}`));

    const setAgenda = (next: AgendaDto) => res.mutate(c => ({ ...c, agenda: next }));
    const setTopic = (topic: TopicDto) =>
        res.mutate(c =>
            c.agenda
                ? {
                      ...c,
                      agenda: {
                          ...c.agenda,
                          topics: c.agenda.topics.map(x => (x.id === topic.id ? topic : x)),
                      },
                  }
                : c
        );

    const run = async (work: () => Promise<void>, done?: string) => {
        setBusy(true);
        try {
            await work();
            if (done) toast(done);
        } catch (e) {
            toast.error(errorText(e, t("failed")));
        } finally {
            setBusy(false);
        }
    };

    const regenerate = () =>
        run(async () => {
            const { agenda: next } = await vantageApi.prepare(week);
            setAgenda(next);
            void res.reload();
        }, t("regenerated"));

    const patch = (
        topic: TopicDto,
        p: Parameters<typeof vantageApi.patchTopic>[1],
        done?: string
    ) =>
        run(async () => {
            const { topic: next } = await vantageApi.patchTopic(topic.id, p);
            setTopic(next);
        }, done);

    const topics = useMemo(
        () => (agenda ? [...agenda.topics].sort((a, b) => a.position - b.position) : []),
        [agenda]
    );
    const suggested = topics.filter(
        x => x.status === "suggested" && !x.decision && !gone.has(`topic:${x.id}`)
    );
    const kept = topics.filter(x => x.status === "kept");
    const ignored = topics.filter(x => x.status === "dismissed");
    const decided = kept.filter(x => x.decision).length;
    const unsupported = [...suggested, ...kept].reduce(
        (n, x) => n + x.facts.filter(f => f.unsupported).length,
        0
    );

    /** Swap a kept topic with its kept neighbour; suggestions and ignored keep their places. */
    const move = (topic: TopicDto, dir: -1 | 1) =>
        run(async () => {
            if (!agenda) return;
            const i = kept.findIndex(x => x.id === topic.id);
            const other = kept[i + dir];
            if (i < 0 || !other) return;
            const ids = topics.map(x => x.id);
            const a = ids.indexOf(topic.id);
            const b = ids.indexOf(other.id);
            [ids[a], ids[b]] = [ids[b]!, ids[a]!];
            const { agenda: next } = await vantageApi.reorder(agenda.id, ids);
            setAgenda(next);
        });

    const remove = (topic: TopicDto) =>
        run(async () => {
            await vantageApi.deleteTopic(topic.id);
            res.mutate(c =>
                c.agenda
                    ? {
                          ...c,
                          agenda: {
                              ...c.agenda,
                              topics: c.agenda.topics.filter(x => x.id !== topic.id),
                          },
                      }
                    : c
            );
        }, t("deleted"));

    const setStatus = (status: VantageAgendaStatus) =>
        run(
            async () => {
                if (!agenda) return;
                const { agenda: next } = await vantageApi.setAgendaStatus(agenda.id, status);
                setAgenda(next);
                void res.reload();
            },
            t(`marked.${status}`)
        );

    const copyUpdate = (includePrivate: boolean) =>
        run(
            async () => {
                if (!agenda) return;
                const { markdown } = await vantageApi.weeklyUpdate(agenda.id, includePrivate);
                await navigator.clipboard.writeText(markdown);
            },
            includePrivate ? t("copiedPrivate") : t("copiedShared")
        );

    const share = (topic: TopicDto, shared: boolean) =>
        void patch(topic, { shared }, shared ? t("sharedToast") : t("privateToast"));

    const drafted = agenda ? draftedWords(fmt, agenda) : null;
    const sub = agenda ? (
        <span className="inline-flex flex-wrap items-center gap-x-2">
            <span>{fmt.weekRange(agenda.weekStart, agenda.weekEnd)}</span>
            {drafted && (
                <>
                    <span>·</span>
                    <span>{drafted}</span>
                </>
            )}
            <span>·</span>
            <span>
                {t("subCounts", {
                    count: kept.length,
                    decided,
                    shared: kept.filter(topic => topic.shared).length,
                })}
            </span>
        </span>
    ) : isIsoWeek(week) ? (
        fmt.weekRange(week, addDaysIso(week, 6))
    ) : undefined;

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
            <PageHeader
                title={t("title")}
                accent={
                    isIsoWeek(week) ? t("accentWeekOf", { date: fmt.date(week) }) : t("accentWeek")
                }
                sub={sub}
                actions={
                    <>
                        <div className="inline-flex items-center gap-0.5">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                aria-label={t("previousWeek")}
                                onClick={() => goTo(addDaysIso(week, -7))}
                                disabled={!isIsoWeek(week)}
                            >
                                <ChevronLeft className="size-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                aria-label={t("nextWeek")}
                                onClick={() => goTo(addDaysIso(week, 7))}
                                disabled={!isIsoWeek(week)}
                            >
                                <ChevronRight className="size-4" />
                            </Button>
                        </div>
                        {/* Not modal: "Add a topic" opens a dialog, and a modal menu that hands
                            off to a dialog leaves the page unclickable once it closes. */}
                        {agenda && (
                            <DropdownMenu modal={false}>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm" disabled={busy}>
                                        {t("more")}
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onSelect={() => setEditing("new")}>
                                        {t("addTopic")}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => void regenerate()}>
                                        {t("regenerate")}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onSelect={() => void copyUpdate(false)}>
                                        {t("copyShared")}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => void copyUpdate(true)}>
                                        {t("copyPrivate")}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    {agenda.status !== "draft" && (
                                        <DropdownMenuItem onSelect={() => void setStatus("draft")}>
                                            {t("backToDraft")}
                                        </DropdownMenuItem>
                                    )}
                                    {agenda.status !== "ready" && (
                                        <DropdownMenuItem onSelect={() => void setStatus("ready")}>
                                            {t("markReady")}
                                        </DropdownMenuItem>
                                    )}
                                    {agenda.status !== "held" && (
                                        <DropdownMenuItem onSelect={() => void setStatus("held")}>
                                            {t("meetingHeld")}
                                        </DropdownMenuItem>
                                    )}
                                    {agenda.status !== "closed" && (
                                        <DropdownMenuItem onSelect={() => void setStatus("closed")}>
                                            {t("close")}
                                        </DropdownMenuItem>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                        {agenda?.status === "draft" ? (
                            <Button
                                size="sm"
                                onClick={() => void setStatus("ready")}
                                disabled={busy || kept.length === 0}
                            >
                                {t("markReady")}
                            </Button>
                        ) : agenda?.status === "ready" ? (
                            <Button
                                size="sm"
                                onClick={() => void setStatus("held")}
                                disabled={busy}
                            >
                                {t("meetingHeld")}
                            </Button>
                        ) : null}
                    </>
                }
            />

            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}

            {/* Skeleton, not "No agenda", until the overview has answered (useResource
                reports loading=false for the first render after its key turns
                non-null) and while a re-read for a draft that landed is on its way. */}
            {res.loading ||
            (missing && ov.data === null && ov.error === null) ||
            landedMeanwhile ? (
                <SkeletonRows rows={4} height={64} />
            ) : !agenda ? (
                auto.drafting ? (
                    <DraftingCard reading={t("draftingReading")} />
                ) : (
                    <EmptyState
                        title={auto.error ? t("draftFailed") : t("emptyTitle")}
                        body={auto.error ?? t("emptyBody")}
                        action={
                            <>
                                <Button size="sm" onClick={auto.draft} disabled={!res.data}>
                                    {auto.error ? t("tryAgain") : t("draftWeek")}
                                </Button>
                                <Button size="sm" variant="outline" asChild>
                                    <ToolLink href={vantagePath("/evidence")}>
                                        {t("addEvidenceFirst")}
                                    </ToolLink>
                                </Button>
                            </>
                        }
                    />
                )
            ) : (
                <>
                    <WeekSteps agenda={agenda} />

                    {(Boolean(agenda.summary) || unsupported > 0) && (
                        <section
                            aria-label={t("readOnWeek")}
                            className="border-line from-brand-soft rounded-xl border bg-gradient-to-br to-transparent px-5 py-4"
                        >
                            <SuggestionMark>{t("readOnWeek")}</SuggestionMark>
                            {agenda.summary && (
                                <p className="text-ink mt-1.5 max-w-[72ch] text-[14.5px] leading-[1.55]">
                                    {agenda.summary}
                                </p>
                            )}
                            {unsupported > 0 && (
                                <p className="text-warn-ink mt-2 text-[12px]">
                                    {t("unsupported", { count: unsupported })}
                                </p>
                            )}
                        </section>
                    )}

                    {suggested.length > 0 ? (
                        <section aria-label={t("suggestedTitle")}>
                            <SectionHeading
                                title={t("suggestedTitle")}
                                aside={
                                    busy ? (
                                        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                                    ) : (
                                        t("toReview", { count: suggested.length })
                                    )
                                }
                            />
                            <div className="flex flex-col gap-2.5">
                                {suggested.map(topic => (
                                    <TopicSuggestion
                                        key={topic.id}
                                        topic={topic}
                                        busy={busy}
                                        onKeep={() =>
                                            void act(`topic:${topic.id}`, () =>
                                                keepTopic(fmt, topic)
                                            )
                                        }
                                        onIgnore={() =>
                                            void act(`topic:${topic.id}`, () =>
                                                ignoreTopic(fmt, topic)
                                            )
                                        }
                                        onEdit={() => setEditing(topic)}
                                        onDecide={() => setDeciding(topic)}
                                        onDelete={() => void remove(topic)}
                                    />
                                ))}
                            </div>
                        </section>
                    ) : agenda.status === "draft" && kept.length > 0 ? (
                        <AllCaughtUp body={t("caughtUp")} />
                    ) : null}

                    <section aria-label={t("onAgenda")}>
                        <SectionHeading
                            title={t("onAgenda")}
                            aside={
                                kept.length > 0 ? t("ofFive", { count: kept.length }) : undefined
                            }
                        />
                        {kept.length === 0 ? (
                            <p className="text-ink-3 border-line rounded-lg border border-dashed px-4 py-3 text-[13px]">
                                {suggested.length > 0
                                    ? t("emptyAgendaSuggested")
                                    : t("emptyAgenda")}
                            </p>
                        ) : (
                            <div className="border-line bg-panel rounded-lg border">
                                {kept.map((topic, i) => (
                                    <AgendaTopicRow
                                        key={topic.id}
                                        topic={topic}
                                        index={i}
                                        first={i === 0}
                                        last={i === kept.length - 1}
                                        busy={busy || gone.has(`commit:${topic.id}`)}
                                        onCommit={() =>
                                            void act(`commit:${topic.id}`, () =>
                                                commitToNextStep(fmt, topic)
                                            )
                                        }
                                        nextStepHidden={hidden.has(`commit:${topic.id}`)}
                                        onIgnoreNextStep={() =>
                                            void act(`commit:${topic.id}`, () =>
                                                setAside(
                                                    `commit:${topic.id}`,
                                                    SET_ASIDE_DAYS.nextStep,
                                                    t("ignoredOwnWay")
                                                )
                                            )
                                        }
                                        onShowNextStep={() =>
                                            unhideSuggestion(`commit:${topic.id}`)
                                        }
                                        onDecide={() => setDeciding(topic)}
                                        onEdit={() => setEditing(topic)}
                                        onMove={dir => void move(topic, dir)}
                                        onShare={shared => share(topic, shared)}
                                        onIgnore={() =>
                                            void act(`topic:${topic.id}`, () =>
                                                ignoreTopic(fmt, topic)
                                            )
                                        }
                                        onDelete={() => void remove(topic)}
                                    />
                                ))}
                            </div>
                        )}
                        <div className="mt-2 flex gap-2">
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditing("new")}
                                disabled={busy}
                            >
                                <Plus aria-hidden="true" />
                                {t("writeTopic")}
                            </Button>
                        </div>
                    </section>

                    {ignored.length > 0 && (
                        <section aria-label={t("ignored")}>
                            <button
                                type="button"
                                onClick={() => setShowIgnored(o => !o)}
                                aria-expanded={showIgnored}
                                className="text-ink-2 hover:text-ink focus-visible:ring-brand/50 mb-2 inline-flex items-center gap-1.5 rounded-sm text-[13px] font-semibold outline-none focus-visible:ring-2"
                            >
                                {t("ignored")}
                                <span className="text-ink-3 text-xs font-normal">
                                    {t("topics", { count: ignored.length })}
                                </span>
                                <ChevronDown
                                    className={cn(
                                        "size-3.5 transition-transform motion-reduce:transition-none",
                                        showIgnored && "rotate-180"
                                    )}
                                    aria-hidden="true"
                                />
                            </button>
                            {showIgnored && (
                                <div className="border-line bg-panel rounded-lg border">
                                    {ignored.map(topic => (
                                        <IgnoredTopicRow
                                            key={topic.id}
                                            topic={topic}
                                            busy={busy}
                                            onRestore={() =>
                                                void patch(topic, { status: "kept" }, t("restored"))
                                            }
                                            onDelete={() => void remove(topic)}
                                        />
                                    ))}
                                </div>
                            )}
                        </section>
                    )}
                </>
            )}

            {history.length > 0 && (
                <section>
                    <SectionHeading title={t("pastWeeks")} />
                    <div className="border-line bg-panel rounded-lg border">
                        {history.map(h => (
                            <ToolLink
                                key={h.id}
                                href={vantagePath(`/agenda?week=${h.weekStart}`)}
                                aria-current={h.weekStart === week ? "true" : undefined}
                                className="border-line-2 hover:bg-panel-2 focus-visible:ring-brand/50 flex min-h-10 items-center gap-3 border-t px-4 py-2 outline-none first:border-t-0 focus-visible:ring-[3px]"
                            >
                                <span className="text-ink @max-sm:w-28 w-40 text-[13px] font-medium">
                                    {fmt.weekRange(h.weekStart, h.weekEnd)}
                                </span>
                                <span className="text-ink-3 text-[12px]">
                                    {t("pastCounts", {
                                        count: h.topicCount,
                                        decided: h.decidedCount,
                                    })}
                                </span>
                                <StatusWord
                                    className="ml-auto"
                                    tone={
                                        h.status === "draft"
                                            ? "neutral"
                                            : h.status === "ready"
                                              ? "brand"
                                              : "success"
                                    }
                                >
                                    {t(`status.${h.status}`)}
                                </StatusWord>
                            </ToolLink>
                        ))}
                    </div>
                </section>
            )}

            {agenda && (
                <TopicDialog
                    open={editing !== null}
                    onOpenChange={o => !o && setEditing(null)}
                    agendaId={agenda.id}
                    initial={editing === "new" ? null : editing}
                    onSaved={topic => {
                        if (editing === "new")
                            res.mutate(c =>
                                c.agenda
                                    ? {
                                          ...c,
                                          agenda: {
                                              ...c.agenda,
                                              topics: [...c.agenda.topics, topic],
                                          },
                                      }
                                    : c
                            );
                        else setTopic(topic);
                    }}
                />
            )}
            <DecisionDialog
                open={deciding !== null}
                onOpenChange={o => !o && setDeciding(null)}
                topic={deciding}
                onSaved={topic => {
                    setTopic(topic);
                    void res.reload();
                }}
            />
        </div>
    );
}
