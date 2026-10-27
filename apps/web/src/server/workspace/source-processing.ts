/**
 * Where each not-yet-ready source is in the ingestion pipeline, for the
 * Sources rail's progress bar and failure card. Read in bulk with the
 * documents list, and only for the sources that still need it.
 *
 * Two reads: the jobs themselves (status, the progress the stages record,
 * manual retries) and the jobs' outbox rows that are waiting out a backoff
 * after a failed attempt — a rate-limited embedding call spends most of its
 * life there, and "retrying in 8 min" is the truth while it does.
 */

import { and, eq, gt, inArray } from "drizzle-orm";

import { DEFAULT_RETRY_POLICY, eventIds } from "@launchstack/orchestration";
import { eventOutbox, ocrJobs } from "@launchstack/store/schema";
import type { SourceProcessingView } from "~/lib/source-progress";
import { db } from "~/server/db";

/** How much of an attempt's raw error the list carries. The full text stays in the outbox row. */
const LAST_ERROR_LIMIT = 500;

const STAGE_EVENT_IDS = [
    eventIds.sourceVersionCreated,
    eventIds.evidenceVersionExtracted,
    eventIds.evidenceVersionIndexed,
] as const;

/** The job id an outbox stage event belongs to (`<eventType>:<ocrJobId>`). */
function jobIdOfEvent(eventId: string): string {
    return eventId.slice(eventId.indexOf(":") + 1);
}

export async function loadSourceProcessing(
    companyId: bigint,
    jobIds: readonly string[]
): Promise<Map<string, SourceProcessingView>> {
    const views = new Map<string, SourceProcessingView>();
    const unique = [...new Set(jobIds)];
    if (unique.length === 0) return views;

    const jobs = await db
        .select({
            id: ocrJobs.id,
            status: ocrJobs.status,
            progress: ocrJobs.progress,
            retryCount: ocrJobs.retryCount,
        })
        .from(ocrJobs)
        .where(and(eq(ocrJobs.companyId, companyId), inArray(ocrJobs.id, unique)));
    if (jobs.length === 0) return views;

    // Only a job still in flight can be waiting for its next attempt.
    const live = jobs.filter(job => job.status === "queued" || job.status === "processing");
    const waiting =
        live.length === 0
            ? []
            : await db
                  .select({
                      eventId: eventOutbox.eventId,
                      attemptCount: eventOutbox.attemptCount,
                      availableAt: eventOutbox.availableAt,
                      lastError: eventOutbox.lastError,
                  })
                  .from(eventOutbox)
                  .where(
                      and(
                          eq(eventOutbox.companyId, Number(companyId)),
                          inArray(
                              eventOutbox.eventId,
                              live.flatMap(job => STAGE_EVENT_IDS.map(id => id(job.id)))
                          ),
                          eq(eventOutbox.status, "pending"),
                          gt(eventOutbox.attemptCount, 0)
                      )
                  );
    const retryByJob = new Map(waiting.map(row => [jobIdOfEvent(row.eventId), row] as const));

    for (const job of jobs) {
        const retry = retryByJob.get(job.id);
        views.set(job.id, {
            jobId: job.id,
            status: job.status,
            progress: job.progress ?? null,
            retryCount: job.retryCount ?? 0,
            retry: retry
                ? {
                      attempt: retry.attemptCount + 1,
                      maxAttempts: DEFAULT_RETRY_POLICY.maxAttempts,
                      nextAttemptAt: retry.availableAt.toISOString(),
                      lastError: retry.lastError?.slice(0, LAST_ERROR_LIMIT) ?? null,
                  }
                : null,
        });
    }
    return views;
}
