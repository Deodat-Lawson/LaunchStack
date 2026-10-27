/**
 * Persistence for post-writer runs (`marketing_runs`). Every read and write
 * is scoped by company_id except the executor's own claim/finish calls, which
 * take the id the route created and the company it resolved.
 *
 * Appends are single statements (`events || $new`, `checkpoints || $new`),
 * so concurrent progress from parallel stages never loses an event.
 */
import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { getDb } from "@launchstack/store/client";

import { marketingRuns, type MarketingRunRow, type MarketingRunStatus } from "./schema";
import type { MarketingPipelineInput, MarketingPipelineResult, PipelineSSEEvent } from "./types";

export type MarketingRunEvent = Exclude<PipelineSSEEvent, { type: "result" } | { type: "error" }>;

export interface MarketingRunRecord {
    id: string;
    companyId: bigint;
    userId: string;
    status: MarketingRunStatus;
    input: MarketingPipelineInput;
    debug: boolean;
    events: MarketingRunEvent[];
    checkpoints: Record<string, unknown>;
    result: MarketingPipelineResult | null;
    errorMessage: string | null;
    attempts: number;
    createdAt: Date;
    startedAt: Date | null;
    heartbeatAt: Date | null;
    completedAt: Date | null;
}

function toRecord(row: MarketingRunRow): MarketingRunRecord {
    return {
        id: row.id,
        companyId: row.companyId,
        userId: row.userId,
        status: row.status,
        input: row.input as unknown as MarketingPipelineInput,
        debug: row.debug,
        events: (row.events ?? []) as MarketingRunEvent[],
        checkpoints: row.checkpoints ?? {},
        result: (row.result as unknown as MarketingPipelineResult | null) ?? null,
        errorMessage: row.errorMessage ?? null,
        attempts: row.attempts,
        createdAt: row.createdAt,
        startedAt: row.startedAt ?? null,
        heartbeatAt: row.heartbeatAt ?? null,
        completedAt: row.completedAt ?? null,
    };
}

export async function createMarketingRun(args: {
    companyId: bigint;
    userId: string;
    input: MarketingPipelineInput;
    debug?: boolean;
}): Promise<MarketingRunRecord> {
    const [row] = await getDb()
        .insert(marketingRuns)
        .values({
            id: randomUUID(),
            companyId: args.companyId,
            userId: args.userId,
            input: args.input as unknown as Record<string, unknown>,
            debug: args.debug ?? false,
        })
        .returning();
    if (!row) throw new Error("Failed to create the post-writer run");
    return toRecord(row);
}

export async function getMarketingRun(
    id: string,
    companyId: bigint
): Promise<MarketingRunRecord | null> {
    const [row] = await getDb()
        .select()
        .from(marketingRuns)
        .where(and(eq(marketingRuns.id, id), eq(marketingRuns.companyId, companyId)))
        .limit(1);
    return row ? toRecord(row) : null;
}

/** This member's unfinished runs in this workspace, newest first (what a reload resumes). */
export async function listActiveMarketingRuns(
    companyId: bigint,
    userId: string
): Promise<MarketingRunRecord[]> {
    const rows = await getDb()
        .select()
        .from(marketingRuns)
        .where(
            and(
                eq(marketingRuns.companyId, companyId),
                eq(marketingRuns.userId, userId),
                inArray(marketingRuns.status, ["queued", "running"])
            )
        )
        .orderBy(desc(marketingRuns.createdAt))
        .limit(5);
    return rows.map(toRecord);
}

/**
 * Take the run for one attempt: queued, or running with a heartbeat older
 * than `staleBefore` (its process died). One conditional update, so two
 * executors never run it at once. Null when someone else holds it or it
 * already finished.
 */
export async function claimMarketingRun(
    id: string,
    companyId: bigint,
    now: Date,
    staleBefore: Date
): Promise<MarketingRunRecord | null> {
    const [row] = await getDb()
        .update(marketingRuns)
        .set({
            status: "running",
            startedAt: sql`coalesce(${marketingRuns.startedAt}, ${now.toISOString()}::timestamptz)`,
            heartbeatAt: now,
            attempts: sql`${marketingRuns.attempts} + 1`,
        })
        .where(
            and(
                eq(marketingRuns.id, id),
                eq(marketingRuns.companyId, companyId),
                or(
                    eq(marketingRuns.status, "queued"),
                    and(
                        eq(marketingRuns.status, "running"),
                        or(
                            isNull(marketingRuns.heartbeatAt),
                            lt(marketingRuns.heartbeatAt, staleBefore)
                        )
                    )
                )
            )
        )
        .returning();
    return row ? toRecord(row) : null;
}

export async function appendMarketingRunEvents(
    id: string,
    events: readonly MarketingRunEvent[],
    now = new Date()
): Promise<void> {
    if (events.length === 0) return;
    await getDb()
        .update(marketingRuns)
        .set({
            events: sql`${marketingRuns.events} || ${JSON.stringify(events)}::jsonb`,
            heartbeatAt: now,
        })
        .where(eq(marketingRuns.id, id));
}

export async function saveMarketingRunCheckpoint(
    id: string,
    step: string,
    value: unknown
): Promise<void> {
    await getDb()
        .update(marketingRuns)
        .set({
            checkpoints: sql`${marketingRuns.checkpoints} || ${JSON.stringify({ [step]: value })}::jsonb`,
        })
        .where(eq(marketingRuns.id, id));
}

export async function heartbeatMarketingRun(id: string, now = new Date()): Promise<void> {
    await getDb()
        .update(marketingRuns)
        .set({ heartbeatAt: now })
        .where(and(eq(marketingRuns.id, id), eq(marketingRuns.status, "running")));
}

export async function finishMarketingRun(
    id: string,
    outcome:
        | { status: "completed"; result: MarketingPipelineResult }
        | { status: "failed"; errorMessage: string },
    now = new Date()
): Promise<void> {
    await getDb()
        .update(marketingRuns)
        .set(
            outcome.status === "completed"
                ? {
                      status: "completed",
                      result: outcome.result as unknown as Record<string, unknown>,
                      errorMessage: null,
                      completedAt: now,
                  }
                : { status: "failed", errorMessage: outcome.errorMessage, completedAt: now }
        )
        .where(eq(marketingRuns.id, id));
}

/** Put a failed attempt back in the queue (its checkpoints stay). */
export async function requeueMarketingRun(id: string): Promise<void> {
    await getDb()
        .update(marketingRuns)
        .set({ status: "queued", heartbeatAt: null })
        .where(and(eq(marketingRuns.id, id), eq(marketingRuns.status, "running")));
}
