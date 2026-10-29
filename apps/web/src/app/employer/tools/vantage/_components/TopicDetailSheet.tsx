"use client";

import type { RefObject } from "react";
import { Button } from "~/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "~/components/ui/sheet";
import { demoSourceKey, demoSourceName } from "../demo-api";
import type { DemoReport, DemoSourceRef, DemoTopic } from "../demo-contract";
import { topicPresentation, type TopicPresentation } from "../_lib/topic-presentation";
import styles from "./compact-topic.module.css";

export interface TopicDetailSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    topic: DemoTopic | null;
    report?: DemoReport;
    presentation?: TopicPresentation;
    busy?: boolean;
    onReview: (status: "kept" | "dismissed") => void;
    onDecision: () => void;
    onSource: (ref: DemoSourceRef) => void;
    sourceName?: (ref: DemoSourceRef) => string;
    triggerRef?: RefObject<HTMLButtonElement | null>;
}

export function TopicDetailSheet({
    open,
    onOpenChange,
    topic,
    report,
    presentation,
    busy = false,
    onReview,
    onDecision,
    onSource,
    sourceName,
    triggerRef,
}: TopicDetailSheetProps) {
    if (!topic) return null;
    const view = presentation ?? topicPresentation(topic);
    const name = (ref: DemoSourceRef) =>
        sourceName?.(ref) ??
        report?.diagnostics.sources.find(item => demoSourceKey(item.source) === demoSourceKey(ref))
            ?.title ??
        `${ref.kind}:${ref.id}`;
    const sourceRefs = [
        ...new Map(
            [...topic.facts, ...topic.conflicts]
                .flatMap(fact => fact.refs)
                .map(ref => [demoSourceKey(ref), ref])
        ).values(),
    ];
    const refs = (values: DemoSourceRef[]) => (
        <div className="mt-2 flex flex-col items-start gap-2">
            {values.map(ref => (
                <button
                    type="button"
                    key={demoSourceKey(ref)}
                    onClick={() => onSource(ref)}
                    className="text-brand-ink max-w-full text-left text-xs underline underline-offset-4 focus-visible:outline focus-visible:outline-2"
                >
                    <span>{name(ref)}</span>
                    <span className="text-ink-3 mt-0.5 block break-all font-mono text-[10px]">
                        {demoSourceName(ref)}
                    </span>
                </button>
            ))}
        </div>
    );
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                className={styles.sheet}
                onCloseAutoFocus={event => {
                    if (triggerRef?.current?.isConnected) {
                        event.preventDefault();
                        triggerRef.current.focus();
                    }
                }}
                onInteractOutside={event => {
                    if ((event.target as Element)?.closest?.('[role="dialog"]'))
                        event.preventDefault();
                }}
            >
                <header className={styles.sheetHeader}>
                    <SheetTitle className="text-lg leading-snug">{view.title}</SheetTitle>
                    <SheetDescription className="mt-2 text-xs">
                        AI suggested ·{" "}
                        {topic.status === "kept"
                            ? "Kept for review"
                            : topic.status === "dismissed"
                              ? "Dismissed"
                              : "Needs review"}
                    </SheetDescription>
                    {view.title !== topic.title && (
                        <p className="sr-only">Original title: {topic.title}</p>
                    )}
                </header>
                <div className={styles.body}>
                    <section>
                        <h3 className={styles.sectionTitle}>Issue</h3>
                        <p>{view.issue}</p>
                    </section>
                    {view.reason && (
                        <section>
                            <h3 className={styles.sectionTitle}>
                                Why this matters{" "}
                                <span className="text-ink-3 font-normal">· AI interpretation</span>
                            </h3>
                            <p>{view.reason}</p>
                        </section>
                    )}
                    {view.decision && (
                        <section>
                            <h3 className={styles.sectionTitle}>Decision to consider</h3>
                            <p>{view.decision}</p>
                        </section>
                    )}
                    {view.approach.length > 0 && (
                        <section>
                            <h3 className={styles.sectionTitle}>
                                Possible approach · AI suggestion
                            </h3>
                            <ul className="list-disc space-y-2 pl-4">
                                {view.approach.map((step, index) => (
                                    <li key={index}>{step}</li>
                                ))}
                            </ul>
                        </section>
                    )}
                    {topic.decision && (
                        <section>
                            <h3 className={styles.sectionTitle}>Your recorded decision</h3>
                            <p>
                                {
                                    {
                                        go: "Go",
                                        "no-go": "No-go",
                                        "needs-more-evidence": "Needs more evidence",
                                    }[topic.decision.value]
                                }
                            </p>
                            {topic.decision.text && <p>{topic.decision.text}</p>}
                            <p className="text-ink-3 mt-2 text-xs">
                                Recorded {new Date(topic.decision.recordedAt).toLocaleString()} ·
                                work completion remains unverified
                            </p>
                        </section>
                    )}
                    <details className={styles.disclosure}>
                        <summary>
                            Evidence · {topic.facts.length} source statements
                            {topic.conflicts.length > 0
                                ? ` · ${topic.conflicts.length} ${topic.conflicts.length === 1 ? "conflict" : "conflicts"}`
                                : ""}
                        </summary>
                        <div className="mt-4 space-y-5">
                            <p className="text-ink-3 text-xs">
                                Select a source to inspect its authorized excerpt, exact version and
                                provenance.
                            </p>
                            <div role="group" aria-label="Supporting sources">
                                {refs(sourceRefs)}
                            </div>
                            <details className={styles.disclosure}>
                                <summary>Reported statements and conflicts</summary>
                                <div className="mt-4 space-y-5">
                                    {topic.facts.map((fact, index) => (
                                        <div key={index}>
                                            <p>{fact.text}</p>
                                            {refs(fact.refs)}
                                        </div>
                                    ))}
                                    {topic.conflicts.map((conflict, index) => (
                                        <div key={index}>
                                            <p className="text-ink mb-1 font-medium">Conflict</p>
                                            <p>{conflict.text}</p>
                                            {refs(conflict.refs)}
                                        </div>
                                    ))}
                                </div>
                            </details>
                        </div>
                    </details>
                    <details className={styles.disclosure}>
                        <summary>Original report · uncertainty &amp; rationale</summary>
                        <dl className={styles.original}>
                            <dt>Original title</dt>
                            <dd>{topic.title}</dd>
                            <dt>What the sources report</dt>
                            <dd>
                                {topic.facts.map((fact, index) => (
                                    <div key={index}>
                                        <p>{fact.text}</p>
                                        {refs(fact.refs)}
                                    </div>
                                ))}
                            </dd>
                            <dt>Why it merits discussion</dt>
                            <dd>{topic.whyItMatters}</dd>
                            <dt>Decision question</dt>
                            <dd>{topic.decisionQuestion}</dd>
                            <dt>Proposed next step · AI suggestion</dt>
                            <dd>{topic.proposedNextStep || "None supplied."}</dd>
                            <dt>Unknowns</dt>
                            <dd>
                                {topic.unknowns.length ? (
                                    <ul>
                                        {topic.unknowns.map((value, index) => (
                                            <li key={index}>{value}</li>
                                        ))}
                                    </ul>
                                ) : (
                                    "None supplied."
                                )}
                            </dd>
                            <dt>Conflicts</dt>
                            <dd>
                                {topic.conflicts.length
                                    ? topic.conflicts.map((conflict, index) => (
                                          <div key={index}>
                                              <p>{conflict.text}</p>
                                              {refs(conflict.refs)}
                                          </div>
                                      ))
                                    : "None supplied."}
                            </dd>
                            <dt>Rationale</dt>
                            <dd>{topic.rationale}</dd>
                        </dl>
                    </details>
                </div>
                <footer className={styles.footer}>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || topic.status === "kept"}
                        onClick={() => onReview("kept")}
                    >
                        {topic.status === "kept" ? "Kept" : "Keep"}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => onReview("dismissed")}
                    >
                        Dismiss
                    </Button>
                    <Button size="sm" className="ml-auto" disabled={busy} onClick={onDecision}>
                        {topic.decision ? "Update decision" : "Record decision"}
                    </Button>
                </footer>
            </SheetContent>
        </Sheet>
    );
}
