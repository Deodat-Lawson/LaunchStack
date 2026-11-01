"use client";

import { ChevronRight } from "lucide-react";
import { demoSourceKey } from "../demo-api";
import type { DemoReport, DemoTopic } from "../demo-contract";
import { topicPresentation, type TopicPresentation } from "../_lib/topic-presentation";
import styles from "./compact-topic.module.css";

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
                        <span>
                            {count} {count === 1 ? "source" : "sources"}
                        </span>
                        <span>
                            {topic.unknowns.length}{" "}
                            {topic.unknowns.length === 1 ? "unknown" : "unknowns"}
                        </span>
                        {topic.conflicts.length > 0 ? (
                            <span className={styles.differenceBadge}>Reported differences</span>
                        ) : null}
                        {unreviewed ? <span>Uses unreviewed context</span> : null}
                        {topic.status !== "suggested" || reviewLabel ? (
                            <span>
                                {reviewLabel ??
                                    (topic.status === "kept" ? "Kept for review" : "Dismissed")}
                            </span>
                        ) : null}
                        {topic.decision ? <span>Decision recorded</span> : null}
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
