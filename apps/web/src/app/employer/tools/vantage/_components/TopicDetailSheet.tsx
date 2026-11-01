"use client";

import { useRef, type RefObject } from "react";
import { useSheetFocusRecovery } from "../_lib/use-sheet-focus-recovery";
import { FileText } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "~/components/ui/sheet";
import { demoSourceKey, demoSourceName } from "../demo-api";
import type { DemoHumanDecision, DemoReport, DemoSourceRef, DemoTopic } from "../demo-contract";
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
    onDecision: (value?: DemoHumanDecision["value"]) => void;
    onSource: (ref: DemoSourceRef) => void;
    sourceName?: (ref: DemoSourceRef) => string;
    triggerRef?: RefObject<HTMLButtonElement | null>;
}
const choices = [
    { value: "go", label: "Go" },
    { value: "no-go", label: "No-go" },
    { value: "needs-more-evidence", label: "Needs more evidence" },
] as const;

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
    const heading = useRef<HTMLElement | null>(null);
    useSheetFocusRecovery(open, heading);
    if (!topic) return null;
    const view = presentation ?? topicPresentation(topic);
    const name = (ref: DemoSourceRef) =>
        sourceName?.(ref) ??
        report?.diagnostics.sources.find(item => demoSourceKey(item.source) === demoSourceKey(ref))
            ?.title ??
        `${ref.kind}:${ref.id}`;
    const nextSteps = view.approach.length
        ? view.approach
        : topic.proposedNextStep
          ? [topic.proposedNextStep]
          : [];
    const refs = (values: DemoSourceRef[]) => (
        <div className={styles.sourceRefs}>
            {values.map(ref => (
                <button
                    type="button"
                    key={demoSourceKey(ref)}
                    onClick={() => onSource(ref)}
                    className={styles.sourceChip}
                    title={demoSourceName(ref)}
                >
                    <FileText size={12} aria-hidden="true" />
                    <span>{name(ref)}</span>
                    <span className="sr-only">{demoSourceName(ref)}</span>
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
                <header ref={heading} tabIndex={-1} className={styles.sheetHeader}>
                    <SheetDescription className={styles.eyebrow}>
                        {topic.status === "kept"
                            ? "Kept for review"
                            : topic.status === "dismissed"
                              ? "Dismissed"
                              : "Decision to review"}
                        {topic.decision ? " / Decision recorded" : ""}
                    </SheetDescription>
                    <SheetTitle className={styles.sheetTitle}>{view.title}</SheetTitle>
                    {view.title !== topic.title ? (
                        <p className="sr-only">Original title: {topic.title}</p>
                    ) : null}
                    <div className={styles.keyQuestion}>
                        <h3>The decision</h3>
                        <p>{topic.decisionQuestion || "No decision question supplied."}</p>
                    </div>
                </header>
                <div className={styles.body}>
                    <section aria-label="Source evidence">
                        <h3 className={styles.sectionTitle}>What the sources report</h3>
                        {topic.facts.length ? (
                            <div className={styles.factGrid}>
                                {topic.facts.map((fact, index) => (
                                    <div className={styles.factCard} key={index}>
                                        <p>{fact.text}</p>
                                        {refs(fact.refs)}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p>No source statements supplied.</p>
                        )}
                    </section>
                    {topic.conflicts.length > 0 ? (
                        <section>
                            <h3 className={styles.sectionTitle}>Reported differences</h3>
                            <div className="space-y-4">
                                {topic.conflicts.map((conflict, index) => (
                                    <div key={index}>
                                        <p>{conflict.text}</p>
                                        {refs(conflict.refs)}
                                    </div>
                                ))}
                            </div>
                        </section>
                    ) : null}
                    <section>
                        <h3 className={styles.sectionTitle}>Not known yet</h3>
                        {topic.unknowns.length ? (
                            <ul className={styles.unknowns}>
                                {topic.unknowns.map((value, index) => (
                                    <li key={index}>
                                        <span aria-hidden="true">?</span>
                                        <span>{value}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p>No unknowns supplied.</p>
                        )}
                    </section>
                    {nextSteps.length > 0 ? (
                        <section>
                            <h3 className={styles.sectionTitle}>Suggested next step</h3>
                            <div className={styles.nextStep}>
                                {nextSteps.map((step, index) => (
                                    <p key={index}>{step}</p>
                                ))}
                            </div>
                        </section>
                    ) : null}
                    {topic.decision ? (
                        <section>
                            <h3 className={styles.sectionTitle}>Your recorded decision</h3>
                            <p>
                                {
                                    choices.find(choice => choice.value === topic.decision?.value)
                                        ?.label
                                }
                            </p>
                            {topic.decision.text ? <p>{topic.decision.text}</p> : null}
                            <p className="text-ink-3 mt-2 text-xs">
                                Recorded {new Date(topic.decision.recordedAt).toLocaleString()}.
                                Work completion remains unverified.
                            </p>
                        </section>
                    ) : null}
                    <details className={styles.disclosure}>
                        <summary>Reasoning and original report</summary>
                        <dl className={styles.original}>
                            <dt>Original title</dt>
                            <dd>{topic.title}</dd>
                            <dt>Why it merits discussion</dt>
                            <dd>{topic.whyItMatters}</dd>
                            <dt>Decision question</dt>
                            <dd>{topic.decisionQuestion}</dd>
                            <dt>Proposed next step</dt>
                            <dd>{topic.proposedNextStep || "None supplied."}</dd>
                            <dt>Rationale</dt>
                            <dd>{topic.rationale}</dd>
                        </dl>
                    </details>
                </div>
                <footer className={styles.footer}>
                    <p className={styles.footerLabel}>
                        {topic.decision ? "Update your decision" : "Record your decision"}
                    </p>
                    <div className={styles.decisionChoices}>
                        {choices.map(choice => (
                            <Button
                                key={choice.value}
                                variant={
                                    choice.value === "needs-more-evidence" ? "default" : "outline"
                                }
                                size="sm"
                                disabled={busy}
                                onClick={() => onDecision(choice.value)}
                            >
                                {choice.label}
                            </Button>
                        ))}
                    </div>
                    <div className={styles.secondaryActions}>
                        <p>Recording a decision doesn’t create an action.</p>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy || topic.status === "dismissed"}
                            onClick={() => onReview("dismissed")}
                        >
                            {topic.status === "dismissed" ? "Dismissed" : "Dismiss topic"}
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy || topic.status === "kept"}
                            onClick={() => onReview("kept")}
                        >
                            {topic.status === "kept" ? "Kept" : "Keep for later"}
                        </Button>
                    </div>
                </footer>
            </SheetContent>
        </Sheet>
    );
}
