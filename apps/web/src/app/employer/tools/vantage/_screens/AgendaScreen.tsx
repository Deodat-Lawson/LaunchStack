"use client";

import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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

import { vantageApi, type AgendaDto, type TopicDto, type VantageAgendaStatus } from "../api";
import { StatusWord } from "../_components/Primitives";
import { TopicCard } from "../_components/TopicCard";
import { DecisionDialog, TopicDialog } from "../_components/TopicDialogs";
import { addDaysIso, fmtDate, plural, weekRange } from "../_lib/format";
import { vantagePath } from "../_lib/paths";

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
 * The agenda editor for one week. Topics in order, each expandable into
 * its six parts; the founder keeps, rewrites, dismisses, reorders and adds
 * topics, chooses what to share, and after the meeting records the
 * decision that opens a commitment. Regenerating replaces only untouched
 * suggestions.
 */
export function AgendaScreen() {
    const router = useRouter();
    const params = useSearchParams();
    const weekParam = params.get("week");
    const key = isIsoWeek(weekParam) ? weekParam : "default";
    const res = useResource(`vantage:agenda:${key}`, () =>
        vantageApi.agendas(isIsoWeek(weekParam) ? weekParam : undefined)
    );
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState<TopicDto | null | "new">(null);
    const [deciding, setDeciding] = useState<TopicDto | null>(null);

    const week = res.data?.week ?? weekParam ?? "";
    const agenda = res.data?.agenda ?? null;
    const history = res.data?.agendas ?? [];

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

    const prepare = () =>
        run(
            async () => {
                const { agenda: next } = await vantageApi.prepare(week);
                setAgenda(next);
                void res.reload();
            },
            agenda ? "Draft regenerated — your kept and edited topics stayed" : "Draft prepared"
        );

    const patch = (
        topic: TopicDto,
        p: Parameters<typeof vantageApi.patchTopic>[1],
        done?: string
    ) =>
        run(async () => {
            const { topic: next } = await vantageApi.patchTopic(topic.id, p);
            setTopic(next);
        }, done);

    const move = (topic: TopicDto, dir: -1 | 1) =>
        run(async () => {
            if (!agenda) return;
            const ordered = [...agenda.topics].sort((a, b) => a.position - b.position);
            const i = ordered.findIndex(t => t.id === topic.id);
            const j = i + dir;
            if (i < 0 || j < 0 || j >= ordered.length) return;
            [ordered[i], ordered[j]] = [ordered[j]!, ordered[i]!];
            const { agenda: next } = await vantageApi.reorder(
                agenda.id,
                ordered.map(t => t.id)
            );
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

    const topics = useMemo(
        () => (agenda ? [...agenda.topics].sort((a, b) => a.position - b.position) : []),
        [agenda]
    );
    const live = topics.filter(t => t.status !== "dismissed");
    const dismissed = topics.filter(t => t.status === "dismissed");
    const decided = live.filter(t => t.decision).length;
    const unsupported = live.reduce((n, t) => n + t.facts.filter(f => f.unsupported).length, 0);
    const mode = agenda?.modelMetadata?.mode as string | undefined;
    const fallback = agenda?.modelMetadata?.fallback as string | undefined;

    const sub = agenda ? (
        <span className="inline-flex flex-wrap items-center gap-x-2">
            <span>{weekRange(agenda.weekStart, agenda.weekEnd)}</span>
            <span>·</span>
            <span>
                {plural(live.length, "topic")}, {decided} decided,{" "}
                {live.filter(t => t.shared).length} shared
            </span>
            {agenda.generatedAt && (
                <>
                    <span>·</span>
                    <span>
                        drafted {fmtDate(agenda.generatedAt)}
                        {mode === "ai" ? " by the model" : mode === "rules" ? " by the rules" : ""}
                        {fallback === "no-model"
                            ? " (no chat model configured)"
                            : fallback === "model-failed"
                              ? " (the model call failed)"
                              : ""}
                    </span>
                </>
            )}
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
                                    <DropdownMenuItem onSelect={() => void prepare()}>
                                        Regenerate suggestions
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
                        {agenda ? (
                            agenda.status === "draft" ? (
                                <Button
                                    size="sm"
                                    onClick={() => void setStatus("ready")}
                                    disabled={busy || live.length === 0}
                                >
                                    Mark ready
                                </Button>
                            ) : agenda.status === "ready" ? (
                                <Button
                                    size="sm"
                                    onClick={() => void setStatus("held")}
                                    disabled={busy}
                                >
                                    Meeting held
                                </Button>
                            ) : (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setEditing("new")}
                                    disabled={busy}
                                >
                                    Add a topic
                                </Button>
                            )
                        ) : (
                            <Button
                                size="sm"
                                onClick={() => void prepare()}
                                disabled={busy || !res.data}
                            >
                                {busy && (
                                    <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                                )}
                                Prepare the draft
                            </Button>
                        )}
                    </>
                }
            />

            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}

            {res.loading ? (
                <SkeletonRows rows={4} height={48} />
            ) : !agenda ? (
                <EmptyState
                    title="No agenda for this week yet"
                    body="Prepare a draft from the evidence, numbers and open commitments on file. Three to five topics, each with what happened, its sources, why it matters, the decision to make and a next step. You edit from there."
                    action={
                        <>
                            <Button size="sm" onClick={() => void prepare()} disabled={busy}>
                                {busy && (
                                    <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                                )}
                                Prepare the draft
                            </Button>
                            <Button size="sm" variant="outline" asChild>
                                <Link href={vantagePath("/evidence")}>Add evidence first</Link>
                            </Button>
                        </>
                    }
                />
            ) : (
                <>
                    <section className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-3">
                            <StatusWord
                                tone={
                                    agenda.status === "draft"
                                        ? "neutral"
                                        : agenda.status === "ready"
                                          ? "brand"
                                          : "success"
                                }
                            >
                                {STATUS_WORD[agenda.status]}
                            </StatusWord>
                            {unsupported > 0 && (
                                <span className="text-warn text-[12px]">
                                    {plural(unsupported, "fact")} without a source on file
                                </span>
                            )}
                        </div>
                        {agenda.summary && (
                            <p className="text-ink-2 max-w-[70ch] text-[13.5px] leading-[1.5]">
                                {agenda.summary}
                            </p>
                        )}
                    </section>

                    <section>
                        <SectionHeading
                            title="Topics"
                            aside={
                                busy ? (
                                    <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                                ) : (
                                    `${live.length} of 5`
                                )
                            }
                        />
                        {live.length === 0 ? (
                            <EmptyState
                                title="Nothing to discuss yet"
                                body={
                                    agenda.summary ??
                                    "The draft found nothing that merits a decision. Add evidence or numbers and regenerate, or write a topic yourself."
                                }
                                action={
                                    <>
                                        <Button size="sm" onClick={() => setEditing("new")}>
                                            Add a topic
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => void prepare()}
                                            disabled={busy}
                                        >
                                            Regenerate
                                        </Button>
                                    </>
                                }
                            />
                        ) : (
                            <div className="border-line bg-panel rounded-lg border">
                                {live.map((t, i) => (
                                    <TopicCard
                                        key={t.id}
                                        topic={t}
                                        index={i}
                                        first={i === 0}
                                        last={i === live.length - 1}
                                        busy={busy}
                                        onKeep={() => void patch(t, { status: "kept" }, "Kept")}
                                        onDismiss={() =>
                                            void patch(t, { status: "dismissed" }, "Dismissed")
                                        }
                                        onEdit={() => setEditing(t)}
                                        onDecide={() => setDeciding(t)}
                                        onMove={dir => void move(t, dir)}
                                        onShare={shared =>
                                            void patch(
                                                t,
                                                { shared },
                                                shared ? "Shared with the program" : "Made private"
                                            )
                                        }
                                        onDelete={() => void remove(t)}
                                    />
                                ))}
                            </div>
                        )}
                        {live.length > 0 && (
                            <div className="mt-2 flex gap-2">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setEditing("new")}
                                    disabled={busy}
                                >
                                    Add a topic
                                </Button>
                            </div>
                        )}
                    </section>

                    {dismissed.length > 0 && (
                        <section>
                            <SectionHeading
                                title="Dismissed"
                                aside={plural(dismissed.length, "topic")}
                            />
                            <div className="border-line bg-panel rounded-lg border">
                                {dismissed.map((t, i) => (
                                    <TopicCard
                                        key={t.id}
                                        topic={t}
                                        index={live.length + i}
                                        first
                                        last
                                        busy={busy}
                                        onKeep={() => void patch(t, { status: "kept" }, "Restored")}
                                        onDismiss={() => undefined}
                                        onEdit={() => setEditing(t)}
                                        onDecide={() => setDeciding(t)}
                                        onMove={() => undefined}
                                        onShare={shared => void patch(t, { shared })}
                                        onDelete={() => void remove(t)}
                                    />
                                ))}
                            </div>
                        </section>
                    )}
                </>
            )}

            {history.length > 0 && (
                <section>
                    <SectionHeading title="Past weeks" />
                    <div className="border-line bg-panel rounded-lg border">
                        {history.map(h => (
                            <Link
                                key={h.id}
                                href={vantagePath(`/agenda?week=${h.weekStart}`)}
                                aria-current={h.weekStart === week ? "true" : undefined}
                                className="border-line-2 hover:bg-panel-2 focus-visible:ring-brand/50 flex min-h-10 items-center gap-3 border-t px-4 py-2 outline-none first:border-t-0 focus-visible:ring-[3px]"
                            >
                                <span className="text-ink w-40 text-[13px] font-medium">
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
                            </Link>
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
