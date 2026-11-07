"use client";

import { LoaderCircle } from "lucide-react";
import MarkdownMessage from "~/app/_components/MarkdownMessage";
import { cn } from "~/lib/utils";
import noteStyles from "../calls.module.css";
import styles from "./EnrichmentPreview.module.css";

export type EnrichmentPreviewStatus = "queued" | "generating";

export interface EnrichmentPreviewProps {
    markdown: string;
    status: EnrichmentPreviewStatus;
    error?: string;
}

export interface ProposalReviewNoticeProps {
    rejected?: boolean;
}

export function EnrichmentPreview({ markdown, status, error }: EnrichmentPreviewProps) {
    const hasContent = markdown.trim().length > 0;
    const hasError = Boolean(error?.trim());

    return (
        <section
            className={styles.preview}
            aria-label="AI enhanced note preview"
            aria-busy={!hasError}
        >
            {!hasError && (
                <div
                    className={styles.loading}
                    role="status"
                    aria-label={status === "queued" ? "Enhancement queued" : "Enhancing note"}
                >
                    <LoaderCircle size={18} className={styles.spinner} aria-hidden="true" />
                </div>
            )}
            {hasContent && <MarkdownMessage content={markdown} className={noteStyles.markdown} />}

            {hasError && (
                <div className={styles.errorNotice} role="alert">
                    <strong>Draft preview only</strong>
                    <span>{error}</span>
                    <span>
                        Your saved note was not changed. Review or regenerate before applying
                        anything.
                    </span>
                </div>
            )}
        </section>
    );
}

export function ProposalReviewNotice({ rejected = false }: ProposalReviewNoticeProps) {
    return (
        <aside
            className={cn(styles.reviewNotice, rejected && styles.reviewNoticeRejected)}
            aria-label={rejected ? "AI proposal rejected" : "Review AI proposal"}
        >
            <div className={styles.noticeCopy}>
                <strong className={styles.noticeTitle}>
                    {rejected
                        ? "AI proposal rejected"
                        : "Review the AI proposal before applying it"}
                </strong>
                <span className={styles.noticeBody}>
                    {rejected
                        ? "The saved note is unchanged. Generate a new proposal when you are ready."
                        : "Your saved note stays unchanged until you accept this draft."}
                </span>
            </div>
        </aside>
    );
}
