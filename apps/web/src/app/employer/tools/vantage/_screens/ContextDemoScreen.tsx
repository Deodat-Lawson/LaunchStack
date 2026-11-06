"use client";

import {
    TriangleAlert,
    ChevronLeft,
    ChevronRight,
    Loader2,
    RefreshCw,
    SlidersHorizontal,
    Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { useToolNav } from "~/components/tool-app/nav";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";

import { SkeletonRows } from "~/components/tools/SkeletonRows";
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
import { MyContextSheet } from "../_components/MyContextSheet";
import { WeeklyBrief } from "../_components/WeeklyBrief";
import ui from "./unified-review.module.css";
import { calendarAdd } from "../_lib/reporting";
import { ContextSourceDialog } from "../_components/ContextSourceDialog";
import { PendingQuestions } from "../_components/PendingQuestions";
import { CompactTopicRow } from "../_components/CompactTopicRow";
import { TopicDetailSheet } from "../_components/TopicDetailSheet";
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
    const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
    const topicTrigger = useRef<HTMLButtonElement | null>(null);
    const [decision, setDecision] = useState<DemoTopic | null>(null);
    const [personalOpen, setPersonalOpen] = useState(false);
    const personalTrigger = useRef<HTMLButtonElement | null>(null);
    const [topicFilter, setTopicFilter] = useState("all");
    const [pendingCount, setPendingCount] = useState<number | null>(null);
    const [decisionChoice, setDecisionChoice] = useState<DemoHumanDecision["value"] | undefined>();
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
    const selectedTopic = report?.topics.find(topic => topic.id === selectedTopicId) ?? null;
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
        setSelectedTopicId(null);
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
                if (announce)
                    toast.success("Reloaded the current saved review.", { duration: 2500 });
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
                if (!next.report) {
                    setNotice(
                        "The request finished, but contextual content is unavailable with the current evidence or access."
                    );
                } else {
                    toast.success(
                        label === "generate"
                            ? "Report saved. Earlier reports, decisions and actions are preserved."
                            : "Review saved.",
                        { duration: 2500 }
                    );
                }
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

    const visibleTopics =
        report?.topics.filter(
            topic =>
                topicFilter === "all" ||
                (topicFilter === "open"
                    ? topic.status !== "dismissed" && !topic.decision
                    : topicFilter === "decided"
                      ? !!topic.decision
                      : topic.status === "dismissed")
        ) ?? [];
    const weekOptions = data?.weeks.map(item => item.weekStart).sort() ?? [];
    const weekIndex = data ? weekOptions.indexOf(data.selectedWeek) : -1;
    const chooseWeek = (value: string | undefined) => {
        if (value) navigate(`/?week=${value}`);
    };
    return (
        <div className={ui.review}>
            <header className={ui.reviewHeader}>
                <div>
                    <p className={ui.eyebrow}>Weekly Review</p>
                    <div className={ui.weekPicker}>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Previous week"
                            disabled={locked || weekIndex < 1}
                            onClick={() => chooseWeek(weekOptions[weekIndex - 1])}
                        >
                            <ChevronLeft aria-hidden="true" />
                        </Button>
                        <h1>{data ? reviewWeek(data.selectedWeek) : "Your weekly review"}</h1>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Next week"
                            disabled={
                                locked || weekIndex < 0 || weekIndex === weekOptions.length - 1
                            }
                            onClick={() => chooseWeek(weekOptions[weekIndex + 1])}
                        >
                            <ChevronRight aria-hidden="true" />
                        </Button>
                        {report && (
                            <span className={ui.openCount}>
                                {
                                    report.topics.filter(
                                        topic => topic.status !== "dismissed" && !topic.decision
                                    ).length
                                }{" "}
                                to review
                            </span>
                        )}
                    </div>
                </div>
                <div className={ui.headerActions}>
                    {(personalEnabled || data?.companyArchitecture) && (
                        <Button
                            ref={personalTrigger}
                            variant="outline"
                            onClick={() => setPersonalOpen(true)}
                        >
                            <SlidersHorizontal aria-hidden="true" />
                            My context
                            {data?.companyArchitecture?.reviewState === "unreviewed" && (
                                <span
                                    className={ui.attentionDot}
                                    aria-label="Company profile unreviewed"
                                />
                            )}
                        </Button>
                    )}
                    <Button
                        variant="outline"
                        aria-label="Refresh saved weekly review"
                        disabled={locked}
                        onClick={() => void reloadSaved()}
                    >
                        <RefreshCw
                            className={refreshing ? "animate-spin" : undefined}
                            aria-hidden="true"
                        />
                        Refresh
                    </Button>
                </div>
            </header>
            {personalReady === false && personalEnabled && (
                <div role="status" className={ui.contextNotice}>
                    <TriangleAlert size={16} aria-hidden="true" />
                    <p>
                        Required context needs attention before a fresh report can be prepared.
                        {report
                            ? " Your saved report is still available; Refresh reloads it."
                            : " Refresh checks for an available saved report."}{" "}
                        <button onClick={() => setPersonalOpen(true)}>Inspect My context</button>
                    </p>
                </div>
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
                <p role="status">
                    Preparing the review. Your saved report stays available until the new result is
                    validated.
                </p>
            )}
            {state.loading ? (
                <SkeletonRows rows={3} height={130} />
            ) : (
                data && (
                    <>
                        {data.unavailableReason && (
                            <p role="status" className={ui.contextNotice}>
                                Saved content is unavailable with the current sources or access.
                                Refresh to check again, or open the alternative saved report.
                            </p>
                        )}
                        {report ? (
                            <>
                                <WeeklyBrief report={report} onSource={setSource} />
                                <section aria-label="Decisions to make">
                                    <div className={ui.sectionHeader}>
                                        <h2>Decisions to make</h2>
                                        <div
                                            role="group"
                                            aria-label="Filter decisions"
                                            className={ui.filters}
                                        >
                                            {[
                                                ["all", "All"],
                                                ["open", "To review"],
                                                ["decided", "Decided"],
                                                ["dismissed", "Dismissed"],
                                            ].map(([value, label]) => (
                                                <button
                                                    key={value}
                                                    aria-pressed={topicFilter === value}
                                                    onClick={() => {
                                                        if (value) setTopicFilter(value);
                                                    }}
                                                >
                                                    {label}{" "}
                                                    <span>
                                                        {
                                                            report.topics.filter(
                                                                topic =>
                                                                    value === "all" ||
                                                                    (value === "open"
                                                                        ? topic.status !==
                                                                              "dismissed" &&
                                                                          !topic.decision
                                                                        : value === "decided"
                                                                          ? !!topic.decision
                                                                          : topic.status ===
                                                                            "dismissed")
                                                            ).length
                                                        }
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className={ui.decisionList}>
                                        {visibleTopics.map(topic => (
                                            <CompactTopicRow
                                                key={topic.id}
                                                topic={topic}
                                                report={report}
                                                selected={selectedTopicId === topic.id}
                                                onOpen={trigger => {
                                                    topicTrigger.current = trigger;
                                                    setSelectedTopicId(topic.id);
                                                }}
                                            />
                                        ))}
                                        {!visibleTopics.length && (
                                            <p className="text-ink-3 p-5 text-sm">
                                                No topics in this view. Other saved topics remain
                                                available in the filters above.
                                            </p>
                                        )}
                                    </div>
                                </section>
                            </>
                        ) : (
                            <EmptyState
                                title={
                                    withheld || state.error || data.unavailableReason
                                        ? "Saved content is withheld"
                                        : "No saved weekly brief"
                                }
                                body="Refresh to verify sources, open the alternative saved report, or prepare a review when the required context is ready."
                                action={
                                    <ToolLink
                                        href={`/agenda?week=${data.selectedWeek}&report=rules`}
                                        className="text-brand-ink underline"
                                    >
                                        Open alternative saved report
                                    </ToolLink>
                                }
                            />
                        )}
                        {data.nativeAgendaId && (
                            <details className={ui.historical} open>
                                <summary>
                                    Questions from earlier reviews{" "}
                                    {pendingCount !== null && (
                                        <span className={ui.openCount}>{pendingCount}</span>
                                    )}
                                </summary>
                                <PendingQuestions
                                    key={data.nativeAgendaId}
                                    agendaId={data.nativeAgendaId}
                                    compact
                                    onPendingCount={setPendingCount}
                                />
                            </details>
                        )}
                        <footer className={ui.reportFooter}>
                            <p>
                                {replayMode
                                    ? "Sample report \u00b7 recorded replay \u00b7 no live AI call"
                                    : "Saved report \u00b7 suggestions for human review"}
                            </p>
                            <ToolLink
                                href={`/agenda?week=${data.selectedWeek}&report=rules`}
                                className="underline underline-offset-4"
                            >
                                Alternative saved report
                            </ToolLink>
                        </footer>
                        <details className={ui.reportDetails} id="sources-report-details">
                            <summary>Sources &amp; report details</summary>
                            <label className="mt-4 block text-sm">
                                Reporting week{" "}
                                <select
                                    aria-label="Reporting week"
                                    value={data.selectedWeek}
                                    disabled={locked}
                                    onChange={event => chooseWeek(event.target.value)}
                                >
                                    {data.weeks.map(item => (
                                        <option key={item.weekStart} value={item.weekStart}>
                                            {reviewWeek(item.weekStart)}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <p className="my-4 text-sm">
                                Role and star choices are held by this local demo server and reset
                                when it restarts. They apply to future preparation; saved reports
                                retain their original context. Source versions and access are
                                rechecked before saving and when opened.
                            </p>
                            {personalBlocker && (
                                <p className="my-3 text-xs">
                                    Context diagnostic: {personalBlocker}
                                </p>
                            )}
                            {report && <ExecutionDetails report={report} onSource={setSource} />}
                            <Button
                                className="mt-4"
                                onClick={generate}
                                disabled={locked || personalBlocked}
                            >
                                {busy === "generate" ? (
                                    <Loader2 className="animate-spin" aria-hidden="true" />
                                ) : (
                                    <Sparkles aria-hidden="true" />
                                )}
                                {replayMode ? "Replay sample report" : "Prepare a new report"}
                            </Button>
                        </details>
                    </>
                )
            )}
            <MyContextSheet
                open={personalOpen}
                onOpenChange={setPersonalOpen}
                client={personalClient}
                companyArchitecture={
                    !withheld && !state.error ? data?.companyArchitecture : undefined
                }
                onInspectProfile={() => {
                    if (data?.companyArchitecture) setSource(data.companyArchitecture.source);
                }}
                busy={locked}
                triggerRef={personalTrigger}
            />
            {report && selectedTopic && (
                <TopicDetailSheet
                    open
                    topic={selectedTopic}
                    report={report}
                    busy={locked}
                    triggerRef={topicTrigger}
                    onOpenChange={open => {
                        if (!open) setSelectedTopicId(null);
                    }}
                    onSource={setSource}
                    onReview={status => void review(selectedTopic, { status })}
                    onDecision={value => {
                        setDecisionChoice(value);
                        setDecision(selectedTopic);
                    }}
                />
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
                        setPersonalOpen(false);
                        setError(
                            "The source or its access changed. Content is hidden; refresh before continuing."
                        );
                    }}
                />
            )}
            {report && decision && (
                <DecisionReviewDialog
                    key={`${decision.id}:${decisionChoice ?? "saved"}`}
                    topic={decision}
                    initialValue={decisionChoice}
                    busy={locked}
                    onClose={() => setDecision(null)}
                    onSave={value => void review(decision, { decision: value })}
                />
            )}
        </div>
    );
}

function reviewWeek(week: string) {
    const start = new Date(`${week}T12:00:00Z`);
    const end = new Date(`${calendarAdd(week, 6)}T12:00:00Z`);
    const month = new Intl.DateTimeFormat("en-US", {
        month: "short",
        timeZone: "America/New_York",
    }).format(start);
    const endMonth =
        start.getUTCMonth() === end.getUTCMonth()
            ? ""
            : new Intl.DateTimeFormat("en-US", {
                  month: "short",
                  timeZone: "America/New_York",
              }).format(end) + " ";
    return `${month} ${start.getUTCDate()}\u2013${endMonth}${end.getUTCDate()}`;
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
                Saved report details {"\u00b7"} {report.diagnostics.sources.length} sources
            </summary>
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
                <dt>Model</dt>
                <dd>{report.execution.modelId}</dd>
                <dt>Saved</dt>
                <dd>{new Date(report.generatedAt).toLocaleString()}</dd>
                {report.execution.replay && (
                    <>
                        <dt>Original recorded response</dt>
                        <dd>
                            {report.execution.replay.originalModelId} ·{" "}
                            {report.execution.replay.recordedAt}
                        </dd>
                    </>
                )}
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
    initialValue,
    busy,
    onClose,
    onSave,
}: {
    topic: DemoTopic;
    initialValue?: DemoHumanDecision["value"];
    busy: boolean;
    onClose: () => void;
    onSave: (decision: NonNullable<DemoTopicReview["decision"]>) => void;
}) {
    // Only an explicit click by this reviewer or an existing saved decision supplies a value.
    // There is no AI-derived or default human outcome.
    const [value, setValue] = useState<DemoHumanDecision["value"] | undefined>(
        initialValue ?? topic.decision?.value
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
                        disabled={busy || !value}
                        onClick={() => {
                            if (value)
                                onSave({ value, ...(note.trim() ? { text: note.trim() } : {}) });
                        }}
                    >
                        {busy && <Loader2 className="animate-spin" aria-hidden="true" />}Save
                        decision
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
