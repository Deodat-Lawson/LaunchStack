"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";

import { vantageApi, type CommitmentDto, type VantageCommitmentStatus } from "../api";
import { dueWords, fmtDate, todayIso } from "../_lib/format";
import { SharedMark, StatusWord, type Tone } from "./Primitives";

export const COMMITMENT_TONE: Record<VantageCommitmentStatus, Tone> = {
    open: "neutral",
    done: "success",
    missed: "danger",
    dropped: "quiet",
};

export const COMMITMENT_WORD: Record<VantageCommitmentStatus, string> = {
    open: "Open",
    done: "Done",
    missed: "Missed",
    dropped: "Dropped",
};

export function CommitmentStatus({ commitment }: { commitment: CommitmentDto }) {
    const late = commitment.status === "open" && commitment.dueOn < todayIso();
    return (
        <StatusWord tone={late ? "warn" : COMMITMENT_TONE[commitment.status]}>
            {late ? "Late" : COMMITMENT_WORD[commitment.status]}
        </StatusWord>
    );
}

/**
 * The check-in: was the promise kept, and what was learned. Three outcomes,
 * one line of learning — the thing next week's agenda reads back. The
 * outcome box opens in a popover so the row stays a row.
 */
export function CheckInRow({
    commitment,
    onChange,
    showTopic = true,
}: {
    commitment: CommitmentDto;
    onChange: () => void;
    showTopic?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState<VantageCommitmentStatus | null>(null);
    const [outcome, setOutcome] = useState(commitment.outcome ?? "");
    const [busy, setBusy] = useState(false);

    const resolve = async (status: VantageCommitmentStatus) => {
        setBusy(true);
        try {
            await vantageApi.patchCommitment(commitment.id, {
                status,
                outcome: outcome.trim() || null,
            });
            toast(
                status === "done"
                    ? "Marked done"
                    : status === "missed"
                      ? "Marked missed — it will be on the next agenda"
                      : status === "dropped"
                        ? "Dropped"
                        : "Reopened"
            );
            setOpen(false);
            setPending(null);
            onChange();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "That did not save");
        } finally {
            setBusy(false);
        }
    };

    const isOpen = commitment.status === "open";
    return (
        <div className="border-line-2 flex min-h-11 items-center gap-3 border-t px-4 py-2 first:border-t-0">
            <div className="min-w-0 flex-1">
                <div className="text-ink truncate text-[13px] font-medium">{commitment.title}</div>
                <div className="text-ink-3 flex flex-wrap items-center gap-x-2 text-[11.5px]">
                    <span>{commitment.owner}</span>
                    <span>·</span>
                    <span className={cn(isOpen && commitment.dueOn < todayIso() && "text-warn")}>
                        {isOpen
                            ? dueWords(commitment.dueOn)
                            : `was due ${fmtDate(commitment.dueOn)}`}
                    </span>
                    {showTopic && commitment.topicTitle && (
                        <>
                            <span>·</span>
                            <span className="truncate">{commitment.topicTitle}</span>
                        </>
                    )}
                    <SharedMark shared={commitment.shared} />
                </div>
                {commitment.test && (
                    <div className="text-ink-2 mt-0.5 text-[12px]">Test: {commitment.test}</div>
                )}
                {commitment.outcome && !isOpen && (
                    <div className="text-ink-2 mt-0.5 text-[12px]">
                        Learned: {commitment.outcome}
                    </div>
                )}
            </div>
            <CommitmentStatus commitment={commitment} />
            <Popover
                open={open}
                onOpenChange={o => {
                    setOpen(o);
                    if (!o) setPending(null);
                }}
            >
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm">
                        {isOpen ? "Check in" : "Change"}
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[340px] p-3">
                    <div className="text-ink text-[13px] font-medium">{commitment.title}</div>
                    {commitment.test && (
                        <p className="text-ink-3 mt-1 text-[12px]">
                            Was it resolved? {commitment.test}
                        </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {(["done", "missed", "dropped"] as const).map(s => (
                            <Button
                                key={s}
                                type="button"
                                size="sm"
                                variant={pending === s ? "default" : "outline"}
                                onClick={() => setPending(s)}
                                disabled={busy}
                            >
                                {COMMITMENT_WORD[s]}
                            </Button>
                        ))}
                        {!isOpen && (
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => void resolve("open")}
                                disabled={busy}
                            >
                                Reopen
                            </Button>
                        )}
                    </div>
                    {pending && (
                        <div className="mt-3 flex flex-col gap-2">
                            <label
                                className="text-ink-2 text-[12px] font-medium"
                                htmlFor={`outcome-${commitment.id}`}
                            >
                                What was learned
                            </label>
                            <Textarea
                                id={`outcome-${commitment.id}`}
                                value={outcome}
                                onChange={e => setOutcome(e.target.value)}
                                rows={3}
                                placeholder={
                                    pending === "done"
                                        ? "What the result was, in one or two lines"
                                        : pending === "missed"
                                          ? "Why it slipped, and whether it still matters"
                                          : "Why it is no longer the right thing to do"
                                }
                            />
                            <div className="flex justify-end">
                                <Button
                                    size="sm"
                                    onClick={() => void resolve(pending)}
                                    disabled={busy}
                                >
                                    Save check-in
                                </Button>
                            </div>
                        </div>
                    )}
                </PopoverContent>
            </Popover>
        </div>
    );
}
