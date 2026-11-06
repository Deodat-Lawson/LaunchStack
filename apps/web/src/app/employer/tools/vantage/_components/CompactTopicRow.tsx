"use client";

import { ChevronRight } from "lucide-react";
import { demoSourceKey } from "../demo-api";
import type { DemoReport, DemoTopic } from "../demo-contract";
import { topicPresentation, type TopicPresentation } from "../_lib/topic-presentation";
import styles from "./compact-topic.module.css";

/** A supplied comparison must link distinct factual statements to distinct sources.
 * This only controls presentation; it does not establish a common sample or contradiction. */
export function hasReportedComparison(topic: DemoTopic): boolean {
    return topic.conflicts.some(conflict => {
        if (!conflict.text.trim()) return false;
        const comparedRefs = new Set(conflict.refs.map(demoSourceKey));
        const facts = topic.facts.filter(
            fact => fact.text.trim() && fact.refs.some(ref => comparedRefs.has(demoSourceKey(ref)))
        );
        const factualRefs = new Set(
            facts
                .flatMap(fact => fact.refs)
                .map(demoSourceKey)
                .filter(key => comparedRefs.has(key))
        );
        return facts.length >= 2 && factualRefs.size >= 2;
    });
}

export interface CompactTopicRowProps {
    topic: DemoTopic;
    report?: DemoReport;
    presentation?: TopicPresentation;
    reviewLabel?: string;
    selected?: boolean;
    onOpen: (trigger: HTMLButtonElement) => void;
}

export function CompactTopicRow({
    topic,
    report,
    presentation = topicPresentation(topic),
    reviewLabel,
    selected = false,
    onOpen,
}: CompactTopicRowProps) {
    const refs = new Set(
        [...topic.facts, ...topic.conflicts].flatMap(item => item.refs).map(demoSourceKey)
    );
    const sources = report?.diagnostics.sources.filter(item =>
        refs.has(demoSourceKey(item.source))
    );
    const count = sources
        ? new Set(sources.map(item => demoSourceKey(item.source))).size
        : refs.size;
    const unreviewed = sources?.some(item => item.reviewState === "unreviewed");
    return (
        <article aria-label={topic.title} className={styles.row} data-selected={selected}>
            <button
                type="button"
                className={styles.rowButton}
                aria-expanded={selected}
                aria-haspopup="dialog"
                onClick={event => onOpen(event.currentTarget)}
            >
                <span className={styles.rowCopy}>
                    <span className={styles.title}>{presentation.title}</span>
                    <span className={styles.question}>
                        {topic.decisionQuestion || "No decision question supplied."}
                    </span>
                    <span className={styles.metadata}>
                        <span className={styles.chip}>
                            {count} {count === 1 ? "source" : "sources"}
                        </span>
                        <span className={styles.chip}>
                            {topic.unknowns.length}{" "}
                            {topic.unknowns.length === 1 ? "unknown" : "unknowns"}
                        </span>
                        {hasReportedComparison(topic) ? (
                            <span className={styles.chip} data-tone="warning">
                                Results differ
                            </span>
                        ) : null}
                        {unreviewed ? (
                            <span className={styles.chip} data-tone="info">
                                Unreviewed context
                            </span>
                        ) : null}
                        {topic.status !== "suggested" || reviewLabel ? (
                            <span className={styles.chip}>
                                {reviewLabel ??
                                    (topic.status === "kept" ? "Kept for review" : "Dismissed")}
                            </span>
                        ) : null}
                        {topic.decision ? (
                            <span className={styles.chip}>Decision recorded</span>
                        ) : null}
                    </span>
                    {presentation.title !== topic.title ? (
                        <span className="sr-only">Original title: {topic.title}</span>
                    ) : null}
                </span>
                <ChevronRight size={16} aria-hidden="true" className="text-ink-3 shrink-0" />
            </button>
        </article>
    );
}
