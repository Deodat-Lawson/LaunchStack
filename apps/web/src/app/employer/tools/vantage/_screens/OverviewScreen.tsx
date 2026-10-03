"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { VantageMark } from "~/components/icons/vantage";
import { EmptyState, InlineError } from "~/components/tool-kit/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tool-kit/PageHeader";
import { SkeletonBlock, SkeletonRows } from "~/components/tool-kit/SkeletonRows";
import { useResource } from "~/components/tool-kit/useResource";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { EVIDENCE_KIND_LABEL, vantageApi, type VantageEvidenceKind } from "../api";
import { CheckInRow } from "../_components/CheckInRow";
import { EvidenceDialog } from "../_components/EvidenceDialog";
import { KindPill, StatusWord } from "../_components/Primitives";
import { agoWords, fmtChange, fmtDate, fmtNumber, plural, weekRange } from "../_lib/format";
import { vantagePath } from "../_lib/paths";

const AGENDA_WORD: Record<string, string> = {
    draft: "Draft",
    ready: "Ready",
    held: "Held",
    closed: "Closed",
};

/**
 * The week at a glance: is the agenda ready, what changed, what to check in
 * on, what was logged lately — and the two things to do next. No tiles.
 */
export function OverviewScreen() {
    const router = useRouter();
    const overview = useResource("vantage:overview", () => vantageApi.overview());
    const [adding, setAdding] = useState<VantageEvidenceKind | null>(null);
    const [preparing, setPreparing] = useState(false);

    const data = overview.data;
    const agenda = data?.agenda ?? null;
    const signals = data?.signals;
    const notable = signals?.metricChanges.filter(c => c.notable) ?? [];
    const changes = signals?.metricChanges ?? [];

    const prepare = async () => {
        setPreparing(true);
        try {
            await vantageApi.prepare(data?.agendaWeek);
            toast("Draft agenda prepared");
            router.push(vantagePath(`/agenda?week=${data?.agendaWeek ?? ""}`));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not prepare the agenda");
        } finally {
            setPreparing(false);
        }
    };

    const sub = data
        ? [
              `Next meeting: ${weekRange(data.agendaWeek, data.agendaWeekEnd)}`,
              plural(data.counts.evidenceThisWindow, "item") + " of evidence in two weeks",
              plural(data.counts.openCommitments, "open commitment"),
              data.lastEntryAt ? `last entry ${agoWords(data.lastEntryAt)}` : "nothing logged yet",
          ].join(" · ")
        : undefined;

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
            <PageHeader
                title="Your week,"
                accent="with evidence"
                sub={sub}
                actions={
                    <>
                        <Button variant="outline" size="sm" onClick={() => setAdding("note")}>
                            Add evidence
                        </Button>
                        {agenda ? (
                            <Button asChild size="sm">
                                <Link href={vantagePath(`/agenda?week=${agenda.weekStart}`)}>
                                    Open the agenda
                                </Link>
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                onClick={() => void prepare()}
                                disabled={preparing || !data}
                            >
                                {preparing && (
                                    <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                                )}
                                Prepare next week&apos;s agenda
                            </Button>
                        )}
                    </>
                }
            />

            {overview.error && (
                <InlineError message={overview.error} onRetry={() => void overview.reload()} />
            )}

            <section>
                <SectionHeading
                    title="Next meeting"
                    aside={
                        agenda ? (
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
                        ) : undefined
                    }
                />
                {overview.loading ? (
                    <div className="border-line bg-panel rounded-lg border px-5 py-4">
                        <SkeletonBlock lines={3} />
                    </div>
                ) : agenda ? (
                    <Link
                        href={vantagePath(`/agenda?week=${agenda.weekStart}`)}
                        className="border-line bg-panel hover:bg-panel-2 focus-visible:ring-brand/50 block rounded-lg border px-5 py-4 outline-none transition-colors focus-visible:ring-[3px]"
                    >
                        <div className="flex items-baseline justify-between gap-3">
                            <div className="text-ink text-sm font-medium">
                                {plural(
                                    agenda.topics.filter(t => t.status !== "dismissed").length,
                                    "topic"
                                )}
                                {" · "}
                                {plural(
                                    agenda.topics.filter(t => t.decision).length,
                                    "decision"
                                )}{" "}
                                recorded
                            </div>
                            <span className="text-ink-3 inline-flex items-center gap-1 text-xs">
                                Open <ArrowRight className="size-3" />
                            </span>
                        </div>
                        {agenda.summary && (
                            <p className="text-ink-2 mt-1.5 max-w-[70ch] text-[13px]">
                                {agenda.summary}
                            </p>
                        )}
                        <ol className="mt-3 flex flex-col gap-1">
                            {agenda.topics
                                .filter(t => t.status !== "dismissed")
                                .slice(0, 5)
                                .map((t, i) => (
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
                    </Link>
                ) : (
                    <EmptyState
                        mark={<VantageMark size={22} />}
                        title={
                            data &&
                            data.counts.evidenceThisWindow === 0 &&
                            data.counts.metricsWithData === 0
                                ? "Nothing to prepare from yet"
                                : "No agenda for next week yet"
                        }
                        body={
                            data &&
                            data.counts.evidenceThisWindow === 0 &&
                            data.counts.metricsWithData === 0
                                ? "Add a few conversations, a number or two and any promises from the last meeting. Vantage prepares a draft from whatever is there — sparse is fine, it says what is unknown."
                                : "Vantage looks across what changed, what is uncertain and what was promised, and drafts three to five topics — each with its evidence, a decision to make and a next step."
                        }
                        action={
                            <>
                                <Button
                                    size="sm"
                                    onClick={() => void prepare()}
                                    disabled={preparing || !data}
                                >
                                    {preparing && (
                                        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                                    )}
                                    Prepare the draft
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setAdding("interview")}
                                >
                                    Log a conversation
                                </Button>
                            </>
                        }
                    />
                )}
            </section>

            <section>
                <SectionHeading
                    title="What changed"
                    aside={signals ? `since ${fmtDate(signals.since)}` : undefined}
                />
                {overview.loading ? (
                    <SkeletonRows rows={3} height={40} />
                ) : !signals ||
                  (changes.length === 0 &&
                      signals.metricConflicts.length === 0 &&
                      signals.newEvidence.length === 0) ? (
                    <p className="text-ink-3 text-[13px]">
                        No numbers or evidence in the last two weeks.{" "}
                        <Link
                            href={vantagePath("/metrics")}
                            className="hover:text-ink underline underline-offset-2"
                        >
                            Enter this week&apos;s numbers
                        </Link>
                        .
                    </p>
                ) : (
                    <div className="border-line bg-panel rounded-lg border">
                        {signals.metricConflicts.map(x => (
                            <div
                                key={`${x.metricId}-${x.a.observationId}-${x.b.observationId}`}
                                className="border-line-2 flex min-h-10 items-center gap-3 border-t px-4 py-2 first:border-t-0"
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
                                <span className="text-ink w-44 shrink-0 truncate text-[13px] font-medium">
                                    {c.name}
                                </span>
                                <span className="text-ink font-mono text-[13px] tabular-nums">
                                    {fmtNumber(c.latest.value, c.unit)}
                                </span>
                                <span className="text-ink-3 text-[11.5px]">
                                    {fmtDate(c.latest.periodStart)}–{fmtDate(c.latest.periodEnd)}
                                </span>
                                <span
                                    className={cn(
                                        "ml-auto font-mono text-[12px] tabular-nums",
                                        c.direction === "new"
                                            ? "text-ink-3"
                                            : c.notable
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
                        {signals.newEvidence.length > 0 && (
                            <div className="border-line-2 flex min-h-10 flex-wrap items-center gap-2 border-t px-4 py-2">
                                <span className="text-ink-3 text-[12px]">Logged:</span>
                                {signals.newEvidence.map(n => (
                                    <span key={n.kind} className="text-ink-2 text-[12.5px]">
                                        {n.count} {EVIDENCE_KIND_LABEL[n.kind].toLowerCase()}
                                        {n.count === 1 ? "" : "s"}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                {notable.length > 0 && !agenda && (
                    <p className="text-ink-3 mt-2 text-[12px]">
                        {plural(notable.length, "notable change")} — worth a topic. Prepare the
                        draft to see it framed as a decision.
                    </p>
                )}
            </section>

            <section>
                <SectionHeading
                    title="Check in"
                    aside={
                        <Link href={vantagePath("/commitments")} className="hover:text-ink">
                            All commitments
                        </Link>
                    }
                />
                {overview.loading ? (
                    <SkeletonRows rows={2} height={44} />
                ) : !data || data.checkIns.length === 0 ? (
                    <p className="text-ink-3 text-[13px]">Nothing due or overdue this week.</p>
                ) : (
                    <div className="border-line bg-panel rounded-lg border">
                        {data.checkIns.map(c => (
                            <CheckInRow
                                key={c.id}
                                commitment={c}
                                onChange={() => void overview.reload()}
                            />
                        ))}
                    </div>
                )}
            </section>

            <section>
                <SectionHeading
                    title="Logged lately"
                    aside={
                        <Link href={vantagePath("/evidence")} className="hover:text-ink">
                            Evidence inbox
                        </Link>
                    }
                />
                {overview.loading ? (
                    <SkeletonRows rows={3} height={40} />
                ) : !data || data.recentEvidence.length === 0 ? (
                    <EmptyState
                        title="The inbox is empty"
                        body="A conversation, a link, a number with its date. Two minutes now is what makes Thursday's draft worth reading."
                        action={
                            <Button size="sm" variant="outline" onClick={() => setAdding("note")}>
                                Add evidence
                            </Button>
                        }
                    />
                ) : (
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
                                <span className="text-ink-3 shrink-0 font-mono text-[11.5px] tabular-nums">
                                    {e.observedAt}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <EvidenceDialog
                open={adding !== null}
                onOpenChange={o => !o && setAdding(null)}
                defaultKind={adding ?? "note"}
                onSaved={() => void overview.reload()}
            />
        </div>
    );
}
