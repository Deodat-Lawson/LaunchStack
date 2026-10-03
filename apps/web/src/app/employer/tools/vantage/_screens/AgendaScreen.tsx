"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { useMemo, useState } from "react";
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

import { vantageApi, type AgendaDto, type TopicDto, type VantageAgendaStatus } from "../api";
import { StatusWord } from "../_components/Primitives";
import { AllCaughtUp, DraftingCard, SuggestionMark } from "../_components/Suggestion";
import { AgendaTopicRow, IgnoredTopicRow, TopicSuggestion } from "../_components/TopicCard";
import { DecisionDialog, TopicDialog } from "../_components/TopicDialogs";
import { WeekSteps } from "../_components/WeekSteps";
import { commitToNextStep, ignoreTopic, keepTopic, useOneClick } from "../_lib/actions";
import { addDaysIso, fmtDate, plural, weekRange } from "../_lib/format";
import { vantagePath } from "../_lib/paths";
import { draftedWords, hasMaterial } from "../_lib/suggestions";
import { useAutoDraft } from "../_lib/useAutoDraft";

const STATUS_WORD: Record<VantageAgendaStatus, string> = {
    draft: "Draft",
    ready: "Ready for the meeting",
    held: "Meeting held",
    closed: "Closed",
};

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
        auto: missing && nextMeeting && Boolean(ov.data && hasMaterial(ov.data)),
        onDrafted: next => {
            setAgenda(next);
            void res.reload();
        },
    });

    const goTo = (w: string) => router.push(vantagePath(`/agenda?week=${w}`));

    const setAgenda = (next: AgendaDto) => res.mutate(c => ({ ...c, agenda: next }));
    const setTopic = (topic: TopicDto) =>
        res.mutate(c =>
            c.agenda
                ? {
                      ...c,
                      agenda: {
                          ...c.agenda,
                          topics: c.agenda.topics.map(t => (t.id === topic.id ? topic : t)),
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
            toast.error(e instanceof Error ? e.message : "That did not work");
        } finally {
            setBusy(false);
        }
    };

    const regenerate = () =>
        run(async () => {
            const { agenda: next } = await vantageApi.prepare(week);
            setAgenda(next);
            void res.reload();
        }, "Fresh suggestions — your kept and edited topics stayed");

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
        t => t.status === "suggested" && !t.decision && !gone.has(`topic:${t.id}`)
    );
    const kept = topics.filter(t => t.status === "kept");
    const ignored = topics.filter(t => t.status === "dismissed");
    const decided = kept.filter(t => t.decision).length;
    const unsupported = [...suggested, ...kept].reduce(
        (n, t) => n + t.facts.filter(f => f.unsupported).length,
        0
    );

    /** Swap a kept topic with its kept neighbour; suggestions and ignored keep their places. */
    const move = (topic: TopicDto, dir: -1 | 1) =>
        run(async () => {
            if (!agenda) return;
            const i = kept.findIndex(t => t.id === topic.id);
            const other = kept[i + dir];
            if (i < 0 || !other) return;
            const ids = topics.map(t => t.id);
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
                              topics: c.agenda.topics.filter(t => t.id !== topic.id),
                          },
                      }
                    : c
            );
        }, "Topic deleted");

    const setStatus = (status: VantageAgendaStatus) =>
        run(async () => {
            if (!agenda) return;
            const { agenda: next } = await vantageApi.setAgendaStatus(agenda.id, status);
            setAgenda(next);
            void res.reload();
        }, `Agenda marked ${STATUS_WORD[status].toLowerCase()}`);

    const copyUpdate = (includePrivate: boolean) =>
        run(
            async () => {
                if (!agenda) return;
                const { markdown } = await vantageApi.weeklyUpdate(agenda.id, includePrivate);
                await navigator.clipboard.writeText(markdown);
            },
            includePrivate
                ? "Your private copy is on the clipboard"
                : "Shared update copied — paste it anywhere"
        );

    const share = (t: TopicDto, shared: boolean) =>
        void patch(t, { shared }, shared ? "Shared with the program" : "Made private");

    const drafted = agenda ? draftedWords(agenda) : null;
    const sub = agenda ? (
        <span className="inline-flex flex-wrap items-center gap-x-2">
            <span>{weekRange(agenda.weekStart, agenda.weekEnd)}</span>
            {drafted && (
                <>
                    <span>·</span>
                    <span>{drafted}</span>
                </>
            )}
            <span>·</span>
            <span>
                {plural(kept.length, "topic")} on the agenda, {decided} decided,{" "}
                {kept.filter(t => t.shared).length} shared
            </span>
        </span>
    ) : isIsoWeek(week) ? (
        weekRange(week, addDaysIso(week, 6))
    ) : undefined;

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
            <PageHeader
                title="The agenda for the"
                accent={isIsoWeek(week) ? `week of ${fmtDate(week)}` : "week"}
                sub={sub}
                actions={
                    <>
                        <div className="inline-flex items-center gap-0.5">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                aria-label="Previous week"
                                onClick={() => goTo(addDaysIso(week, -7))}
                                disabled={!isIsoWeek(week)}
                            >
                                <ChevronLeft className="size-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                aria-label="Next week"
                                onClick={() => goTo(addDaysIso(week, 7))}
                                disabled={!isIsoWeek(week)}
                            >
                                <ChevronRight className="size-4" />
                            </Button>
                        </div>
                        {agenda && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm" disabled={busy}>
                                        More
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onSelect={() => setEditing("new")}>
                                        Add a topic
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => void regenerate()}>
                                        Ask Vantage for fresh suggestions
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onSelect={() => void copyUpdate(false)}>
                                        Copy weekly update (shared)
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => void copyUpdate(true)}>
                                        Copy my private copy
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    {agenda.status !== "draft" && (
                                        <DropdownMenuItem onSelect={() => void setStatus("draft")}>
                                            Back to draft
                                        </DropdownMenuItem>
                                    )}
                                    {agenda.status !== "ready" && (
                                        <DropdownMenuItem onSelect={() => void setStatus("ready")}>
                                            Mark ready
                                        </DropdownMenuItem>
                                    )}
                                    {agenda.status !== "held" && (
                                        <DropdownMenuItem onSelect={() => void setStatus("held")}>
                                            Meeting held
                                        </DropdownMenuItem>
                                    )}
                                    {agenda.status !== "closed" && (
                                        <DropdownMenuItem onSelect={() => void setStatus("closed")}>
                                            Close
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
                                Mark ready
                            </Button>
                        ) : agenda?.status === "ready" ? (
                            <Button
                                size="sm"
                                onClick={() => void setStatus("held")}
                                disabled={busy}
                            >
                                Meeting held
                            </Button>
                        ) : null}
                    </>
                }
            />

            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}

            {res.loading || (missing && ov.loading) ? (
                <SkeletonRows rows={4} height={64} />
            ) : !agenda ? (
                auto.drafting ? (
                    <DraftingCard reading="Reading the evidence, numbers and open commitments on file. The topics land here as suggestions." />
                ) : (
                    <EmptyState
                        title={
                            auto.error
                                ? "Vantage could not draft this week"
                                : "No agenda for this week"
                        }
                        body={
                            auto.error ??
                            "Vantage drafts three to five topics from the evidence, numbers and open commitments on file — each with what happened, its sources, why it matters, the decision to make and a next step — and brings them here as suggestions for you to take or ignore."
                        }
                        action={
                            <>
                                <Button size="sm" onClick={auto.draft} disabled={!res.data}>
                                    {auto.error ? "Try again" : "Draft this week"}
                                </Button>
                                <Button size="sm" variant="outline" asChild>
                                    <ToolLink href={vantagePath("/evidence")}>
                                        Add evidence first
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
                            aria-label="Vantage's read on the week"
                            className="border-line from-brand-soft rounded-xl border bg-gradient-to-br to-transparent px-5 py-4"
                        >
                            <SuggestionMark>Vantage&apos;s read on the week</SuggestionMark>
                            {agenda.summary && (
                                <p className="text-ink mt-1.5 max-w-[72ch] text-[14.5px] leading-[1.55]">
                                    {agenda.summary}
                                </p>
                            )}
                            {unsupported > 0 && (
                                <p className="text-warn mt-2 text-[12px]">
                                    {plural(unsupported, "fact")} without a source on file — open
                                    Details on a topic to see which.
                                </p>
                            )}
                        </section>
                    )}

                    {suggested.length > 0 ? (
                        <section aria-label="Suggested by Vantage">
                            <SectionHeading
                                title="Suggested by Vantage"
                                aside={
                                    busy ? (
                                        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                                    ) : (
                                        `${plural(suggested.length, "topic")} to review`
                                    )
                                }
                            />
                            <div className="flex flex-col gap-2.5">
                                {suggested.map(t => (
                                    <TopicSuggestion
                                        key={t.id}
                                        topic={t}
                                        busy={busy}
                                        onKeep={() => void act(`topic:${t.id}`, () => keepTopic(t))}
                                        onIgnore={() =>
                                            void act(`topic:${t.id}`, () => ignoreTopic(t))
                                        }
                                        onEdit={() => setEditing(t)}
                                        onDecide={() => setDeciding(t)}
                                        onShare={shared => share(t, shared)}
                                        onDelete={() => void remove(t)}
                                    />
                                ))}
                            </div>
                        </section>
                    ) : agenda.status === "draft" && kept.length > 0 ? (
                        <AllCaughtUp body="Every suggestion is answered. Mark the agenda ready when it says what the meeting should decide." />
                    ) : null}

                    <section aria-label="On the agenda">
                        <SectionHeading
                            title="On the agenda"
                            aside={kept.length > 0 ? `${kept.length} of 5` : undefined}
                        />
                        {kept.length === 0 ? (
                            <p className="text-ink-3 border-line rounded-lg border border-dashed px-4 py-3 text-[13px]">
                                {suggested.length > 0
                                    ? "Nothing yet. Add Vantage's suggestions above, or write a topic of your own."
                                    : "Nothing on the agenda. Ask Vantage for fresh suggestions from the More menu, or write a topic of your own."}
                            </p>
                        ) : (
                            <div className="border-line bg-panel rounded-lg border">
                                {kept.map((t, i) => (
                                    <AgendaTopicRow
                                        key={t.id}
                                        topic={t}
                                        index={i}
                                        first={i === 0}
                                        last={i === kept.length - 1}
                                        busy={busy}
                                        onCommit={() =>
                                            void act(`commit:${t.id}`, () => commitToNextStep(t))
                                        }
                                        onDecide={() => setDeciding(t)}
                                        onEdit={() => setEditing(t)}
                                        onMove={dir => void move(t, dir)}
                                        onShare={shared => share(t, shared)}
                                        onIgnore={() =>
                                            void act(`topic:${t.id}`, () => ignoreTopic(t))
                                        }
                                        onDelete={() => void remove(t)}
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
                                Write a topic
                            </Button>
                        </div>
                    </section>

                    {ignored.length > 0 && (
                        <section aria-label="Ignored">
                            <button
                                type="button"
                                onClick={() => setShowIgnored(o => !o)}
                                aria-expanded={showIgnored}
                                className="text-ink-2 hover:text-ink focus-visible:ring-brand/50 mb-2 inline-flex items-center gap-1.5 rounded-sm text-[13px] font-semibold outline-none focus-visible:ring-2"
                            >
                                Ignored
                                <span className="text-ink-3 text-xs font-normal">
                                    {plural(ignored.length, "topic")}
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
                                    {ignored.map(t => (
                                        <IgnoredTopicRow
                                            key={t.id}
                                            topic={t}
                                            busy={busy}
                                            onRestore={() =>
                                                void patch(
                                                    t,
                                                    {
                                                        status:
                                                            t.origin === "founder"
                                                                ? "kept"
                                                                : "suggested",
                                                    },
                                                    "Restored"
                                                )
                                            }
                                            onDelete={() => void remove(t)}
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
                    <SectionHeading title="Past weeks" />
                    <div className="border-line bg-panel rounded-lg border">
                        {history.map(h => (
                            <ToolLink
                                key={h.id}
                                href={vantagePath(`/agenda?week=${h.weekStart}`)}
                                aria-current={h.weekStart === week ? "true" : undefined}
                                className="border-line-2 hover:bg-panel-2 focus-visible:ring-brand/50 flex min-h-10 items-center gap-3 border-t px-4 py-2 outline-none first:border-t-0 focus-visible:ring-[3px]"
                            >
                                <span className="text-ink @max-sm:w-28 w-40 text-[13px] font-medium">
                                    {weekRange(h.weekStart, h.weekEnd)}
                                </span>
                                <span className="text-ink-3 text-[12px]">
                                    {plural(h.topicCount, "topic")} · {h.decidedCount} decided
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
                                    {STATUS_WORD[h.status]}
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
