"use client";

import { Check, ChevronDown, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { useToolNav } from "~/components/tool-app/nav";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";
import { useResource } from "~/lib/tools/useResource";
import { PersonalContextPanel } from "~/components/vantage-context/PersonalContextPanel";
import { ContextSourceDialog } from "../_components/ContextSourceDialog";
import { PendingQuestions } from "../_components/PendingQuestions";
import { BasisTag } from "../_components/Primitives";
import { DemoApiError, demoSourceKey, demoSourceName, vantageDemoApi } from "../demo-api";
import { createDemoPersonalContextClient } from "../demo-personal-client";
import type {
    DemoHumanDecision,
    DemoReport,
    DemoSourceRef,
    DemoState,
    DemoTopic,
    DemoTopicReview,
} from "../demo-contract";
import { fmtDate } from "../_lib/format";
import { AgendaScreen } from "./AgendaScreen";

const DECISION_LABEL: Record<DemoHumanDecision["value"], string> = {
    go: "Go",
    "no-go": "No-go",
    "needs-more-evidence": "Needs more evidence",
};

export function ContextDemoScreen({ onSelectedWeek }: { onSelectedWeek?: (week: string) => void }) {
    const { searchParams } = useToolNav();
    const week = searchParams.get("week") ?? undefined;
    return <ContextDemoWeek key={week ?? "default"} week={week} onSelectedWeek={onSelectedWeek} />;
}

/** A direct demo /review visit resolves its fixture week instead of using the wall clock. */
export function ContextNativeReview({ week }: { week?: string }) {
    const selection = useResource(week ? null : "vantage:context-demo:default-week", () =>
        vantageDemoApi.state()
    );
    if (week) return <AgendaScreen week={week} />;
    if (selection.error)
        return <InlineError message={selection.error} onRetry={() => void selection.reload()} />;
    if (!selection.data) return <SkeletonRows rows={3} height={112} />;
    return <AgendaScreen week={selection.data.selectedWeek} />;
}

function ContextDemoWeek({
    week,
    onSelectedWeek,
}: {
    week?: string;
    onSelectedWeek?: (week: string) => void;
}) {
    const { navigate } = useToolNav();
    const state = useResource(`vantage:context-demo:${week ?? "default"}`, () =>
        vantageDemoApi.state(week)
    );
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [withheld, setWithheld] = useState(false);
    const [source, setSource] = useState<DemoSourceRef | null>(null);
    const [decision, setDecision] = useState<DemoTopic | null>(null);
    const [personalOpen, setPersonalOpen] = useState(false);
    const [personalReady, setPersonalReady] = useState<boolean | null>(null);
    const [personalBlocker, setPersonalBlocker] = useState<string | null>(null);
    const alive = useRef(true);
    const running = useRef(false);
    const abort = useRef<AbortController | null>(null);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
            abort.current?.abort();
        };
    }, []);
    const data = state.data;
    const report = !withheld && !state.error ? data?.report : null;
    const replayMode = data?.generationMode === "replay";
    const personalEnabled = data?.personalContextAvailable === true;
    const personalBlocked = personalEnabled && personalReady !== true;
    const personalClient = useMemo(
        () =>
            createDemoPersonalContextClient(data?.selectedWeek, {
                loaded: view => {
                    if (!alive.current) return;
                    setPersonalReady(view.ready);
                    setPersonalBlocker(view.blocker ?? null);
                },
                invalidated: () => {
                    if (alive.current) setPersonalReady(null);
                },
                unavailable: () => {
                    if (!alive.current) return;
                    setPersonalReady(false);
                    setPersonalBlocker(
                        "Personal context could not be checked. Reload before generation."
                    );
                },
            }),
        [data?.selectedWeek]
    );
    useEffect(() => {
        if (personalEnabled) void personalClient.load().catch(() => undefined);
    }, [personalEnabled, personalClient]);
    const locked = busy !== null || refreshing;
    useEffect(() => {
        if (data) onSelectedWeek?.(data.selectedWeek);
    }, [data, onSelectedWeek]);

    async function reloadSaved(announce = true) {
        if (!data) {
            await state.reload();
            return false;
        }
        setRefreshing(true);
        setError(null);
        setNotice(null);
        setSource(null);
        setDecision(null);
        try {
            const next = await vantageDemoApi.state(week);
            if (alive.current) {
                state.mutate(() => next);
                setWithheld(false);
                if (announce) setNotice("Reloaded the current saved review.");
            }
            return true;
        } catch {
            if (alive.current) {
                setWithheld(true);
                setError(
                    "Could not reload the current review. Contextual content is hidden until its evidence and access can be checked. Try reload again."
                );
            }
            return false;
        } finally {
            if (alive.current) setRefreshing(false);
        }
    }

    async function save(label: string, work: () => Promise<DemoState>) {
        if (running.current) return;
        running.current = true;
        setBusy(label);
        setError(null);
        setNotice(null);
        try {
            const next = await work();
            if (alive.current) {
                state.mutate(() => next);
                setWithheld(false);
                setDecision(null);
                setNotice(
                    !next.report
                        ? "The request finished, but contextual content is unavailable with the current evidence or access."
                        : label === "generate"
                          ? "Contextual report saved. Your native report, decisions and actions are preserved."
                          : "Review saved. No action or commitment was created."
                );
            }
        } catch (reason) {
            if (alive.current) {
                if (reason instanceof DemoApiError && reason.status === 409) {
                    setWithheld(true);
                    setSource(null);
                    setDecision(null);
                    const loaded = await reloadSaved(false);
                    if (loaded && alive.current)
                        setError(
                            "This report or its sources changed. The current saved version has been loaded; review it before trying again."
                        );
                } else {
                    if (reason instanceof DemoApiError && [401, 403, 404].includes(reason.status)) {
                        setWithheld(true);
                        setSource(null);
                        setDecision(null);
                    }
                    setError(
                        reason instanceof Error ? reason.message : "Could not save this change."
                    );
                }
            }
        } finally {
            running.current = false;
            if (alive.current) setBusy(null);
        }
    }
    function generate() {
        if (!data || personalBlocked) return;
        abort.current = new AbortController();
        void save("generate", () =>
            vantageDemoApi.generate(data.selectedWeek, abort.current!.signal)
        );
    }
    function review(topic: DemoTopic, changes: Pick<DemoTopicReview, "status" | "decision">) {
        if (!report) return;
        return save(topic.id, () =>
            vantageDemoApi.review({
                reportId: report.id,
                topicId: topic.id,
                expectedVersion: report.version,
                ...changes,
            })
        );
    }

    return (
        <div className="mx-auto flex max-w-[1060px] flex-col gap-6">
            <PageHeader
                title={"Your weekly review, "}
                accent="with context"
                sub="Read the evidence, make a decision, and keep your earlier questions in view."
                actions={
                    <Button onClick={generate} disabled={!data || locked || personalBlocked}>
                        {busy === "generate" ? (
                            <Loader2 className="animate-spin" aria-hidden="true" />
                        ) : (
                            <Sparkles aria-hidden="true" />
                        )}
                        {busy === "generate"
                            ? replayMode
                                ? "Replaying…"
                                : "Generating…"
                            : replayMode
                              ? "Replay recorded report"
                              : "Generate with context"}
                    </Button>
                }
            />
            <div className="border-line flex flex-wrap items-center justify-between gap-3 border-b pb-4">
                <div className="flex flex-wrap items-center gap-3">
                    <label htmlFor="context-demo-week" className="text-ink-3 text-xs font-medium">
                        Reporting week
                    </label>
                    <select
                        id="context-demo-week"
                        value={data?.selectedWeek ?? ""}
                        disabled={!data || locked}
                        onChange={event => navigate(`/context-demo?week=${event.target.value}`)}
                        className="border-line bg-panel text-ink focus-visible:ring-brand/50 h-9 max-w-full rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2"
                    >
                        {!data && <option value="">Loading weeks…</option>}
                        {data?.weeks.map(item => (
                            <option key={item.weekStart} value={item.weekStart}>
                                Week of {fmtDate(item.weekStart)}
                                {item.label ? ` · ${item.label}` : ""}
                            </option>
                        ))}
                    </select>
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Reload saved contextual report"
                        disabled={locked}
                        onClick={() => void reloadSaved()}
                    >
                        <RefreshCw
                            aria-hidden="true"
                            className={refreshing ? "animate-spin" : undefined}
                        />
                    </Button>
                </div>
                <ToolLink
                    href="/commitments"
                    className="text-brand-ink text-xs underline underline-offset-4"
                >
                    Open Weekly Actions
                </ToolLink>
            </div>
            <p className="text-ink-3 -mt-3 text-xs leading-relaxed">
                {replayMode
                    ? "Offline replay uses a recorded synthetic model response, with current authorized source bindings and guarded storage. No fresh AI call occurs."
                    : "Generation explicitly calls the configured model and saves this contextual report only after validation."}{" "}
                Reviews record your choice; they do not create actions.
            </p>
            {personalEnabled && (
                <section
                    aria-label="Joseph personal context"
                    className="border-line bg-panel rounded-lg border px-4 py-3"
                >
                    <details
                        open={personalOpen}
                        onToggle={event => setPersonalOpen(event.currentTarget.open)}
                    >
                        <summary className="text-ink cursor-pointer text-sm font-medium">
                            Your roles and Vantage stars · Joseph integration
                        </summary>
                        <p className="text-ink-3 mt-3 text-xs leading-relaxed">
                            Role and star choices are held in this demo server process memory, not
                            browser storage or production PostgreSQL. Browser reload retains them
                            while this server runs; restarting the server resets them. These choices
                            apply to future context preparation; the saved report retains its
                            original context.
                        </p>
                        {personalOpen && <PersonalContextPanel client={personalClient} />}
                    </details>
                    <p role="status" className="text-ink-3 mt-2 text-xs leading-relaxed">
                        {personalReady === null
                            ? "Checking Joseph required context before generation."
                            : personalReady
                              ? "Joseph required context is ready for the next generation."
                              : (personalBlocker ??
                                "Joseph required context is incomplete. Inspect coverage before generation.")}
                    </p>
                    {personalBlocked && (
                        <p className="text-ink-3 mt-2 text-xs">
                            Generation is blocked until required context is ready. Earlier report,
                            citations and human reviews remain available; no company review status
                            is inferred.
                        </p>
                    )}
                </section>
            )}
            {data?.companyArchitecture && !withheld && !state.error && (
                <section
                    aria-label="Available Company Architecture"
                    className="border-line bg-panel flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
                >
                    <div className="min-w-0">
                        <p className="text-ink text-sm font-medium">
                            Company Architecture{" "}
                            <span className="text-ink-3 font-normal">
                                · {data.companyArchitecture.reviewState ?? "unreviewed"}
                            </span>
                        </p>
                        <p className="text-ink-3 mt-1 text-xs">
                            Current authorized company context, available before generation.
                        </p>
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={!data.nativeAgendaId || locked}
                        onClick={() => setSource(data.companyArchitecture!.source)}
                    >
                        Inspect Company Architecture
                    </Button>
                </section>
            )}
            {(state.error ?? error) && (
                <InlineError message={error ?? state.error!} onRetry={() => void reloadSaved()} />
            )}
            {notice && (
                <p role="status" className="text-success text-sm">
                    {notice}
                </p>
            )}
            {busy === "generate" && (
                <div
                    role="status"
                    className="border-line bg-panel text-ink-2 rounded-lg border px-5 py-4 text-sm"
                >
                    Reading authorized context and current evidence… Your saved review stays below
                    until a new report passes validation.
                </div>
            )}
            {state.loading ? (
                <SkeletonRows rows={3} height={130} />
            ) : (
                data && (
                    <>
                        {data.unavailableReason && (
                            <p
                                role="status"
                                className="border-warn/30 bg-warn-soft text-warn rounded-lg border p-4 text-sm"
                            >
                                {data.unavailableReason}
                            </p>
                        )}
                        {report ? (
                            <>
                                <section
                                    aria-label="Saved contextual weekly summary"
                                    className="border-line from-brand-soft rounded-xl border bg-gradient-to-br to-transparent px-5 py-5"
                                >
                                    <div className="mb-3 flex flex-wrap items-center gap-2">
                                        <Badge variant="outline">
                                            {report.execution.mode === "replay"
                                                ? "Recorded AI replay · no fresh model call"
                                                : "Context-aware · AI"}
                                        </Badge>
                                        {report.execution.replay && (
                                            <span className="text-ink-3 text-xs">
                                                Original response:{" "}
                                                {report.execution.replay.originalModelId},{" "}
                                                {report.execution.replay.recordedAt}
                                            </span>
                                        )}
                                        <span className="text-ink-3 text-xs">
                                            Saved {new Date(report.generatedAt).toLocaleString()}
                                        </span>
                                    </div>
                                    <h2 className="text-ink mb-2 text-sm font-semibold">
                                        Weekly Summary
                                    </h2>
                                    <p className="text-ink max-w-[80ch] text-[15px] leading-relaxed">
                                        {report.summary}
                                    </p>
                                </section>
                                <section aria-label="Contextual discussion topics">
                                    <SectionHeading
                                        title="Discussion topics"
                                        aside={`${report.topics.filter(topic => topic.status !== "dismissed").length} for review`}
                                    />
                                    <div className="flex flex-col gap-4">
                                        {report.topics
                                            .filter(topic => topic.status !== "dismissed")
                                            .map((topic, index) => (
                                                <ContextTopicCard
                                                    key={topic.id}
                                                    topic={topic}
                                                    report={report}
                                                    index={index}
                                                    busy={locked}
                                                    onSource={setSource}
                                                    onReview={changes =>
                                                        void review(topic, changes)
                                                    }
                                                    onDecision={() => setDecision(topic)}
                                                />
                                            ))}
                                        {report.topics.every(
                                            topic => topic.status === "dismissed"
                                        ) && (
                                            <EmptyState
                                                title="No topics waiting for review"
                                                body="Your dismissed topics and earlier review records remain saved below."
                                            />
                                        )}
                                    </div>
                                    {report.topics.some(topic => topic.status === "dismissed") && (
                                        <details className="border-line mt-4 rounded-lg border px-4 py-3">
                                            <summary className="text-ink-3 cursor-pointer text-sm">
                                                Dismissed topics (
                                                {
                                                    report.topics.filter(
                                                        topic => topic.status === "dismissed"
                                                    ).length
                                                }
                                                )
                                            </summary>
                                            <div className="mt-3 space-y-3">
                                                {report.topics
                                                    .filter(topic => topic.status === "dismissed")
                                                    .map(topic => (
                                                        <div
                                                            key={topic.id}
                                                            className="flex flex-wrap items-center justify-between gap-2"
                                                        >
                                                            <p className="text-ink-2 text-sm">
                                                                {topic.title}
                                                            </p>
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                disabled={locked}
                                                                onClick={() =>
                                                                    void review(topic, {
                                                                        status: "kept",
                                                                    })
                                                                }
                                                            >
                                                                Keep for review
                                                            </Button>
                                                        </div>
                                                    ))}
                                            </div>
                                        </details>
                                    )}
                                </section>
                                <ExecutionDetails report={report} onSource={setSource} />
                            </>
                        ) : (
                            <EmptyState
                                title={
                                    withheld || state.error
                                        ? "Contextual content is hidden"
                                        : data.unavailableReason
                                          ? "Saved contextual content is withheld"
                                          : "No contextual report saved for this week"
                                }
                                body={
                                    withheld || state.error
                                        ? "Reload to verify the current evidence and access before reviewing this report."
                                        : data.unavailableReason
                                          ? replayMode
                                              ? "Earlier reports and human reviews remain stored. Replay is available only when its recorded evidence still matches the authorized fixture."
                                              : "Earlier contextual reports and human reviews remain stored. Generate a fresh report from the current authorized evidence."
                                          : replayMode
                                            ? "Replay the recorded synthetic response without a fresh AI call. Your native weekly review and earlier human decisions remain available."
                                            : "Generate when you are ready to call the configured model. Your native weekly review and earlier human decisions remain available."
                                }
                                action={
                                    <Button onClick={generate} disabled={locked || personalBlocked}>
                                        <Sparkles aria-hidden="true" />
                                        {replayMode
                                            ? "Replay recorded report"
                                            : "Generate with context"}
                                    </Button>
                                }
                            />
                        )}
                        {data.nativeAgendaId && (
                            <PendingQuestions
                                key={data.nativeAgendaId}
                                agendaId={data.nativeAgendaId}
                            />
                        )}
                        <div className="text-ink-3 border-line flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-xs">
                            <span>
                                The native weekly report and actions use their existing review
                                flows.
                            </span>
                            <ToolLink
                                href={`/agenda?week=${data.selectedWeek}`}
                                className="text-brand-ink underline underline-offset-4"
                            >
                                Open native Weekly Review
                            </ToolLink>
                        </div>
                    </>
                )
            )}
            {data?.nativeAgendaId && (
                <ContextSourceDialog
                    reportId={data.nativeAgendaId}
                    sourceRef={source}
                    onClose={() => setSource(null)}
                    onUnavailable={() => {
                        setWithheld(true);
                        setSource(null);
                        setDecision(null);
                        setError(
                            "The source or its authorization changed. Contextual content is hidden; reload to verify the current review."
                        );
                    }}
                />
            )}
            {report && decision && (
                <DecisionReviewDialog
                    key={decision.id}
                    topic={decision}
                    busy={locked}
                    onClose={() => setDecision(null)}
                    onSave={value => void review(decision, { decision: value })}
                />
            )}
        </div>
    );
}

function ContextTopicCard({
    topic,
    report,
    index,
    busy,
    onSource,
    onReview,
    onDecision,
}: {
    topic: DemoTopic;
    report: DemoReport;
    index: number;
    busy: boolean;
    onSource: (ref: DemoSourceRef) => void;
    onReview: (changes: Pick<DemoTopicReview, "status" | "decision">) => void;
    onDecision: () => void;
}) {
    const names = new Map(
        report.diagnostics.sources.map(item => [demoSourceKey(item.source), item.title])
    );
    const refs = (values: DemoSourceRef[]) => (
        <div className="mt-2 flex flex-wrap gap-1.5">
            {values.map(ref => (
                <Button
                    key={demoSourceKey(ref)}
                    variant="outline"
                    size="sm"
                    className="h-auto max-w-full whitespace-normal break-words text-left text-[11px]"
                    title={demoSourceName(ref)}
                    onClick={() => onSource(ref)}
                >
                    {names.get(demoSourceKey(ref)) ?? `${ref.kind}:${ref.id}`}{" "}
                    <span className="text-ink-3">
                        · v{ref.version.length < 18 ? ref.version : `${ref.version.slice(0, 12)}…`}
                    </span>
                </Button>
            ))}
        </div>
    );
    return (
        <article
            aria-label={topic.title}
            className="border-line bg-panel overflow-hidden rounded-xl border"
        >
            <div className="border-line flex flex-col items-start justify-between gap-3 border-b px-5 py-4 sm:flex-row">
                <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <span className="text-ink-3 text-[11px]">Topic {index + 1}</span>
                        <Badge variant={topic.status === "kept" ? "success" : "outline"}>
                            {topic.status === "kept" ? "Kept for review" : "AI suggestion"}
                        </Badge>
                    </div>
                    <h3 className="text-ink text-base font-semibold leading-snug">{topic.title}</h3>
                </div>
                <div className="flex shrink-0 gap-1.5">
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || topic.status === "kept"}
                        onClick={() => onReview({ status: "kept" })}
                    >
                        <Check aria-hidden="true" />
                        {topic.status === "kept" ? "Kept" : "Keep"}
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => onReview({ status: "dismissed" })}
                    >
                        <X aria-hidden="true" />
                        Dismiss
                    </Button>
                </div>
            </div>
            <div className="flex flex-col gap-5 px-5 py-5">
                <TopicPart title="What the sources report" basis="observed">
                    <ul className="space-y-3">
                        {topic.facts.map((fact, index) => (
                            <li key={index}>
                                <p>{fact.text}</p>
                                {refs(fact.refs)}
                            </li>
                        ))}
                    </ul>
                </TopicPart>
                <TopicPart title="Why it merits discussion" basis="interpretation">
                    <p>{topic.whyItMatters}</p>
                </TopicPart>
                <div className="border-brand/20 bg-brand-soft rounded-lg border px-4 py-3">
                    <p className="text-brand-ink mb-1 text-[11px] font-semibold uppercase tracking-wide">
                        Decision question
                    </p>
                    <p className="text-ink text-sm font-medium leading-relaxed">
                        {topic.decisionQuestion}
                    </p>
                </div>
                {topic.proposedNextStep && (
                    <TopicPart title="Proposed next step" basis="suggestion">
                        <p>{topic.proposedNextStep}</p>
                    </TopicPart>
                )}
                {topic.decision && (
                    <div className="border-line rounded-lg border border-dashed p-3">
                        <p className="text-ink text-sm font-medium">
                            Your recorded decision: {DECISION_LABEL[topic.decision.value]}
                        </p>
                        {topic.decision.text && (
                            <p className="mt-1 text-sm">{topic.decision.text}</p>
                        )}
                        <p className="text-ink-3 mt-1 text-xs">
                            Recorded {new Date(topic.decision.recordedAt).toLocaleString()} · work
                            completion remains unverified
                        </p>
                    </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <details className="text-ink-3 max-w-full text-xs">
                        <summary className="flex cursor-pointer list-none items-center gap-1.5">
                            <ChevronDown size={13} aria-hidden="true" />
                            Uncertainty &amp; rationale
                        </summary>
                        <div className="mt-3 space-y-3 text-[13px] leading-relaxed">
                            {topic.unknowns.length > 0 && (
                                <ul className="list-disc space-y-1 pl-4">
                                    {topic.unknowns.map((unknown, index) => (
                                        <li key={index}>{unknown}</li>
                                    ))}
                                </ul>
                            )}
                            {topic.conflicts.map((conflict, index) => (
                                <div key={index}>
                                    <BasisTag basis="conflict" />
                                    <p className="mt-1">{conflict.text}</p>
                                    {refs(conflict.refs)}
                                </div>
                            ))}
                            <p>{topic.rationale}</p>
                        </div>
                    </details>
                    <Button variant="outline" size="sm" disabled={busy} onClick={onDecision}>
                        {topic.decision ? "Update decision" : "Record decision"}
                    </Button>
                </div>
            </div>
        </article>
    );
}

function TopicPart({
    title,
    basis,
    children,
}: {
    title: string;
    basis: "observed" | "interpretation" | "suggestion";
    children: ReactNode;
}) {
    return (
        <div className="text-ink-2 text-[13px] leading-relaxed">
            <div className="mb-2 flex items-center gap-2">
                <h4 className="text-ink text-xs font-semibold">{title}</h4>
                <BasisTag basis={basis} />
            </div>
            {children}
        </div>
    );
}

function ExecutionDetails({
    report,
    onSource,
}: {
    report: DemoReport;
    onSource: (ref: DemoSourceRef) => void;
}) {
    const context = report.diagnostics.context;
    return (
        <details className="border-line text-ink-3 rounded-lg border px-4 py-3 text-xs">
            <summary className="cursor-pointer">
                Saved report details · {report.execution.modelId} ·{" "}
                {report.diagnostics.sources.length} sources
            </summary>
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
                <dt>Generation</dt>
                <dd>
                    {report.execution.mode === "replay" ? (
                        "Recorded replay · no model call"
                    ) : (
                        <>
                            AI · {report.execution.attempts}{" "}
                            {report.execution.attempts === 1 ? "attempt" : "attempts"} ·{" "}
                            {(report.execution.durationMs / 1000).toFixed(1)}s
                        </>
                    )}
                </dd>
                <dt>Persistence</dt>
                <dd>Saved contextual report · revision {report.version}</dd>
                {report.execution.reasoningEffort && (
                    <>
                        <dt>Reasoning effort</dt>
                        <dd>{report.execution.reasoningEffort} · explicit local demo setting</dd>
                    </>
                )}
                <dt>Prompt</dt>
                <dd className="break-all font-mono">{report.execution.promptVersion}</dd>
                <dt>Context</dt>
                <dd className="break-all font-mono">{report.diagnostics.contextFingerprint}</dd>
                {context && (
                    <>
                        <dt>Sophia retrieval</dt>
                        <dd>{context.retrievalStatus}</dd>
                        <dt>Manifest</dt>
                        <dd>{context.manifestStatus}</dd>
                        <dt>Research</dt>
                        <dd>
                            {context.researchMode} · {context.researchStatus}
                        </dd>
                        <dt>Role IDs</dt>
                        <dd className="break-words">
                            {context.roleIds.join(", ") || "None supplied"} · synthetic resolver
                        </dd>
                        <dt>Personal Stars</dt>
                        <dd>{context.personalStarCount} · synthetic resolver</dd>
                        <dt>Selection</dt>
                        <dd>
                            {context.selectedCount} selected · {context.missingCount} missing refs ·{" "}
                            {context.omittedCount} omission events
                        </dd>
                        <dt>Optional unavailable</dt>
                        <dd>
                            {context.optionalUnavailableCount} records; unavailable identities are
                            withheld
                        </dd>
                    </>
                )}
                {report.diagnostics.promptBytes !== undefined && (
                    <>
                        <dt>Prepared prompt</dt>
                        <dd>{report.diagnostics.promptBytes.toLocaleString()} bytes</dd>
                    </>
                )}
                <dt>Past human decisions</dt>
                <dd>
                    {report.diagnostics.historicalHumanDecisions} historical records; current work
                    state is unverified
                </dd>
            </dl>
            {!context && (
                <p className="mt-3">
                    Context selection diagnostics were not captured for this saved report.
                </p>
            )}
            {report.diagnostics.promptOmissions?.some(
                item => item.previousSummary || item.previousContext || item.previousTopics > 0
            ) && (
                <div className="mt-3 space-y-1">
                    <p className="font-medium">Previous-report prompt omissions</p>
                    {report.diagnostics.promptOmissions.map((item, index) => (
                        <p key={index}>
                            Attempt {index + 1}: {item.previousTopics} topics omitted
                            {item.previousSummary ? " · summary omitted" : ""}
                            {item.previousContext ? " · context omitted" : ""}
                        </p>
                    ))}
                </div>
            )}
            <details className="mt-3">
                <summary className="cursor-pointer">
                    Selected exact source references ({report.diagnostics.sources.length})
                </summary>
                <ul className="mt-2 space-y-2">
                    {report.diagnostics.sources.map(item => (
                        <li key={demoSourceKey(item.source)}>
                            <button
                                type="button"
                                className="text-brand-ink focus-visible:ring-brand/50 max-w-full text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2"
                                onClick={() => onSource(item.source)}
                            >
                                {item.title}
                                <span className="text-ink-3 mt-0.5 block break-all font-mono text-[10px]">
                                    {demoSourceName(item.source)}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            </details>
            {context && (context.missingCount > 0 || context.omittedCount > 0) && (
                <details className="mt-3">
                    <summary className="cursor-pointer">Missing and omitted context</summary>
                    <div className="mt-2 space-y-2">
                        {context.missingCount > 0 && (
                            <div>
                                <p>Missing references: {context.missingCount}</p>
                                {context.missingRefs.map(ref => (
                                    <p
                                        key={demoSourceKey(ref)}
                                        className="mt-1 break-all font-mono text-[10px]"
                                    >
                                        {demoSourceName(ref)}
                                    </p>
                                ))}
                            </div>
                        )}
                        {context.omittedCount > 0 && (
                            <div>
                                <p>Omission events: {context.omittedCount}</p>
                                {context.omittedRefs.map(ref => (
                                    <p
                                        key={demoSourceKey(ref)}
                                        className="mt-1 break-all font-mono text-[10px]"
                                    >
                                        {demoSourceName(ref)}
                                    </p>
                                ))}
                            </div>
                        )}
                        <p>
                            Only source identities available with current access are shown. These
                            records were missing or omitted from context, not verified as complete
                            work.
                        </p>
                    </div>
                </details>
            )}
            <p className="mt-3">
                Business role and required-source discovery use the local synthetic fixture. Exact
                authorized source versions are rechecked before save and when viewed. Company
                profile claims remain unreviewed.
            </p>
        </details>
    );
}

function DecisionReviewDialog({
    topic,
    busy,
    onClose,
    onSave,
}: {
    topic: DemoTopic;
    busy: boolean;
    onClose: () => void;
    onSave: (decision: NonNullable<DemoTopicReview["decision"]>) => void;
}) {
    const [value, setValue] = useState<DemoHumanDecision["value"]>(
        topic.decision?.value ?? "needs-more-evidence"
    );
    const [note, setNote] = useState(topic.decision?.text ?? "");
    return (
        <Dialog open onOpenChange={open => !open && !busy && onClose()}>
            <DialogContent className="max-h-[85dvh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Record your decision</DialogTitle>
                    <DialogDescription>{topic.decisionQuestion}</DialogDescription>
                </DialogHeader>
                <fieldset disabled={busy} className="space-y-2">
                    <legend className="text-ink-3 mb-2 text-xs">Your review outcome</legend>
                    {(Object.keys(DECISION_LABEL) as DemoHumanDecision["value"][]).map(choice => (
                        <label
                            key={choice}
                            className="border-line flex cursor-pointer items-center gap-3 rounded-md border px-3 py-3 text-sm"
                        >
                            <input
                                type="radio"
                                name="context-decision"
                                value={choice}
                                checked={value === choice}
                                onChange={() => setValue(choice)}
                                className="accent-brand"
                            />
                            {DECISION_LABEL[choice]}
                        </label>
                    ))}
                </fieldset>
                <label className="text-ink-3 space-y-2 text-xs">
                    Decision note (optional)
                    <Textarea
                        value={note}
                        onChange={event => setNote(event.target.value)}
                        maxLength={1600}
                        disabled={busy}
                        placeholder="What did you decide, and what evidence informed it?"
                    />
                </label>
                <p className="text-ink-3 text-xs leading-relaxed">
                    This saves a human review record. It does not create a commitment, confirm work
                    completion, or close a pending historical question.
                </p>
                <div className="flex justify-end gap-2">
                    <Button variant="outline" disabled={busy} onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        disabled={busy}
                        onClick={() =>
                            onSave({ value, ...(note.trim() ? { text: note.trim() } : {}) })
                        }
                    >
                        {busy && <Loader2 className="animate-spin" aria-hidden="true" />}Save
                        decision
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
