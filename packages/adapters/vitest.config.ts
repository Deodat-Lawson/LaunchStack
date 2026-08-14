import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The integration suites share one Postgres, and the outbox is a global
    // work queue: one suite's claimBatch() legitimately claims rows another
    // suite just enqueued when their files run in parallel workers, which
    // makes assertions about row status racy. Run test FILES serially —
    // tests within a file already run sequentially.
    fileParallelism: false,
  },
});
