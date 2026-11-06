"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";
import { WeeklyBrief } from "../../tools/vantage/_components/WeeklyBrief";
import { CompactTopicRow } from "../../tools/vantage/_components/CompactTopicRow";
import { TopicDetailSheet } from "../../tools/vantage/_components/TopicDetailSheet";
import { demoSourceKey, demoSourceName } from "../../tools/vantage/demo-api";
import type {
    DemoHumanDecision,
    DemoReport,
    DemoSource,
    DemoSourceRef,
    DemoState,
    DemoTopic,
    DemoTopicReview,
} from "../../tools/vantage/demo-contract";
import styles from "./finance-review.module.css";

interface ArchitectureState {
    revision: number;
    state: "reviewed" | "unknowns-marked" | "unreviewed";
    projectionFingerprint: string;
    available: boolean;
    projection: {
        status: "available" | "partial" | "blocked";
        facts: {
            path: string;
            label: string;
            value: string;
            subject?: string;
            basis: string;
            sources: { documentId: string; versionId: string | null; quote: string | null }[];
        }[];
        unknowns: { code: string; count?: number }[];
        includedFactPaths: string[];
        omittedFactCount: number;
    };
}
const endpoint = "/api/vantage/contextual";
const decisionLabels: Record<DemoHumanDecision["value"], string> = {
    go: "Go",
    "no-go": "No-go",
    "needs-more-evidence": "Needs more evidence",
};

class ContextRequestError extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message);
    }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(path, { ...init, cache: "no-store" });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const message =
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
                ? body.error
                : "The request could not be completed.";
        throw new ContextRequestError(response.status, message);
    }
    return body as T;
}

function reportPath(id: string) {
    return endpoint + "/reports/" + encodeURIComponent(id);
}

function accessChanged(reason: unknown) {
    return reason instanceof ContextRequestError && [401, 403, 404, 409].includes(reason.status);
}

export function FinanceReview() {
    const [state, setState] = useState<DemoState | null>(null);
    const [architectureReady, setArchitectureReady] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [topicId, setTopicId] = useState<string | null>(null);
    const [source, setSource] = useState<DemoSourceRef | null>(null);
    const [decision, setDecision] = useState<{
        topicId: string;
        choice: DemoHumanDecision["value"];
    } | null>(null);
    const trigger = useRef<HTMLButtonElement | null>(null);
    const running = useRef(false);
    const report = state?.report ?? null;
    const topic = report?.topics.find(item => item.id === topicId) ?? null;
    const decisionTopic = report?.topics.find(item => item.id === decision?.topicId) ?? null;

    useEffect(() => {
        const controller = new AbortController();
        request<DemoState>(endpoint, { signal: controller.signal })
            .then(value => setState(value))
            .catch(reason => {
                if (!controller.signal.aborted) {
                    setError(
                        reason instanceof Error ? reason.message : "Could not load the review."
                    );
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, []);

    function closeDetails() {
        setTopicId(null);
        setSource(null);
        setDecision(null);
    }

    async function reloadSaved(id?: string, message = "The saved review was reloaded.") {
        setLoading(true);
        setError(null);
        setNotice(null);
        setArchitectureReady(false);
        setState(null);
        closeDetails();
        try {
            const next = await request<DemoState>(id ? reportPath(id) : endpoint);
            setState(next);
            setNotice(message);
        } catch (reason) {
            setError(
                reason instanceof Error ? reason.message : "The saved review could not be reloaded."
            );
        } finally {
            setLoading(false);
        }
    }

    async function prepare() {
        if (!state || running.current) return;
        running.current = true;
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            const next = await request<DemoState>(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ weekStart: state.selectedWeek }),
            });
            setState(next);
            setNotice("The deterministic review was saved.");
        } catch (reason) {
            if (accessChanged(reason)) {
                setArchitectureReady(false);
                setState(null);
                closeDetails();
            }
            setError(reason instanceof Error ? reason.message : "Could not prepare the review.");
        } finally {
            running.current = false;
            setBusy(false);
        }
    }

    async function saveReview(
        selected: DemoTopic,
        changes: Pick<DemoTopicReview, "status" | "decision">
    ) {
        if (!report || running.current) return;
        running.current = true;
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            const next = await request<DemoState>(reportPath(report.id), {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    topicId: selected.id,
                    expectedVersion: report.version,
                    ...changes,
                }),
            });
            setState(next);
            setDecision(null);
            setNotice("Review saved. No action or commitment was created.");
        } catch (reason) {
            if (reason instanceof ContextRequestError && reason.status === 409) {
                await reloadSaved(
                    report.id,
                    "The report or its sources changed. The current saved version was reloaded; review it before trying again."
                );
            } else {
                if (accessChanged(reason)) {
                    setArchitectureReady(false);
                    setState(null);
                    closeDetails();
                }
                setError(reason instanceof Error ? reason.message : "Could not save the review.");
            }
        } finally {
            running.current = false;
            setBusy(false);
        }
    }

    function sourceUnavailable() {
        setArchitectureReady(false);
        setState(null);
        closeDetails();
        setError(
            "The source or your access changed. The review is hidden until it can be reloaded."
        );
    }

    return (
        <main className={styles.page}>
            <header className={styles.header}>
                <div>
                    <p className={styles.eyebrow}>Vantage / Finance</p>
                    <h1 className={styles.heading}>Weekly revenue review</h1>
                    <p className={styles.subheading}>
                        Compare the reported definitions, inspect the sources, and record your
                        review.
                    </p>
                </div>
                <Button
                    variant="outline"
                    disabled={loading || busy}
                    onClick={() => void reloadSaved(report?.id)}
                >
                    Reload saved review
                </Button>
            </header>

            <aside className={styles.banner} aria-label="Replay disclosure">
                <strong>Deterministic simulated generation</strong>
                <p>
                    This isolated review uses authored synthetic Finance and Sales documents and a
                    deterministic replay. No live model is called. This checks the review workflow;
                    it does not establish model quality or fix the historical Finance omission.
                </p>
            </aside>

            {loading && (
                <p role="status" className={styles.status}>
                    Loading the saved review...
                </p>
            )}
            {error && (
                <p role="alert" className={styles.error}>
                    {error}
                </p>
            )}
            {notice && (
                <p role="status" className={styles.status}>
                    {notice}
                </p>
            )}
            {!loading && state?.unavailableReason && (
                <p role="alert" className={styles.error}>
                    Saved content is unavailable with the current sources or access. Reload to check
                    again.
                </p>
            )}
            {!loading && state && (
                <CompanyContext
                    onReadyChange={setArchitectureReady}
                    hasSavedReport={!!report}
                    onUnavailable={sourceUnavailable}
                />
            )}
            {!loading && state && !report && !state.unavailableReason && (
                <section className={styles.empty}>
                    <h2>No saved review yet</h2>
                    <p>
                        Review the company context first, then prepare the deterministic Finance
                        review for the selected reporting week.
                    </p>
                    <Button disabled={busy || !architectureReady} onClick={() => void prepare()}>
                        {busy ? "Preparing review..." : "Prepare simulated review"}
                    </Button>
                </section>
            )}
            {!loading && report && (
                <div className={styles.content}>
                    <WeeklyBrief report={report} />
                    {report.keyFigures && report.keyFigures.length > 0 && (
                        <section aria-label="Reported figures">
                            <div className={styles.sectionHeading}>
                                <h2>Reported figures</h2>
                                <p>Definitions differ</p>
                            </div>
                            <div className={styles.figureGrid}>
                                {report.keyFigures.map((figure, index) => (
                                    <article className={styles.figure} key={index}>
                                        <p className={styles.figureLabel}>{figure.label}</p>
                                        <p className={styles.figureValue}>{figure.value}</p>
                                        {figure.refs.map(ref => (
                                            <button
                                                type="button"
                                                className={styles.sourceButton}
                                                key={demoSourceKey(ref)}
                                                onClick={() => setSource(ref)}
                                            >
                                                Open {sourceTitle(report, ref)}
                                            </button>
                                        ))}
                                    </article>
                                ))}
                            </div>
                        </section>
                    )}
                    <section aria-label="Decisions to review">
                        <div className={styles.sectionHeading}>
                            <h2>Decisions to review</h2>
                            <p>
                                {report.topics.length}{" "}
                                {report.topics.length === 1 ? "topic" : "topics"}
                            </p>
                        </div>
                        <div className={styles.topicList}>
                            {report.topics.map(item => (
                                <CompactTopicRow
                                    key={item.id}
                                    topic={item}
                                    report={report}
                                    selected={topicId === item.id}
                                    onOpen={element => {
                                        trigger.current = element;
                                        setTopicId(item.id);
                                    }}
                                />
                            ))}
                        </div>
                    </section>
                    <details className={styles.details}>
                        <summary>Sources and report details</summary>
                        <ul>
                            {report.diagnostics.sources.map(item => (
                                <li key={demoSourceKey(item.source)}>
                                    <button
                                        type="button"
                                        className={styles.sourceButton}
                                        onClick={() => setSource(item.source)}
                                    >
                                        {item.title}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </details>
                    <p className={styles.footer}>
                        Reporting week {report.weekStart} / Saved version {report.version}. A source
                        reference identifies supplied content; it does not verify the
                        interpretation.
                        {report.diagnostics.semanticAssessment && (
                            <>
                                {" "}
                                Deterministic coverage checklist:{" "}
                                {report.diagnostics.semanticAssessment.passed ? "passed" : "failed"}
                                . No model Judge was used; this is not a semantic quality result.
                            </>
                        )}
                    </p>
                </div>
            )}
            {report && topic && (
                <TopicDetailSheet
                    open
                    topic={topic}
                    report={report}
                    busy={busy}
                    triggerRef={trigger}
                    onOpenChange={open => {
                        if (!open) setTopicId(null);
                    }}
                    onSource={setSource}
                    onReview={status => void saveReview(topic, { status })}
                    onDecision={choice => {
                        if (choice) setDecision({ topicId: topic.id, choice });
                    }}
                />
            )}
            {report && source && (
                <SourceDialog
                    reportId={report.id}
                    sourceRef={source}
                    onClose={() => setSource(null)}
                    onUnavailable={sourceUnavailable}
                />
            )}
            {decision && decisionTopic && (
                <DecisionDialog
                    key={decisionTopic.id + ":" + decision.choice}
                    topic={decisionTopic}
                    initialValue={decision.choice}
                    busy={busy}
                    onClose={() => setDecision(null)}
                    onSave={value => void saveReview(decisionTopic, { decision: value })}
                />
            )}
        </main>
    );
}

function CompanyContext({
    onReadyChange,
    hasSavedReport,
    onUnavailable,
}: {
    onReadyChange: (ready: boolean) => void;
    hasSavedReport: boolean;
    onUnavailable: () => void;
}) {
    const [context, setContext] = useState<ArchitectureState | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [refresh, setRefresh] = useState(0);
    const running = useRef(false);
    const unavailable = useRef(onUnavailable);
    unavailable.current = onUnavailable;

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        setContext(null);
        onReadyChange(false);
        request<ArchitectureState>(endpoint + "/architecture", { signal: controller.signal })
            .then(value => {
                setContext(value);
                onReadyChange(value.available && value.state !== "unreviewed");
            })
            .catch(reason => {
                if (!controller.signal.aborted) {
                    if (accessChanged(reason)) unavailable.current();
                    else
                        setError(
                            reason instanceof Error
                                ? reason.message
                                : "Could not load company context."
                        );
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [onReadyChange, refresh]);

    async function confirmReview() {
        if (!context?.available || running.current) return;
        running.current = true;
        setBusy(true);
        setError(null);
        setNotice(null);
        const state =
            context.projection.unknowns.length || context.projection.omittedFactCount
                ? "unknowns-marked"
                : "reviewed";
        try {
            await request(endpoint + "/architecture", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    expectedRevision: context.revision,
                    expectedProjectionFingerprint: context.projectionFingerprint,
                    state,
                }),
            });
            const current = await request<ArchitectureState>(endpoint + "/architecture");
            setContext(current);
            onReadyChange(current.available && current.state !== "unreviewed");
            setConfirming(false);
            if (!current.available || current.state !== state) {
                onReadyChange(false);
                setError("Company context changed after review. Inspect the current projection.");
                return;
            }
            setNotice("Company context review saved for this exact projection.");
        } catch (reason) {
            if (accessChanged(reason)) {
                setContext(null);
                onReadyChange(false);
                setConfirming(false);
                if (reason instanceof ContextRequestError && reason.status === 409) {
                    setNotice(
                        "Company context changed. Inspect the current projection before reviewing again."
                    );
                    setRefresh(value => value + 1);
                } else {
                    unavailable.current();
                }
            }
            setError(
                reason instanceof Error ? reason.message : "Could not save the context review."
            );
        } finally {
            running.current = false;
            setBusy(false);
        }
    }

    return (
        <section className={styles.context} aria-label="Company context review">
            <div className={styles.sectionHeading}>
                <h2>Company context</h2>
                <p>{context ? context.state.replaceAll("-", " ") : "Checking"}</p>
            </div>
            {loading && <p role="status">Checking the authorized context...</p>}
            {error && (
                <p role="alert" className={styles.contextError}>
                    {error}
                </p>
            )}
            {notice && (
                <p role="status" className={styles.contextNotice}>
                    {notice}
                </p>
            )}
            {!loading && !context && (
                <Button variant="outline" size="sm" onClick={() => setRefresh(value => value + 1)}>
                    Reload company context
                </Button>
            )}
            {context && (
                <>
                    <p className={styles.contextIntro}>
                        Projection: {context.projection.status}. Review applies to the displayed
                        projection, not to the truth of every source claim.
                    </p>
                    <details open={context.state === "unreviewed" ? true : undefined}>
                        <summary>Inspect authorized facts, sources, and unknowns</summary>
                        {context.projection.facts.length ? (
                            <dl className={styles.facts}>
                                {context.projection.facts.map(fact => (
                                    <div key={fact.path} className={styles.fact}>
                                        <dt>
                                            {fact.label}
                                            {fact.subject ? " / " + fact.subject : ""}
                                        </dt>
                                        <dd>{fact.value}</dd>
                                        <dd className={styles.provenance}>
                                            {fact.path} / {fact.basis}
                                        </dd>
                                        {fact.sources.map((source, index) => (
                                            <dd key={index} className={styles.provenance}>
                                                Document {source.documentId} / version{" "}
                                                {source.versionId ?? "not supplied"}
                                                {source.quote && (
                                                    <blockquote>{source.quote}</blockquote>
                                                )}
                                            </dd>
                                        ))}
                                        {!fact.sources.length && (
                                            <dd className={styles.provenance}>
                                                No source supplied.
                                            </dd>
                                        )}
                                    </div>
                                ))}
                            </dl>
                        ) : (
                            <p className={styles.contextIntro}>
                                No authorized facts are available.
                            </p>
                        )}
                        <h3 className={styles.contextSubheading}>Unknowns</h3>
                        {context.projection.unknowns.length ? (
                            <ul className={styles.unknownList}>
                                {context.projection.unknowns.map((unknown, index) => (
                                    <li key={index}>
                                        {unknown.code}
                                        {unknown.count !== undefined
                                            ? " (" + unknown.count + ")"
                                            : ""}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className={styles.contextIntro}>No unknowns supplied.</p>
                        )}
                        <p className={styles.contextIntro}>
                            Omitted facts: {context.projection.omittedFactCount}. Only facts
                            authorized for this workspace are shown.
                        </p>
                        {context.available && !hasSavedReport && (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => setConfirming(true)}
                            >
                                {context.state === "unreviewed"
                                    ? "Review company context"
                                    : "Review company context again"}
                            </Button>
                        )}
                        {hasSavedReport && (
                            <p className={styles.contextIntro}>
                                The saved report is bound to this context review.
                            </p>
                        )}
                    </details>
                    {!context.available && (
                        <p role="status" className={styles.contextNotice}>
                            Context is not available for review. Resolve the missing source or
                            profile information before preparing a report.
                        </p>
                    )}
                    {confirming && (
                        <Dialog open onOpenChange={open => !open && !busy && setConfirming(false)}>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Confirm company context review</DialogTitle>
                                    <DialogDescription>
                                        Confirm that you inspected the displayed facts, their source
                                        references, and the listed unknowns for this exact
                                        projection.
                                    </DialogDescription>
                                </DialogHeader>
                                <p className="text-ink-3 text-sm">
                                    {context.projection.unknowns.length ||
                                    context.projection.omittedFactCount
                                        ? "The review will record that unknowns or omissions remain."
                                        : "The review will record this projection as reviewed."}
                                </p>
                                <div className="flex justify-end gap-2">
                                    <Button
                                        variant="outline"
                                        disabled={busy}
                                        onClick={() => setConfirming(false)}
                                    >
                                        Cancel
                                    </Button>
                                    <Button disabled={busy} onClick={() => void confirmReview()}>
                                        {busy ? "Saving..." : "Confirm context review"}
                                    </Button>
                                </div>
                            </DialogContent>
                        </Dialog>
                    )}
                </>
            )}
        </section>
    );
}
function sourceTitle(report: DemoReport, ref: DemoSourceRef) {
    return (
        report.diagnostics.sources.find(item => demoSourceKey(item.source) === demoSourceKey(ref))
            ?.title ?? demoSourceName(ref)
    );
}

function SourceDialog({
    reportId,
    sourceRef,
    onClose,
    onUnavailable,
}: {
    reportId: string;
    sourceRef: DemoSourceRef;
    onClose: () => void;
    onUnavailable: () => void;
}) {
    const [source, setSource] = useState<DemoSource | null>(null);
    const [error, setError] = useState<string | null>(null);
    const unavailable = useRef(onUnavailable);
    unavailable.current = onUnavailable;

    useEffect(() => {
        const controller = new AbortController();
        const query = new URLSearchParams({
            kind: sourceRef.kind,
            id: sourceRef.id,
            version: sourceRef.version,
        });
        request<DemoSource>(reportPath(reportId) + "/source?" + query.toString(), {
            signal: controller.signal,
        })
            .then(value => setSource(value))
            .catch(reason => {
                if (controller.signal.aborted) return;
                if (accessChanged(reason)) unavailable.current();
                else
                    setError(
                        reason instanceof Error ? reason.message : "Could not open this source."
                    );
            });
        return () => controller.abort();
    }, [reportId, sourceRef]);

    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-[720px]">
                <DialogHeader>
                    <DialogTitle>{source?.title ?? "Open exact source"}</DialogTitle>
                    <DialogDescription className="break-all">
                        {demoSourceName(sourceRef)}
                    </DialogDescription>
                </DialogHeader>
                {!source && !error && <p role="status">Checking access to the exact source...</p>}
                {error && <p role="alert">{error}</p>}
                {source && (
                    <>
                        <p className="text-ink-3 text-xs">
                            Exact version {source.source.version}
                            {source.sourceDate ? " / " + source.sourceDate.slice(0, 10) : ""}
                        </p>
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                            {source.body}
                        </p>
                        <p className="text-ink-3 text-xs">{source.authority}</p>
                        <details className="text-ink-3 text-xs">
                            <summary>Content provenance</summary>
                            <p className="mt-2 break-all">SHA-256 {source.contentHash}</p>
                        </details>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

function DecisionDialog({
    topic,
    initialValue,
    busy,
    onClose,
    onSave,
}: {
    topic: DemoTopic;
    initialValue: DemoHumanDecision["value"];
    busy: boolean;
    onClose: () => void;
    onSave: (decision: NonNullable<DemoTopicReview["decision"]>) => void;
}) {
    const [value, setValue] = useState<DemoHumanDecision["value"]>(initialValue);
    const [note, setNote] = useState(topic.decision?.text ?? "");
    return (
        <Dialog open onOpenChange={open => !open && !busy && onClose()}>
            <DialogContent className="max-h-[85dvh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Confirm your decision</DialogTitle>
                    <DialogDescription>{topic.decisionQuestion}</DialogDescription>
                </DialogHeader>
                <fieldset disabled={busy} className="space-y-2">
                    <legend className="text-ink-3 mb-2 text-xs">Your review outcome</legend>
                    {(Object.keys(decisionLabels) as DemoHumanDecision["value"][]).map(choice => (
                        <label
                            key={choice}
                            className="border-line flex cursor-pointer items-center gap-3 rounded-md border px-3 py-3 text-sm"
                        >
                            <input
                                type="radio"
                                name="finance-decision"
                                value={choice}
                                checked={value === choice}
                                onChange={() => setValue(choice)}
                            />
                            {decisionLabels[choice]}
                        </label>
                    ))}
                </fieldset>
                <label className="text-ink-3 space-y-2 text-xs">
                    Decision note (optional)
                    <Textarea
                        value={note}
                        onChange={event => setNote(event.target.value)}
                        maxLength={1000}
                        disabled={busy}
                        placeholder="What did you decide, and what evidence informed it?"
                    />
                </label>
                <p className="text-ink-3 text-xs leading-relaxed">
                    This records your decision. It does not create a commitment or verify work.
                </p>
                <div className="flex justify-end gap-2">
                    <Button variant="outline" disabled={busy} onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        disabled={busy}
                        onClick={() =>
                            onSave({
                                value,
                                ...(note.trim() ? { text: note.trim() } : {}),
                            })
                        }
                    >
                        {busy ? "Saving..." : "Confirm and save decision"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
