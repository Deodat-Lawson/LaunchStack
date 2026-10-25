"use client";

import { useEffect, useState } from "react";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { InlineError } from "~/components/tools/EmptyState";
import { SectionHeading } from "~/components/tools/PageHeader";
import { Button } from "~/components/ui/button";
import { useResource } from "~/lib/tools/useResource";

import { VantageApiError, vantageApi } from "../api";
import { fmtDate, plural } from "../_lib/format";
import { vantagePath } from "../_lib/paths";

const TITLE = "Pending Questions from Previous Reviews";

/** Historical questions are a separate human review queue, never fresh model facts. */
export function PendingQuestions({
    agendaId,
    onPendingCount,
}: {
    agendaId: string;
    onPendingCount?: (count: number | null) => void;
}) {
    const pending = useResource(`vantage:pending:${agendaId}`, () =>
        vantageApi.pendingQuestions(agendaId)
    );
    const [busy, setBusy] = useState<string | null>(null);
    const [reviewError, setReviewError] = useState<string | null>(null);
    const data = pending.error ? null : pending.data;

    useEffect(() => {
        onPendingCount?.(data ? data.questions.length + data.unavailableCount : null);
    }, [data, onPendingCount]);

    async function review(questionId: string, status: "dismissed" | "addressed") {
        if (!data || busy) return;
        setBusy(questionId);
        setReviewError(null);
        try {
            const next = await vantageApi.reviewPendingQuestion(
                agendaId,
                questionId,
                status,
                data.version
            );
            pending.mutate(() => next);
        } catch (err) {
            setReviewError(
                err instanceof VantageApiError && err.status === 409
                    ? "This review changed. The latest questions have been loaded; review them before trying again."
                    : err instanceof Error
                      ? err.message
                      : "Could not save your review. Try again."
            );
            await pending.reload();
        } finally {
            setBusy(null);
        }
    }

    if (data && data.questions.length === 0 && data.unavailableCount === 0 && !reviewError)
        return null;

    return (
        <section aria-label={TITLE}>
            <SectionHeading title={TITLE} />
            <p className="text-ink-3 mb-3 max-w-[76ch] text-[12.5px] leading-relaxed">
                These questions come from earlier reviews. Their current status is unverified;
                keeping them visible does not mean the issue is still open. Your review does not
                change any existing commitment.
            </p>
            {pending.loading && (
                <p className="text-ink-3 text-[13px]" aria-live="polite">
                    Loading pending questions…
                </p>
            )}
            {pending.error && (
                <InlineError message={pending.error} onRetry={() => void pending.reload()} />
            )}
            {reviewError && (
                <p role="alert" className="text-danger mb-3 text-[13px]">
                    {reviewError}
                </p>
            )}
            {data && data.questions.length > 0 && (
                <div className="border-line bg-panel divide-line-2 divide-y rounded-lg border">
                    {data.questions.map(question => (
                        <article
                            key={question.questionId}
                            aria-label={question.question}
                            className="px-4 py-4"
                        >
                            <div className="text-ink-3 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
                                <span className="border-line rounded border border-dashed px-1.5 py-0.5">
                                    Historical · current status unverified
                                </span>
                                <ToolLink
                                    href={vantagePath(`/agenda?week=${question.originWeekStart}`)}
                                    className="hover:text-ink underline underline-offset-2"
                                >
                                    Review week of {fmtDate(question.originWeekStart)}
                                </ToolLink>
                            </div>
                            <p className="text-ink text-[14px] font-medium leading-relaxed">
                                {question.question}
                            </p>
                            {question.humanReview.decision && (
                                <p className="text-ink-2 mt-2 text-[12.5px] leading-relaxed">
                                    <span className="font-medium">Past human decision: </span>
                                    {question.humanReview.decision}
                                </p>
                            )}
                            {question.suggestedDue && (
                                <p className="text-ink-3 mt-2 text-[12px]">
                                    Original suggested date: {fmtDate(question.suggestedDue)}. Its
                                    current relevance is unverified.
                                </p>
                            )}
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={busy !== null}
                                    onClick={() => void review(question.questionId, "dismissed")}
                                >
                                    Dismiss
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={busy !== null}
                                    onClick={() => void review(question.questionId, "addressed")}
                                >
                                    Confirm addressed
                                </Button>
                                {busy === question.questionId && (
                                    <span className="text-ink-3 text-[12px]" role="status">
                                        Saving review…
                                    </span>
                                )}
                            </div>
                        </article>
                    ))}
                </div>
            )}
            {data && data.unavailableCount > 0 && (
                <p className="text-ink-3 mt-3 text-[12.5px]">
                    {plural(data.unavailableCount, "historical question")} unavailable with your
                    current access. No progress or completion is inferred.
                </p>
            )}
        </section>
    );
}
