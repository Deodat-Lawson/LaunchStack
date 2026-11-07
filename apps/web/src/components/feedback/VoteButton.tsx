"use client";

import { useState } from "react";
import { ChevronUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { voteForFeedback } from "~/lib/feedback/api";
import { cn } from "~/lib/utils";

/**
 * "▲ 12" — a feature request's votes, and the way to add yours. Optimistic:
 * the count moves on click and goes back if the server refuses.
 */
export function VoteButton({
    id,
    votes,
    voted,
    onChange,
    size = "md",
}: {
    id: number;
    votes: number;
    voted: boolean;
    onChange?: (next: { votes: number; voted: boolean }) => void;
    size?: "md" | "lg";
}) {
    const t = useTranslations("feedback.vote");
    const [state, setState] = useState({ votes, voted });
    const [busy, setBusy] = useState(false);
    // A newer answer from the list (a reload) wins over what was clicked here.
    const [seen, setSeen] = useState({ votes, voted });
    if (seen.votes !== votes || seen.voted !== voted) {
        setSeen({ votes, voted });
        setState({ votes, voted });
    }

    const toggle = async (event: React.MouseEvent) => {
        // Rows are links; a vote is not a visit.
        event.preventDefault();
        event.stopPropagation();
        if (busy) return;
        const before = state;
        const next = { voted: !before.voted, votes: before.votes + (before.voted ? -1 : 1) };
        setState(next);
        setBusy(true);
        try {
            const result = await voteForFeedback(id, next.voted);
            setState(result);
            onChange?.(result);
        } catch {
            setState(before);
            toast.error(t("failed"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <button
            type="button"
            onClick={event => void toggle(event)}
            aria-pressed={state.voted}
            aria-label={
                state.voted ? t("remove", { count: state.votes }) : t("add", { count: state.votes })
            }
            data-testid="feedback-vote"
            className={cn(
                "focus-visible:ring-brand/50 inline-flex shrink-0 flex-col items-center justify-center rounded-md border font-semibold tabular-nums outline-none transition-colors focus-visible:ring-[3px]",
                size === "lg" ? "h-14 w-14 text-[15px]" : "h-11 w-11 text-[13px]",
                state.voted
                    ? "border-brand bg-brand-soft text-brand-ink"
                    : "border-line bg-surface text-ink-2 hover:border-brand hover:text-brand-ink"
            )}
        >
            <ChevronUp className={size === "lg" ? "size-4" : "size-3.5"} aria-hidden />
            {state.votes}
        </button>
    );
}
