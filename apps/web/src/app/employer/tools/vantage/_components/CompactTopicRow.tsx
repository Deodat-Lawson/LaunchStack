"use client";

import { ChevronRight } from "lucide-react";
import type { DemoTopic } from "../demo-contract";
import { topicPresentation, type TopicPresentation } from "../_lib/topic-presentation";
import styles from "./compact-topic.module.css";

export interface CompactTopicRowProps {
    topic: DemoTopic;
    presentation?: TopicPresentation;
    reviewLabel?: string;
    selected?: boolean;
    onOpen: (trigger: HTMLButtonElement) => void;
}

export function CompactTopicRow({
    topic,
    presentation = topicPresentation(topic),
    reviewLabel,
    selected = false,
    onOpen,
}: CompactTopicRowProps) {
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
                    <span className={styles.issue}>{presentation.issue}</span>
                    <span className={styles.metadata}>
                        <span>AI suggested</span>
                        <span>
                            {reviewLabel ??
                                (topic.status === "kept"
                                    ? "Kept for review"
                                    : topic.status === "dismissed"
                                      ? "Dismissed"
                                      : "Needs review")}
                        </span>
                    </span>
                    {presentation.title !== topic.title && (
                        <span className="sr-only">Original title: {topic.title}</span>
                    )}
                </span>
                <ChevronRight size={16} aria-hidden="true" className="text-ink-3 shrink-0" />
            </button>
        </article>
    );
}
