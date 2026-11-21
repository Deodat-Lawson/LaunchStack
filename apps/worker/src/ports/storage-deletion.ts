import type { StorageDeletionPort } from "@launchstack/orchestration";
import type { LoggerPort } from "@launchstack/runtime";

import { processStorageDeletionRequest } from "~/server/storage/deletion/worker";

export function createStorageDeletionPort(logger: LoggerPort): StorageDeletionPort {
    return {
        async process({ requestId, traceId }) {
            await processStorageDeletionRequest(requestId);
            logger.info({ requestId, traceId }, "storage deletion request processed");
        },
    };
}
