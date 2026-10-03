import { describe, expect, it, vi } from "vitest";

import { DEFAULT_RETRY_POLICY, runOutboxTick } from "./outbox-tick";
import type { ClaimedEvent, OutboxStorePort } from "../ports";
import type { PipelineProcessor } from "./process-event";

const NOW = new Date("2026-08-09T12:00:00.000Z");

function claimedEvent(outboxId: number): ClaimedEvent {
    return {
        outboxId,
        attemptCount: 0,
        event: {
            eventId: `company.state.projected:${outboxId}`,
            eventType: "company.state.projected",
            schemaVersion: 1,
            occurredAt: NOW.toISOString(),
            traceId: `trace-${outboxId}`,
            companyId: outboxId,
            payload: { projection: "company-metadata" },
        },
    };
}

describe("runOutboxTick non-retryable failures", () => {
    it("dead-letters a non-retryable error on attempt one while retrying a normal error", async () => {
        const permanent = claimedEvent(1);
        const transient = claimedEvent(2);
        const failedCalls: Array<{
            outboxId: number;
            error: string;
            retryAt: Date | null;
        }> = [];
        const outbox: OutboxStorePort = {
            enqueue: async () => {},
            claimBatch: async () => [permanent, transient],
            markProcessed: async () => {},
            markFailed: async (outboxId, error, opts) => {
                failedCalls.push({ outboxId, error, retryAt: opts.retryAt });
            },
            reclaimStale: async () => 0,
            countDead: async () => 0,
        };
        const processor = {
            process: async (claimed: ClaimedEvent) => {
                if (claimed.outboxId === permanent.outboxId) {
                    throw Object.assign(new Error("embedding configuration missing"), {
                        retryable: false,
                    });
                }
                throw new Error("converter unreachable");
            },
        } as unknown as PipelineProcessor;
        const onDead = vi.fn(async () => {});
        const logger = {
            debug: () => {},
            info: () => {},
            warn: vi.fn(),
            error: vi.fn(),
        };

        const result = await runOutboxTick({
            outbox,
            processor,
            clock: { now: () => NOW },
            logger,
            onDead,
        });

        expect(result).toEqual({ claimed: 2, processed: 0, failed: 1, dead: 1 });
        expect(failedCalls).toHaveLength(2);
        expect(failedCalls).toEqual(
            expect.arrayContaining([
                {
                    outboxId: permanent.outboxId,
                    error: "embedding configuration missing",
                    retryAt: null,
                },
                {
                    outboxId: transient.outboxId,
                    error: "converter unreachable",
                    retryAt: new Date(NOW.getTime() + DEFAULT_RETRY_POLICY.baseDelayMs),
                },
            ])
        );
        expect(onDead).toHaveBeenCalledTimes(1);
        expect(onDead).toHaveBeenCalledWith(permanent, "embedding configuration missing");
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({
                outboxId: permanent.outboxId,
                attempt: 1,
                nonRetryable: true,
            }),
            expect.stringContaining("non-retryable")
        );
    });
});
