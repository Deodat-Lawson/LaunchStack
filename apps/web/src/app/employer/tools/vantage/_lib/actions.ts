"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

import {
    vantageApi,
    type AgendaDto,
    type CommitmentDto,
    type TopicDto,
    type VantageCommitmentStatus,
} from "../api";
import { addDaysIso, fmtDate, todayIso } from "./format";
import { hideSuggestion, unhideSuggestion } from "./hidden";

/**
 * The one-click answers to a suggestion, each with its way back. A builder
 * does the work and says what happened and how to undo it; `useOneClick`
 * takes the card off the screen at once, runs the builder, refreshes, and
 * offers the Undo — or puts the card back and says why when it failed.
 * `gone` covers only the moment between the click and the refreshed data.
 */
export interface Outcome {
    message: string;
    description?: string;
    undo?: () => Promise<unknown>;
}

/**
 * Confirm a one-click answer with a way back. Every take-it-or-leave-it
 * click ends here, so a misclick costs one more click, not a hunt.
 */
export function undoToast(message: string, undo: () => Promise<unknown>, description?: string) {
    toast(message, {
        description,
        duration: 6000,
        action: {
            label: "Undo",
            onClick: () => {
                undo().catch((e: unknown) =>
                    toast.error(e instanceof Error ? e.message : "Could not undo that")
                );
            },
        },
    });
}

export function useOneClick(refresh: () => Promise<unknown> | void) {
    const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
    const restore = useCallback(
        (id: string) =>
            setGone(g => {
                const next = new Set(g);
                next.delete(id);
                return next;
            }),
        []
    );
    const act = useCallback(
        async (id: string, work: () => Promise<Outcome>) => {
            setGone(g => new Set(g).add(id));
            let outcome: Outcome;
            try {
                outcome = await work();
            } catch (e) {
                restore(id);
                toast.error(e instanceof Error ? e.message : "That did not work");
                return;
            }
            // The card stays off the screen only until fresh data agrees; after
            // that the data decides, so a topic restored later comes back.
            await refresh();
            restore(id);
            const { message, description, undo } = outcome;
            if (!undo) {
                toast(message, { description });
                return;
            }
            undoToast(
                message,
                async () => {
                    await undo();
                    restore(id);
                    await refresh();
                },
                description
            );
        },
        [refresh, restore]
    );
    return { gone, act };
}

export async function keepTopic(topic: TopicDto): Promise<Outcome> {
    await vantageApi.patchTopic(topic.id, { status: "kept" });
    return {
        message: "Added to the agenda",
        description: topic.title,
        undo: () => vantageApi.patchTopic(topic.id, { status: topic.status }),
    };
}

export async function ignoreTopic(topic: TopicDto): Promise<Outcome> {
    await vantageApi.patchTopic(topic.id, { status: "dismissed" });
    return {
        message: "Ignored",
        description: topic.title,
        undo: () => vantageApi.patchTopic(topic.id, { status: topic.status }),
    };
}

const RESOLVED_WORDS: Record<Exclude<VantageCommitmentStatus, "open">, string> = {
    done: "Marked done",
    missed: "Marked missed — it comes back on the next agenda",
    dropped: "Dropped",
};

export async function resolveCommitment(
    commitment: CommitmentDto,
    status: Exclude<VantageCommitmentStatus, "open">
): Promise<Outcome> {
    await vantageApi.patchCommitment(commitment.id, { status });
    return {
        message: RESOLVED_WORDS[status],
        description: commitment.title,
        undo: () =>
            vantageApi.patchCommitment(commitment.id, {
                status: commitment.status,
                outcome: commitment.outcome,
            }),
    };
}

/** Set a suggestion aside on this browser for `days` days (1 = until tomorrow). */
export async function setAside(id: string, days: number, message: string): Promise<Outcome> {
    hideSuggestion(id, days);
    return { message, undo: async () => unhideSuggestion(id) };
}

/** Whether a topic's proposed next step can be committed to without asking anything. */
export function canCommitInOneClick(topic: TopicDto): boolean {
    return topic.proposedNextStep.trim() !== "" && (topic.proposedOwner ?? "").trim() !== "";
}

/**
 * Take the proposed next step: the decision is recorded as agreeing to it,
 * and the commitment opens with the proposed owner and date (a week out
 * when none was proposed). Undo takes both back.
 */
export async function commitToNextStep(topic: TopicDto, today = todayIso()): Promise<Outcome> {
    const step = topic.proposedNextStep.trim();
    const owner = (topic.proposedOwner ?? "").trim();
    const dueOn = topic.proposedDue ?? addDaysIso(today, 7);
    const { topic: saved } = await vantageApi.decide(topic.id, {
        decision: `Agreed: ${step}`,
        commitment: { title: step, owner, dueOn, test: null, shared: topic.shared },
    });
    return {
        message: `Committed — ${owner}, due ${fmtDate(dueOn)}`,
        description: step,
        undo: () => vantageApi.undoDecision(topic.id, saved.commitmentId),
    };
}

export async function markReady(agenda: AgendaDto): Promise<Outcome> {
    await vantageApi.setAgendaStatus(agenda.id, "ready");
    return {
        message: "Agenda marked ready for the meeting",
        undo: () => vantageApi.setAgendaStatus(agenda.id, agenda.status),
    };
}
