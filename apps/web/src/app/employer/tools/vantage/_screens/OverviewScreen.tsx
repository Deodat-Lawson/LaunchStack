"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { useToolRouter } from "~/components/tool-app/nav";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { useResource } from "~/lib/tools/useResource";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { vantageApi, type OverviewDto, type TopicDto, type VantageEvidenceKind } from "../api";
import { EvidenceDialog } from "../_components/EvidenceDialog";
import { KindPill, StatusWord } from "../_components/Primitives";
import { AllCaughtUp, DraftingCard, SuggestionMark } from "../_components/Suggestion";
import { DecisionDialog } from "../_components/TopicDialogs";
import { WeekSuggestions } from "../_components/WeekSuggestions";
import { useOneClick } from "../_lib/actions";
import { todayIso, useVantageFormat, type VantageFormat } from "../_lib/format";
import { useHiddenSuggestions } from "../_lib/hidden";
import { vantagePath } from "../_lib/paths";
import { draftedWords, hasMaterial, weekSuggestions } from "../_lib/suggestions";
import { useAutoDraft } from "../_lib/useAutoDraft";

function readingWords(fmt: VantageFormat, o: OverviewDto): string {
    const { t } = fmt;
    const parts = [
        o.counts.evidenceThisWindow > 0 &&
            t("overview.reading.evidence", { count: o.counts.evidenceThisWindow }),
        o.counts.metricsWithData > 0 &&
            t("overview.reading.metrics", { count: o.counts.metricsWithData }),
        o.counts.openCommitments > 0 &&
            t("overview.reading.commitments", { count: o.counts.openCommitments }),
    ].filter(Boolean) as string[];
    if (parts.length === 0) return t("overview.reading.nothing");
    return fmt.list(parts);
}

/**
 * This week: what Vantage prepared, as suggestions to take or leave. The
 * week's draft is made on arrival when there is none yet; then come the
 * topics it proposes for the meeting, the promises to settle and the gaps
 * in the record — each answered with one click — and below them, quieter,
 * the facts it read them from.
 */
export function OverviewScreen() {
    const t = useTranslations("vantage.overview");
    const tk = useTranslations("vantage.evidenceKind");
    const fmt = useVantageFormat();
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
              t("nextMeeting", { range: fmt.weekRange(data.agendaWeek, data.agendaWeekEnd) }),
              agenda ? draftedWords(fmt, agenda) : null,
              data.lastEntryAt
                  ? t("lastEntry", { ago: fmt.ago(data.lastEntryAt) })
                  : t("nothingLogged"),
          ]
              .filter(Boolean)
              .join(" · ")
        : undefined;

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
            <PageHeader
                title={t("title")}
                accent={t("accent")}
                sub={sub}
                actions={
                    <>
                        <Button variant="outline" size="sm" onClick={() => setAdding("note")}>
                            {t("addEvidence")}
                        </Button>
                        {agenda && (
                            <Button asChild size="sm">
                                <ToolLink href={vantagePath(`/agenda?week=${agenda.weekStart}`)}>
                                    {t("openAgenda")}
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
                            aria-label={t("readOnWeek")}
                            className="border-line from-brand-soft rounded-xl border bg-gradient-to-br to-transparent px-5 py-4"
                        >
                            <SuggestionMark>{t("readOnWeek")}</SuggestionMark>
                            <p className="text-ink mt-1.5 max-w-[72ch] text-[15px] leading-[1.55]">
                                {agenda.summary}
                            </p>
                            <p className="text-ink-3 mt-2 text-[12px]">
                                {waiting > 0
                                    ? t("fromWaiting", {
                                          reading: readingWords(fmt, data),
                                          count: waiting,
                                      })
                                    : t("from", { reading: readingWords(fmt, data) })}
                            </p>
                        </section>
                    )}

                    {auto.drafting ? (
                        <DraftingCard
                            reading={t("draftingReading", {
                                reading: readingWords(fmt, data),
                                range: fmt.weekRange(data.agendaWeek, data.agendaWeekEnd),
                            })}
                        />
                    ) : auto.error ? (
                        <EmptyState
                            title={t("draftFailed")}
                            body={auto.error}
                            action={
                                <Button size="sm" onClick={auto.draft}>
                                    {t("tryAgain")}
                                </Button>
                            }
                        />
                    ) : !agenda && !material ? (
                        <EmptyState
                            title={t("emptyTitle")}
                            body={t("emptyBody")}
                            action={
                                <>
                                    <Button size="sm" onClick={() => setAdding("interview")}>
                                        {t("logConversation")}
                                    </Button>
                                    <Button size="sm" variant="outline" asChild>
                                        <ToolLink href={vantagePath("/metrics")}>
                                            {t("enterNumbers")}
                                        </ToolLink>
                                    </Button>
                                </>
                            }
                        />
                    ) : !agenda ? (
                        // Drafting on arrival already ran for this visit and its result
                        // did not show up here: offer it rather than claim "caught up".
                        <EmptyState
                            title={t("noAgendaTitle", {
                                range: fmt.weekRange(data.agendaWeek, data.agendaWeekEnd),
                            })}
                            body={t("noAgendaBody", { reading: readingWords(fmt, data) })}
                            action={
                                <Button size="sm" onClick={auto.draft}>
                                    {t("draftNow")}
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
                        title={t("onAgenda")}
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
                                {t(`status.${agenda.status}`)}
                            </StatusWord>
                        }
                    />
                    <ToolLink
                        href={vantagePath(`/agenda?week=${agenda.weekStart}`)}
                        className="border-line bg-panel hover:bg-panel-2 focus-visible:ring-brand/50 block rounded-lg border px-4 py-3 outline-none transition-colors focus-visible:ring-[3px]"
                    >
                        <ol className="flex flex-col gap-1">
                            {kept.map((topic, i) => (
                                <li key={topic.id} className="text-ink flex gap-2 text-[13px]">
                                    <span className="text-ink-3 w-4 shrink-0 font-mono tabular-nums">
                                        {i + 1}
                                    </span>
                                    <span className="truncate">{topic.title}</span>
                                    {topic.decision && (
                                        <span className="text-success ml-auto shrink-0 text-[11.5px]">
                                            {t("decided")}
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ol>
                        <span className="text-ink-3 mt-2 inline-flex items-center gap-1 text-xs">
                            {t("openAgenda")} <ArrowRight className="size-3" aria-hidden="true" />
                        </span>
                    </ToolLink>
                </section>
            )}

            {data && (changes.length > 0 || (signals?.metricConflicts.length ?? 0) > 0) && (
                <section>
                    <SectionHeading
                        title={t("numbersTitle")}
                        aside={signals ? t("since", { date: fmt.date(signals.since) }) : undefined}
                    />
                    <div className="border-line bg-panel rounded-lg border">
                        {signals?.metricConflicts.map(x => (
                            <div
                                key={`${x.metricId}-${x.a.observationId}-${x.b.observationId}`}
                                className="border-line-2 flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 first:border-t-0"
                            >
                                <StatusWord tone="warn">{t("conflict")}</StatusWord>
                                <span className="text-ink text-[13px]">
                                    {t.rich("conflictLine", {
                                        name: x.name,
                                        a: fmt.number(x.a.value),
                                        sourceA: x.a.source ?? t("noSource"),
                                        b: fmt.number(x.b.value),
                                        sourceB: x.b.source ?? t("noSource"),
                                        num: chunks => (
                                            <span className="font-mono tabular-nums">{chunks}</span>
                                        ),
                                    })}
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
                                    {fmt.number(c.latest.value, c.unit)}
                                </span>
                                <span className="text-ink-3 @max-sm:hidden text-[11.5px]">
                                    {t("period", {
                                        start: fmt.date(c.latest.periodStart),
                                        end: fmt.date(c.latest.periodEnd),
                                    })}
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
                                        ? t("firstNumber")
                                        : c.direction === "flat"
                                          ? t("noChange")
                                          : fmt.change(c.pct, c.delta, c.unit)}
                                </span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {data && data.recentEvidence.length > 0 && (
                <section>
                    <SectionHeading
                        title={t("evidenceTitle")}
                        aside={
                            <ToolLink href={vantagePath("/evidence")} className="hover:text-ink">
                                {t("evidenceInbox")}
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
                            {t("inTwoWeeks", {
                                counts: signals.newEvidence
                                    .map(n => tk(`count.${n.kind}`, { count: n.count }))
                                    .join(fmt.t("format.list.separator")),
                            })}
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
