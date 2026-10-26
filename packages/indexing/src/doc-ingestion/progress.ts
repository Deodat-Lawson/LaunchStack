import { eq } from "drizzle-orm";

import { getDb } from "@launchstack/store/client";
import { ocrJobs, type OcrJobProgress } from "@launchstack/store/schema";

/**
 * Record where a job is, for the source rail's progress bar. The stages call
 * this as they move on and after every embedding batch, so a long book shows
 * real movement instead of a static "syncing…".
 *
 * Best-effort: progress is for people watching, and a failed write must never
 * fail (and so retry) the stage that made it.
 */
export async function recordJobProgress(
    jobId: string,
    progress: Omit<OcrJobProgress, "updatedAt">
): Promise<void> {
    try {
        await getDb()
            .update(ocrJobs)
            .set({ progress: { ...progress, updatedAt: new Date().toISOString() } })
            .where(eq(ocrJobs.id, jobId));
    } catch (error) {
        console.warn(
            `[Progress] Could not record "${progress.stage}" for job ${jobId}: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }
}
