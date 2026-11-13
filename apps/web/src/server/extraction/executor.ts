/**
 * Where an extraction table runs.
 *
 * A table is one model call or so per document, done in units: each
 * `advanceTable` claims a batch of pending rows, reads them in parallel and
 * commits them. By default the web process drives the units after the
 * response with `after()`, holding a lease on the table row; if the process
 * dies, the lease expires and the next poll of the table picks it up, first
 * putting back the rows the dead process had claimed. A deployment with the
 * worker attached sets EXTRACTION_EXECUTOR=worker to run the same units as
 * Inngest steps instead.
 */
import { after } from "next/server";

import { advanceTable } from "@launchstack/pipelines/extraction";
import {
    claimLease,
    createExtractionStore,
    getTableById,
    releaseLease,
    renewLease,
} from "@launchstack/pipelines/extraction/db";
import {
    EXTRACTION_LIMITS,
    type AdvanceTableOutcome,
    type ExtractionPorts,
    type ExtractionTableRecord,
} from "@launchstack/pipelines/extraction/types";

import { inngest } from "~/server/inngest/client";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

import { extractStructured, readExtractionDocument, readImageFields } from "./documents";

export type ExtractionExecutor = "inline" | "worker";

export function readExtractionExecutor(
    env: Record<string, string | undefined> = process.env
): ExtractionExecutor {
    return env.EXTRACTION_EXECUTOR?.trim().toLowerCase() === "worker" ? "worker" : "inline";
}

/**
 * How long the in-process lease lasts without a heartbeat. The executor
 * renews it every LEASE_MS / 3 while a unit runs, so only a process that
 * died (not a slow batch) lets a poll resume the table.
 */
export const LEASE_MS = 2 * 60_000;
/** Attempts per unit before the table is marked failed. */
export const UNIT_ATTEMPTS = 3;
/**
 * Units a table can take: one per batch of rows, so never more than one per
 * document, plus the unit that finishes it and some slack.
 */
export const MAX_UNITS = EXTRACTION_LIMITS.maxDocuments + 10;

/** Documents read in parallel per unit: EXTRACTION_CONCURRENCY, 1–16, default 8 (1 suits a single-slot local model). */
export function readExtractionConcurrency(
    env: Record<string, string | undefined> = process.env
): number {
    const n = Number.parseInt(env.EXTRACTION_CONCURRENCY ?? "", 10);
    return Number.isFinite(n) ? Math.max(1, Math.min(16, n)) : 8;
}

export function createExtractionPorts(): ExtractionPorts {
    return {
        store: createExtractionStore(),
        readDocument: readExtractionDocument,
        extract: extractStructured,
        readImageFields,
        now: () => new Date(),
        concurrency: readExtractionConcurrency(),
        log: (message, meta) => console.warn(`[extraction] ${message}`, meta ?? {}),
    };
}

/** The usage scope every unit runs in: counted against whoever made the table, never stopped midway. */
export function extractionAiUse(userId: string | null) {
    return { feature: "extraction", userId, enforce: false } as const;
}

function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    return "The extraction failed";
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Perform one unit with retries; marks the table failed after the last
 * attempt and returns null. The caller holds the table (its lease), so rows
 * a failed attempt left claimed are put back before the next one.
 */
export async function advanceWithRetries(
    ports: ExtractionPorts,
    tableId: number,
    attempts = UNIT_ATTEMPTS,
    backoffMs = 1500
): Promise<AdvanceTableOutcome | null> {
    for (let attempt = 1; ; attempt++) {
        const started = Date.now();
        try {
            if (attempt > 1) await ports.store.releaseRunningRows(tableId);
            const outcome = await advanceTable(ports, tableId);
            console.info(
                `[extraction] table ${tableId}: ${outcome.state}${"processed" in outcome ? ` ${outcome.processed} row(s)` : ""} in ${Math.round((Date.now() - started) / 1000)}s`
            );
            return outcome;
        } catch (error) {
            if (attempt >= attempts) {
                console.error(`[extraction] table ${tableId} failed:`, error);
                await ports.store.finish(tableId, "failed", errorMessage(error), ports.now());
                return null;
            }
            console.warn(
                `[extraction] table ${tableId}: attempt ${attempt} of ${attempts} failed after ${Math.round((Date.now() - started) / 1000)}s, retrying:`,
                errorMessage(error)
            );
            await sleep(backoffMs * attempt);
        }
    }
}

/**
 * Whether to perform another unit. A unit that processed rows goes on. One
 * that found nothing to claim while rows are still marked running (the
 * engine answers "advanced" with none processed) may be waiting on another
 * holder; a second in a row means nobody is coming, so the driver stops and
 * leaves the table for the next resume instead of spinning.
 */
export function createUnitGate(): (outcome: AdvanceTableOutcome | null) => boolean {
    let idle = 0;
    return outcome => {
        if (!outcome || outcome.state !== "advanced") return false;
        idle = outcome.processed === 0 ? idle + 1 : 0;
        return idle < 2;
    };
}

/** Drive a table to the end in this process, if no live lease holds it. */
export async function driveTable(
    tableId: number,
    ports: ExtractionPorts = createExtractionPorts()
): Promise<void> {
    const now = ports.now();
    if (!(await claimLease(tableId, now, new Date(now.getTime() + LEASE_MS)))) return;
    // Heartbeat: a batch on a slow model can outlast the lease; keep it fresh
    // so a poll doesn't take it for a dead process and start a second driver.
    const heartbeat = setInterval(() => {
        renewLease(tableId, new Date(Date.now() + LEASE_MS)).catch((error: unknown) =>
            console.warn("[extraction] lease renewal failed:", error)
        );
    }, LEASE_MS / 3);
    try {
        const table = await getTableById(tableId);
        if (!table) return;
        // The lease is ours, so no one is reading a row: any still marked
        // running was claimed by a process that died. Read them again.
        const orphaned = await ports.store.releaseRunningRows(tableId);
        if (orphaned > 0) {
            console.warn(`[extraction] table ${tableId}: ${orphaned} orphaned row(s) put back`);
        }
        const aiUse = extractionAiUse(table.createdByUserId);
        const keepGoing = createUnitGate();
        for (let i = 0; i < MAX_UNITS; i++) {
            // Each unit runs on the workspace's own models when it brings them.
            const outcome = await withWorkspaceChatModels(table.companyId, aiUse, () =>
                advanceWithRetries(ports, tableId)
            );
            if (!keepGoing(outcome)) break;
        }
    } finally {
        clearInterval(heartbeat);
        await releaseLease(tableId);
    }
}

/** Hand a new or re-queued table to the executor. */
export async function dispatchTable(
    table: Pick<ExtractionTableRecord, "id" | "companyId" | "createdByUserId">
): Promise<void> {
    if (readExtractionExecutor() === "worker") {
        await inngest.send({
            name: "extraction/run.requested",
            data: {
                tableId: table.id,
                companyId: table.companyId.toString(),
                userId: table.createdByUserId,
            },
        });
        return;
    }
    after(async () => {
        try {
            await driveTable(table.id);
        } catch (error) {
            console.error("[extraction] executor crashed:", error);
        }
    });
}

/**
 * Resume a table whose in-process executor went away (a restart, a crash).
 * Called when someone polls a table; a no-op unless the table is unfinished,
 * runs inline, and its lease has lapsed.
 */
export function resumeIfStalled(
    table: Pick<ExtractionTableRecord, "id" | "status" | "leaseUntil">,
    now = new Date()
): boolean {
    if (readExtractionExecutor() !== "inline") return false;
    if (table.status !== "queued" && table.status !== "running") return false;
    if (table.leaseUntil && table.leaseUntil.getTime() > now.getTime()) return false;
    after(async () => {
        try {
            await driveTable(table.id);
        } catch (error) {
            console.error("[extraction] resume failed:", error);
        }
    });
    return true;
}
