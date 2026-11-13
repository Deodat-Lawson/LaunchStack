/**
 * Where a save's follow-up note is written.
 *
 * By default the web process writes it after the tool call has answered
 * (`./after-response`, Next's `after()`), which needs nothing but the web
 * app — but a restart or crash in that window loses the note and leaves the
 * row `pending` for good. A deployment with the worker attached sets
 * ASSISTANT_CONVERSATIONS_EXECUTOR=worker to queue it as an Inngest job
 * instead (`~/server/inngest/functions/assistantConversationFollowUp`):
 * durable, retried, and marked `failed` when it gives up. This is the same
 * switch Proposals, Scenarios and the post writer use.
 *
 * The switch is explicit rather than inferred from Inngest's keys: an event
 * the Inngest server accepts says nothing about whether a worker will ever
 * run it, and a queued note no worker picks up is the stuck `pending` row
 * this exists to prevent. When the send itself fails, the note is written in
 * this process after all.
 */
import { inngest, type AssistantConversationFollowUpEvent } from "~/server/inngest/client";

import { runAfterResponse } from "./after-response";
import { writeFollowUp, type FollowUpJob, type FollowUpTarget } from "./follow-up";

export const FOLLOW_UP_EVENT = "assistant-conversations/follow-up.requested" as const;

export type FollowUpExecutor = "inline" | "worker";

export function readFollowUpExecutor(
    env: Record<string, string | undefined> = process.env
): FollowUpExecutor {
    return env.ASSISTANT_CONVERSATIONS_EXECUTOR?.trim().toLowerCase() === "worker"
        ? "worker"
        : "inline";
}

export type FollowUpEventData = AssistantConversationFollowUpEvent["data"];

/** The event's payload: which save, never the transcript. */
export function followUpEventData(target: FollowUpTarget): FollowUpEventData {
    return {
        conversationRowId: target.conversationRowId,
        documentId: target.documentId,
        companyId: target.companyId.toString(),
        authUserId: target.authUserId,
        title: target.title,
        family: target.family,
        contentHash: target.contentHash,
    };
}

/** Hand one save's follow-up to the executor. Never throws: the save already succeeded. */
export async function queueFollowUpNote(job: FollowUpJob): Promise<void> {
    if (readFollowUpExecutor() === "worker") {
        try {
            await inngest.send({ name: FOLLOW_UP_EVENT, data: followUpEventData(job) });
            return;
        } catch (error) {
            console.error(
                `[assistant-conversations] could not queue the follow-up for conversation ${job.documentId} on the worker; writing it after the response instead:`,
                error
            );
        }
    }
    runAfterResponse(`follow-up for conversation ${job.documentId}`, () => writeFollowUp(job));
}
