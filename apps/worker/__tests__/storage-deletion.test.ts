import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LoggerPort } from "@launchstack/runtime";

const { processStorageDeletionRequest } = vi.hoisted(() => ({
    processStorageDeletionRequest: vi.fn(async (_requestId: number) => {}),
}));

vi.mock("~/server/storage/deletion/worker", () => ({
    processStorageDeletionRequest,
}));

import { createStorageDeletionPort } from "../src/ports/storage-deletion";

function makeLogger() {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    } satisfies LoggerPort;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("storage deletion port", () => {
    it("processes the durable request and logs its trace", async () => {
        const logger = makeLogger();

        await createStorageDeletionPort(logger).process({ requestId: 17, traceId: "trace-delete" });

        expect(processStorageDeletionRequest).toHaveBeenCalledExactlyOnceWith(17);
        expect(logger.info).toHaveBeenCalledWith(
            { requestId: 17, traceId: "trace-delete" },
            "storage deletion request processed"
        );
    });

    it("propagates deletion failures so the outbox retries", async () => {
        const logger = makeLogger();
        const error = new Error("provider temporarily unavailable");
        processStorageDeletionRequest.mockRejectedValueOnce(error);

        await expect(
            createStorageDeletionPort(logger).process({ requestId: 17, traceId: "trace-delete" })
        ).rejects.toBe(error);
        expect(logger.info).not.toHaveBeenCalled();
    });
});
