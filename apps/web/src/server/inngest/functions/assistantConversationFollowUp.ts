/**
 * The follow-up note for a saved assistant conversation, on the worker, for
 * deployments that set ASSISTANT_CONVERSATIONS_EXECUTOR=worker
 * (~/server/assistant-conversations/follow-up-queue). Two steps:
 *
 * - generate — skip a stale or already-written save, read the transcript
 *   back from the saved document, and have the model write the note body,
 *   under the workspace's chat models and counted to the saver as `mcp`
 *   work, exactly as the MCP request that saved it was. Memoized, so a
 *   failed write never pays for the model call twice.
 * - write — the note, under the row lock and only while the row still has
 *   this save's hash; then its embedding and link sync.
 *
 * Retried twice for what can pass (an endpoint's bad minute, a storage or
 * database blip); a misconfigured model, the AI allowance or a saver who
 * left fail at once. When it gives up, the row says `failed` with the error.
 */
import { NonRetriableError } from "inngest";

import {
    generateFollowUpMarkdown,
    markFollowUpFailed,
} from "~/server/assistant-conversations/follow-up";
import {
    FollowUpEventDataSchema,
    finishFollowUp,
    followUpTargetFromEvent,
    isPermanentFollowUpError,
    prepareFollowUp,
} from "~/server/assistant-conversations/follow-up-job";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

import { inngest } from "../client";

/** Fail at once on what a retry cannot fix, keeping the error's own message for the row. */
async function failFastOnPermanent<T>(work: () => Promise<T>): Promise<T> {
    try {
        return await work();
    } catch (error) {
        if (isPermanentFollowUpError(error)) {
            throw new NonRetriableError(error instanceof Error ? error.message : String(error), {
                cause: error,
            });
        }
        throw error;
    }
}

export const assistantConversationFollowUpJob = inngest.createFunction(
    {
        id: "assistant-conversation-follow-up",
        name: "Saved conversation: follow-up note",
        retries: 2,
        concurrency: [{ key: "event.data.companyId", limit: 2 }, { limit: 8 }],
        onFailure: async ({ error, event }) => {
            const parsed = FollowUpEventDataSchema.safeParse(event.data.event.data);
            if (!parsed.success) {
                console.error(
                    "[assistant-conversations] failed follow-up with invalid payload:",
                    parsed.error
                );
                return;
            }
            // Only while the row still has this save's hash and no note: never a newer save's row.
            await markFollowUpFailed(followUpTargetFromEvent(parsed.data), error);
        },
    },
    { event: "assistant-conversations/follow-up.requested" },
    async ({ event, step }) => {
        const parsed = FollowUpEventDataSchema.safeParse(event.data);
        if (!parsed.success) {
            throw new NonRetriableError("Invalid follow-up event payload", { cause: parsed.error });
        }
        const target = followUpTargetFromEvent(parsed.data);
        const aiUse = { feature: "mcp", userId: target.authUserId } as const;

        const prepared = await step.run("generate", () =>
            failFastOnPermanent(() =>
                // Inside the step: a step body does not inherit the handler's async context.
                prepareFollowUp(target, input =>
                    withWorkspaceChatModels(target.companyId, aiUse, () =>
                        generateFollowUpMarkdown(input)
                    )
                )
            )
        );
        if (prepared.outcome !== "ready") {
            return { conversationRowId: target.conversationRowId, outcome: prepared.outcome };
        }

        const outcome = await step.run("write", () =>
            failFastOnPermanent(() => finishFollowUp(target, prepared.markdown))
        );
        return { conversationRowId: target.conversationRowId, outcome };
    }
);
