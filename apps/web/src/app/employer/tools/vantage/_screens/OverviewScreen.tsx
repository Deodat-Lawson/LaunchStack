"use client";

import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { useToolRouter } from "~/components/tool-app/nav";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { useResource } from "~/lib/tools/useResource";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import {
    EVIDENCE_KIND_LABEL,
    vantageApi,
    type OverviewDto,
    type TopicDto,
    type VantageEvidenceKind,
} from "../api";
import { EvidenceDialog } from "../_components/EvidenceDialog";
import { KindPill, StatusWord } from "../_components/Primitives";
import { AllCaughtUp, DraftingCard, SuggestionMark } from "../_components/Suggestion";
import { DecisionDialog } from "../_components/TopicDialogs";
import { WeekSuggestions } from "../_components/WeekSuggestions";
import { useOneClick } from "../_lib/actions";
import {
    agoWords,
    fmtChange,
    fmtDate,
    fmtNumber,
    plural,
    todayIso,
    weekRange,
} from "../_lib/format";
import { useHiddenSuggestions } from "../_lib/hidden";
import { vantagePath } from "../_lib/paths";
import { draftedWords, hasMaterial, weekSuggestions } from "../_lib/suggestions";
import { useAutoDraft } from "../_lib/useAutoDraft";

const AGENDA_WORD: Record<string, string> = {
    draft: "Draft",
    ready: "Ready",
    held: "Held",
    closed: "Closed",
};

function readingWords(o: OverviewDto): string {
    const parts = [
        o.counts.evidenceThisWindow > 0 &&
            plural(o.counts.evidenceThisWindow, "piece") + " of evidence",
        o.counts.metricsWithData > 0 && plural(o.counts.metricsWithData, "metric"),
        o.counts.openCommitments > 0 && plural(o.counts.openCommitments, "open commitment"),
    ].filter(Boolean) as string[];
    if (parts.length === 0) return "what is on file";
    if (parts.length === 1) return parts[0]!;
    return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * This week: what Vantage prepared, as suggestions to take or leave. The
 * week's draft is made on arrival when there is none yet; then come the
 * topics it proposes for the meeting, the promises to settle and the gaps
 * in the record — each answered with one click — and below them, quieter,
 * the facts it read them from.
 */
export function OverviewScreen() {
    const router = useToolRouter();
    const overview = useResource("vantage:overview", () => vantageApi.overview());
    const hidden = useHiddenSuggestions();
    const { act, gone } = useOneClick(overview.reload);
    const [adding, setAdding] = useState<VantageEvidenceKind | null>(null);
    const [deciding, setDeciding] = useState<TopicDto | null>(null);
    const today = todayIso();

    const data = overview.data;
    const agenda = data?.agenda ?? null;
    const material = data ? hasMaterial(data) : false;
    const auto = useAutoDraft({
        week: data?.agendaWeek ?? null,
        auto: Boolean(data && !agenda && material),
        onDrafted: () => overview.reload(),
    });

    const groups = useMemo(() => {
        if (!data) return [];
        const all = weekSuggestions(data, { today, hidden });
        // With nothing on file, the empty state already asks for a conversation
        // and the numbers; the same two nudges beside it would say it twice.
        return hasMaterial(data) || data.agenda ? all : all.filter(g => g.id !== "record");
    }, [data, today, hidden]);
    const waiting = groups.reduce((n, g) => n + g.items.filter(s => !gone.has(s.id)).length, 0);
    const kept = agenda
        ? [...agenda.topics]
              .filter(t => t.status === "kept")
              .sort((a, b) => a.position - b.position)
        : [];
    const signals = data?.signals;
    const changes = signals?.metricChanges ?? [];

    const sub = data
        ? [
              `Next meeting ${weekRange(data.agendaWeek, data.agendaWeekEnd)}`,
              agenda ? draftedWords(agenda) : null,
              data.lastEntryAt ? `last entry ${agoWords(data.lastEntryAt)}` : "nothing logged yet",
          ]
              .filter(Boolean)
              .join(" · ")
        : undefined;

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
            <PageHeader
                title="Your week,"
                accent="prepared by Vantage"
                sub={sub}
                actions={
                    <>
                        <Button variant="outline" size="sm" onClick={() => setAdding("note")}>
                            Add evidence
                        </Button>
                        {agenda && (
                            <Button asChild size="sm">
                                <ToolLink href={vantagePath(`/agenda?week=${agenda.weekStart}`)}>
                                    Open the agenda
                                    <ArrowRight aria-hidden="true" />
                                </ToolLink>
                            </Button>
                        )}
                    </>
                }
            />

            {overview.error && (
                <InlineError message={overview.error} onRetry={() => void overview.reload()} />
            )}

            {overview.loading ? (
                <SkeletonRows rows={3} height={112} />
            ) : !data ? null : (
                <div className="flex flex-col gap-6">
                    {agenda?.summary && (
                        <section
                            aria-label="Vantage's read on your week"
                            className="border-line from-brand-soft rounded-xl border bg-gradient-to-br to-transparent px-5 py-4"
                        >
                            <SuggestionMark>Vantage&apos;s read on your week</SuggestionMark>
                            <p className="text-ink mt-1.5 max-w-[72ch] text-[15px] leading-[1.55]">
                                {agenda.summary}
                            </p>
                            <p className="text-ink-3 mt-2 text-[12px]">
                                From {readingWords(data)}
                                {waiting > 0
                                    ? ` · ${plural(waiting, "suggestion")} waiting below — take or ignore each with one click`
                                    : ""}
                            </p>
                        </section>
                    )}

                    {auto.drafting ? (
                        <DraftingCard
                            reading={`Reading ${readingWords(data)} to draft the meeting on ${weekRange(data.agendaWeek, data.agendaWeekEnd)}.`}
                        />
                    ) : auto.error ? (
                        <EmptyState
                            title="Vantage could not draft the week"
                            body={auto.error}
                            action={
                                <Button size="sm" onClick={auto.draft}>
                                    Try again
                                </Button>
                            }
                        />
                    ) : !agenda && !material ? (
                        <EmptyState
                            title="Give Vantage something to read"
                            body="Log a conversation, a link or this week's numbers. Vantage drafts the meeting from whatever is there — three to five topics, each with its sources, a decision to make and a next step — and brings them here as suggestions."
                            action={
                                <>
                                    <Button size="sm" onClick={() => setAdding("interview")}>
                                        Log a conversation
                                    </Button>
                                    <Button size="sm" variant="outline" asChild>
                                        <ToolLink href={vantagePath("/metrics")}>
                                            Enter numbers
                                        </ToolLink>
                                    </Button>
                                </>
                            }
                        />
                    ) : !agenda ? (
                        // Drafting on arrival already ran for this visit and its result
                        // did not show up here: offer it rather than claim "caught up".
                        <EmptyState
                            title={`No agenda for ${weekRange(data.agendaWeek, data.agendaWeekEnd)} yet`}
                            body={`Vantage drafts it from ${readingWords(data)}: three to five topics, each with its sources, a decision to make and a next step.`}
                            action={
                                <Button size="sm" onClick={auto.draft}>
                                    Draft it now
                                </Button>
                            }
                        />
                    ) : null}

                    {!auto.drafting && waiting > 0 && (
                        <WeekSuggestions
                            groups={groups}
                            act={act}
                            gone={gone}
                            meetingWeek={{ start: data.agendaWeek, end: data.agendaWeekEnd }}
                            onDecide={setDeciding}
                            onLogEvidence={() => setAdding("interview")}
                            onRecordNumbers={() => router.push(vantagePath("/metrics"))}
                        />
                    )}
                    {!auto.drafting && waiting === 0 && agenda !== null && <AllCaughtUp />}
                </div>
            )}

            {agenda && kept.length > 0 && (
                <section>
                    <SectionHeading
                        title="On the agenda"
                        aside={
                            <StatusWord
                                tone={
                                    agenda.status === "held" || agenda.status === "closed"
                                        ? "success"
                                        : agenda.status === "ready"
                                          ? "brand"
                                          : "neutral"
                                }
                            >
                                {AGENDA_WORD[agenda.status]}
                            </StatusWord>
                        }
                    />
                    <ToolLink
                        href={vantagePath(`/agenda?week=${agenda.weekStart}`)}
                        className="border-line bg-panel hover:bg-panel-2 focus-visible:ring-brand/50 block rounded-lg border px-4 py-3 outline-none transition-colors focus-visible:ring-[3px]"
                    >
                        <ol className="flex flex-col gap-1">
                            {kept.map((t, i) => (
                                <li key={t.id} className="text-ink flex gap-2 text-[13px]">
                                    <span className="text-ink-3 w-4 shrink-0 font-mono tabular-nums">
                                        {i + 1}
                                    </span>
                                    <span className="truncate">{t.title}</span>
                                    {t.decision && (
                                        <span className="text-success ml-auto shrink-0 text-[11.5px]">
                                            decided
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ol>
                        <span className="text-ink-3 mt-2 inline-flex items-center gap-1 text-xs">
                            Open the agenda <ArrowRight className="size-3" aria-hidden="true" />
                        </span>
                    </ToolLink>
                </section>
            )}

            {data && (changes.length > 0 || (signals?.metricConflicts.length ?? 0) > 0) && (
                <section>
                    <SectionHeading
                        title="What Vantage read: the numbers"
                        aside={signals ? `since ${fmtDate(signals.since)}` : undefined}
                    />
                    <div className="border-line bg-panel rounded-lg border">
                        {signals?.metricConflicts.map(x => (
                            <div
                                key={`${x.metricId}-${x.a.observationId}-${x.b.observationId}`}
                                className="border-line-2 flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 first:border-t-0"
                            >
                                <StatusWord tone="warn">Conflict</StatusWord>
                                <span className="text-ink text-[13px]">
                                    {x.name}:{" "}
                                    <span className="font-mono tabular-nums">
                                        {fmtNumber(x.a.value)}
                                    </span>{" "}
                                    ({x.a.source ?? "no source"}) vs{" "}
                                    <span className="font-mono tabular-nums">
                                        {fmtNumber(x.b.value)}
                                    </span>{" "}
                                    ({x.b.source ?? "no source"})
                                </span>
                            </div>
                        ))}
                        {changes.map(c => (
                            <div
                                key={c.metricId}
                                className="border-line-2 flex min-h-10 items-center gap-3 border-t px-4 py-2 first:border-t-0"
                            >
                                <span className="text-ink @max-sm:w-28 w-44 shrink-0 truncate text-[13px] font-medium">
                                    {c.name}
                                </span>
                                <span className="text-ink font-mono text-[13px] tabular-nums">
                                    {fmtNumber(c.latest.value, c.unit)}
                                </span>
                                <span className="text-ink-3 @max-sm:hidden text-[11.5px]">
                                    {fmtDate(c.latest.periodStart)}–{fmtDate(c.latest.periodEnd)}
                                </span>
                                <span
                                    className={cn(
                                        "ml-auto font-mono text-[12px] tabular-nums",
                                        c.notable && c.direction !== "new"
                                            ? "text-ink"
                                            : "text-ink-3"
                                    )}
                                >
                                    {c.direction === "new"
                                        ? "first number"
                                        : c.direction === "flat"
                                          ? "no change"
                                          : fmtChange(c.pct, c.delta, c.unit)}
                                </span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {data && data.recentEvidence.length > 0 && (
                <section>
                    <SectionHeading
                        title="What Vantage read: the evidence"
                        aside={
                            <ToolLink href={vantagePath("/evidence")} className="hover:text-ink">
                                Evidence inbox
                            </ToolLink>
                        }
                    />
                    <div className="border-line bg-panel rounded-lg border">
                        {data.recentEvidence.map(e => (
                            <div
                                key={e.id}
                                className="border-line-2 flex min-h-10 items-center gap-3 border-t px-4 py-2 first:border-t-0"
                            >
                                <KindPill kind={e.kind} />
                                <span className="text-ink min-w-0 flex-1 truncate text-[13px]">
                                    {e.title}
                                </span>
                                <span className="text-ink-3 @max-sm:hidden shrink-0 font-mono text-[11.5px] tabular-nums">
                                    {e.observedAt}
                                </span>
                            </div>
                        ))}
                    </div>
                    {signals && signals.newEvidence.length > 0 && (
                        <p className="text-ink-3 mt-2 text-[12px]">
                            In two weeks:{" "}
                            {signals.newEvidence
                                .map(
                                    n =>
                                        `${n.count} ${EVIDENCE_KIND_LABEL[n.kind].toLowerCase()}${n.count === 1 ? "" : "s"}`
                                )
                                .join(", ")}
                        </p>
                    )}
                </section>
            )}

            <EvidenceDialog
                open={adding !== null}
                onOpenChange={o => !o && setAdding(null)}
                defaultKind={adding ?? "note"}
                onSaved={() => void overview.reload()}
            />
            <DecisionDialog
                open={deciding !== null}
                onOpenChange={o => !o && setDeciding(null)}
                topic={deciding}
                onSaved={() => void overview.reload()}
            />
        </div>
    );
}
