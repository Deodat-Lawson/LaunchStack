import { describe, expect, it, vi } from "vitest";

import { DEFAULT_RETRY_POLICY, retryDelayMs, runOutboxTick } from "./outbox-tick";
import type { ClaimedEvent, OutboxStorePort } from "../ports";
import type { PipelineProcessor } from "./process-event";

const NOW = new Date("2026-08-09T12:00:00.000Z");

const silentLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
};

function claimedEvent(overrides: Partial<ClaimedEvent> = {}): ClaimedEvent {
    return {
        outboxId: 1,
        attemptCount: 0,
        event: {
            eventId: "company.state.projected:42",
            eventType: "company.state.projected",
            schemaVersion: 1,
            occurredAt: NOW.toISOString(),
            traceId: "trace-1",
            companyId: 42,
            payload: { projection: "company-metadata" },
        },
        ...overrides,
    };
}

function makeOutbox(batch: ClaimedEvent[]): OutboxStorePort & {
    processedCalls: Array<{ outboxId: number; followUps: unknown[] }>;
    failedCalls: Array<{ outboxId: number; error: string; retryAt: Date | null }>;
} {
    const processedCalls: Array<{ outboxId: number; followUps: unknown[] }> = [];
    const failedCalls: Array<{
        outboxId: number;
        error: string;
        retryAt: Date | null;
    }> = [];
    return {
        processedCalls,
        failedCalls,
        enqueue: async () => {},
        claimBatch: async () => batch,
        markProcessed: async (outboxId, followUps = []) => {
            processedCalls.push({ outboxId, followUps });
        },
        markFailed: async (outboxId, error, opts) => {
            failedCalls.push({ outboxId, error, retryAt: opts.retryAt });
        },
        reclaimStale: async () => 0,
        countDead: async () => 0,
    };
}

function makeProcessor(
    impl: (claimed: ClaimedEvent) => Promise<{ followUps: never[] }>
): PipelineProcessor {
    return { process: impl } as unknown as PipelineProcessor;
}

describe("runOutboxTick", () => {
    it("marks successful events processed with their follow-ups", async () => {
        const outbox = makeOutbox([claimedEvent()]);
        const processor = makeProcessor(async () => ({ followUps: [] }));

        const result = await runOutboxTick({
            outbox,
            processor,
            clock: { now: () => NOW },
            logger: silentLogger,
        });

        expect(result).toEqual({ claimed: 1, processed: 1, failed: 0, dead: 0 });
        expect(outbox.processedCalls).toEqual([{ outboxId: 1, followUps: [] }]);
        expect(outbox.failedCalls).toEqual([]);
    });

    it("schedules an exponential-backoff retry on handler failure", async () => {
        const outbox = makeOutbox([claimedEvent({ attemptCount: 2 })]);
        const processor = makeProcessor(async () => {
            throw new Error("converter unreachable");
        });

        const result = await runOutboxTick({
            outbox,
            processor,
            clock: { now: () => NOW },
            logger: silentLogger,
        });

        expect(result).toEqual({ claimed: 1, processed: 0, failed: 1, dead: 0 });
        const [failure] = outbox.failedCalls;
        expect(failure?.error).toBe("converter unreachable");
        // attempt 3 → 30s * 2^2 = 120s after "now"
        expect(failure?.retryAt?.toISOString()).toBe(
            new Date(NOW.getTime() + 120_000).toISOString()
        );
    });

    it("moves an event to dead when attempts are exhausted", async () => {
        const outbox = makeOutbox([
            claimedEvent({
                attemptCount: DEFAULT_RETRY_POLICY.maxAttempts - 1,
            }),
        ]);
        const processor = makeProcessor(async () => {
            throw new Error("still broken");
        });

        const result = await runOutboxTick({
            outbox,
            processor,
            clock: { now: () => NOW },
            logger: silentLogger,
        });

        expect(result).toEqual({ claimed: 1, processed: 0, failed: 0, dead: 1 });
        expect(outbox.failedCalls[0]?.retryAt).toBeNull();
    });

    it("keeps processing the batch after one event fails", async () => {
        const outbox = makeOutbox([claimedEvent({ outboxId: 1 }), claimedEvent({ outboxId: 2 })]);
        const processor = makeProcessor(async claimed => {
            if (claimed.outboxId === 1) throw new Error("boom");
            return { followUps: [] };
        });

        const result = await runOutboxTick({
            outbox,
            processor,
            clock: { now: () => NOW },
            logger: silentLogger,
        });

        expect(result.processed).toBe(1);
        expect(result.failed).toBe(1);
    });
});

describe("retryDelayMs", () => {
    it("doubles per attempt and caps at maxDelayMs", () => {
        const policy = { maxAttempts: 8, baseDelayMs: 1000, maxDelayMs: 5000 };
        expect(retryDelayMs(1, policy)).toBe(1000);
        expect(retryDelayMs(2, policy)).toBe(2000);
        expect(retryDelayMs(3, policy)).toBe(4000);
        expect(retryDelayMs(4, policy)).toBe(5000);
        expect(retryDelayMs(10, policy)).toBe(5000);
    });
});
