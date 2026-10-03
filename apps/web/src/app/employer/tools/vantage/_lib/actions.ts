"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

/** Fired after an Undo lands, so whichever Vantage screen is open re-reads. */
const CHANGED = "vantage:changed";

/**
 * Confirm a one-click answer with a way back. Every take-it-or-leave-it
 * click ends here, so a misclick costs one more click, not a hunt. An Undo
 * that fails says so and offers to try again, since its toast is gone.
 */
export function undoToast(message: string, undo: () => Promise<unknown>, description?: string) {
    const run = () => {
        undo().then(
            () => window.dispatchEvent(new Event(CHANGED)),
            (e: unknown) =>
                toast.error(e instanceof Error ? e.message : "Could not undo that", {
                    description,
                    duration: 10000,
                    action: { label: "Try again", onClick: run },
                })
        );
    };
    toast(message, { description, duration: 6000, action: { label: "Undo", onClick: run } });
}

export function useOneClick(refresh: () => Promise<unknown> | void) {
    const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
    // An Undo clicked after moving to another screen still shows up there.
    useEffect(() => {
        const reread = () => void refresh();
        window.addEventListener(CHANGED, reread);
        return () => window.removeEventListener(CHANGED, reread);
    }, [refresh]);
    const restore = useCallback(
        (id: string) =>
            setGone(g => {
                const next = new Set(g);
                next.delete(id);
                return next;
            }),
        []
    );
    // Answers still on their way. A second click on the same suggestion while
    // the first is in flight is ignored — a double-clicked Commit opens one
    // commitment, not two. A ref, so two clicks in one frame both see it.
    const running = useRef(new Set<string>());
    const act = useCallback(
        async (id: string, work: () => Promise<Outcome>) => {
            if (running.current.has(id)) return;
            running.current.add(id);
            setGone(g => new Set(g).add(id));
            let outcome: Outcome;
            try {
                outcome = await work();
            } catch (e) {
                running.current.delete(id);
                restore(id);
                toast.error(e instanceof Error ? e.message : "That did not work");
                return;
            }
            // The card stays off the screen only until fresh data agrees; after
            // that the data decides, so a topic restored later comes back.
            try {
                await refresh();
            } finally {
                running.current.delete(id);
                restore(id);
            }
            const { message, description, undo } = outcome;
            if (!undo) {
                toast(message, { description });
                return;
            }
            // The screen re-reads through the "changed" event once Undo lands.
            undoToast(message, undo, description);
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

/**
 * How long a suggestion set aside stays out of sight on this browser: a
 * snoozed check-in until tomorrow, a nudge for the week, an ignored next step
 * or number conflict until it stops being one (two months as a backstop).
 */
export const SET_ASIDE_DAYS = { snooze: 1, nudge: 7, nextStep: 60, conflict: 60 } as const;

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
