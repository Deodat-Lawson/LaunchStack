import { describe, expect, it } from "vitest";

import { parseWorkerEnv } from "../src/env";

describe("parseWorkerEnv", () => {
  it("applies defaults with an empty environment", () => {
    const env = parseWorkerEnv({} as NodeJS.ProcessEnv);
    expect(env.WORKER_PORT).toBe(8020);
    expect(env.OUTBOX_BATCH_SIZE).toBe(10);
    expect(env.OUTBOX_IDLE_POLL_MS).toBe(2000);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("coerces numeric strings", () => {
    const env = parseWorkerEnv({
      WORKER_PORT: "9000",
      OUTBOX_BATCH_SIZE: "25",
    } as NodeJS.ProcessEnv);
    expect(env.WORKER_PORT).toBe(9000);
    expect(env.OUTBOX_BATCH_SIZE).toBe(25);
  });

  it("rejects invalid values with every offending field named", () => {
    expect(() =>
      parseWorkerEnv({
        WORKER_PORT: "not-a-port",
        OUTBOX_BATCH_SIZE: "0",
        LOG_LEVEL: "verbose",
      } as NodeJS.ProcessEnv),
    ).toThrow(/WORKER_PORT[\s\S]*OUTBOX_BATCH_SIZE[\s\S]*LOG_LEVEL/);
  });

  it("enforces the stale-claim floor (reclaiming live claims is destructive)", () => {
    expect(() =>
      parseWorkerEnv({ OUTBOX_STALE_CLAIM_MS: "1000" } as NodeJS.ProcessEnv),
    ).toThrow(/OUTBOX_STALE_CLAIM_MS/);
  });
});
