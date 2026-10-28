/**
 * Writing what a workspace's model calls used, and for whom.
 *
 * `withWorkspaceChatModels` puts {@link aiUsageRecorder} on the chat scope;
 * the shared transport calls it once per completed model call with the
 * provider's own token counts (see `@launchstack/llm`, usage-meter.ts). Each
 * call is one upsert into the day's row for that workspace, feature, route and
 * model, so a scenario round of fifty calls touches one row fifty times rather
 * than writing fifty.
 *
 * Bookkeeping, not billing: it runs off the response path, a failed write is
 * logged and dropped, and nothing here refuses work. The balance in
 * `token_accounts` is untouched (see the schema file for why the two differ).
 */

import { sql } from "drizzle-orm";
import type { ChatUsageEvent, ChatUsageRecorder } from "@launchstack/llm";

import type { AiFeature } from "~/lib/ai-usage";
import { db } from "~/server/db";
import { aiUsageDaily } from "~/server/db/schema";

/** A workspace id as the scope receives it, or null when there is none to count against. */
function workspaceId(companyId: bigint | number | string | null | undefined): bigint | null {
    if (companyId === null || companyId === undefined || companyId === "") return null;
    const id = Number(companyId);
    return Number.isSafeInteger(id) && id > 0 ? BigInt(id) : null;
}

export async function recordAiUsage(
    companyId: bigint,
    feature: AiFeature,
    event: ChatUsageEvent,
    at: Date = new Date(),
    userId = ""
): Promise<void> {
    if (event.inputTokens + event.outputTokens <= 0) return;
    const priced = event.costUsd !== undefined;
    const cost = (event.costUsd ?? 0).toFixed(10);
    await db
        .insert(aiUsageDaily)
        .values({
            companyId,
            date: at.toISOString().slice(0, 10),
            feature,
            route: event.route ?? "",
            modelId: (event.modelId ?? "").slice(0, 200),
            owner: event.owner,
            userId: userId.slice(0, 256),
            calls: 1,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            reasoningTokens: event.reasoningTokens ?? 0,
            cachedInputTokens: event.cachedInputTokens ?? 0,
            pricedCalls: priced ? 1 : 0,
            costUsd: cost,
        })
        .onConflictDoUpdate({
            target: [
                aiUsageDaily.companyId,
                aiUsageDaily.date,
                aiUsageDaily.feature,
                aiUsageDaily.route,
                aiUsageDaily.modelId,
                aiUsageDaily.owner,
                aiUsageDaily.userId,
            ],
            set: {
                calls: sql`${aiUsageDaily.calls} + 1`,
                inputTokens: sql`${aiUsageDaily.inputTokens} + ${event.inputTokens}`,
                outputTokens: sql`${aiUsageDaily.outputTokens} + ${event.outputTokens}`,
                reasoningTokens: sql`${aiUsageDaily.reasoningTokens} + ${event.reasoningTokens ?? 0}`,
                cachedInputTokens: sql`${aiUsageDaily.cachedInputTokens} + ${event.cachedInputTokens ?? 0}`,
                pricedCalls: sql`${aiUsageDaily.pricedCalls} + ${priced ? 1 : 0}`,
                costUsd: sql`${aiUsageDaily.costUsd} + ${cost}::numeric`,
                updatedAt: new Date(),
            },
        });
}

/**
 * The recorder for work done for `companyId` by `feature`, on behalf of
 * `userId` (the auth id of the person it is for; omitted for work no one
 * person started), or undefined when the work belongs to no workspace (a
 * signed-out request, an operator tool): there is no one to count it against.
 */
export function aiUsageRecorder(
    companyId: bigint | number | string | null | undefined,
    feature: AiFeature,
    userId?: string | null
): ChatUsageRecorder | undefined {
    const id = workspaceId(companyId);
    if (id === null) return undefined;
    return {
        record(event) {
            recordAiUsage(id, feature, event, new Date(), userId ?? "").catch((error: unknown) =>
                console.warn(
                    `[ai-usage] could not record a ${feature} call for workspace ${id}:`,
                    error instanceof Error ? error.message : error
                )
            );
        },
    };
}
