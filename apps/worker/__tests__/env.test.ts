import { describe, expect, it } from "vitest";

import { parseWorkerEnv, resolveChatModelsConfig } from "../src/env";

describe("parseWorkerEnv", () => {
  it("applies defaults with an empty environment", () => {
    const env = parseWorkerEnv({} as NodeJS.ProcessEnv);
    expect(env.WORKER_PORT).toBe(8020);
    expect(env.OUTBOX_BATCH_SIZE).toBe(10);
    expect(env.OUTBOX_IDLE_POLL_MS).toBe(2000);
    // 60 min: must stay above the slowest expected handler (long archive
    // expansions) — a premature reclaim double-runs work.
    expect(env.OUTBOX_STALE_CLAIM_MS).toBe(60 * 60_000);
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

describe("resolveChatModelsConfig", () => {
  const workerDir = "/app/apps/worker";
  const cwd = "/app/apps/worker";
  const shared = "/app/apps/web/config/chat-models.yaml";

  it("defaults to the shared web config when unset and the file exists", () => {
    const result = resolveChatModelsConfig({
      configured: undefined,
      workerDir,
      cwd,
      exists: (p) => p === shared,
    });
    expect(result).toEqual({ value: shared, reason: "defaulted" });
  });

  it("leaves env alone when unset and the shared file is missing", () => {
    const result = resolveChatModelsConfig({
      configured: undefined,
      workerDir,
      cwd,
      exists: () => false,
    });
    expect(result).toBeUndefined();
  });

  it("remaps a relative path missing from cwd to the shared web location", () => {
    // The compose shared-env default: relative, resolves fine from apps/web
    // but not from the worker's WORKDIR — must not crash-loop the worker.
    const result = resolveChatModelsConfig({
      configured: "config/chat-models.yaml",
      workerDir,
      cwd,
      exists: (p) => p === shared,
    });
    expect(result).toEqual({ value: shared, reason: "remapped-to-web" });
  });

  it("respects a relative path that exists from the worker cwd", () => {
    const result = resolveChatModelsConfig({
      configured: "config/chat-models.yaml",
      workerDir,
      cwd,
      exists: (p) => p === "/app/apps/worker/config/chat-models.yaml",
    });
    expect(result).toBeUndefined();
  });

  it("never rewrites an absolute path, even a broken one", () => {
    const result = resolveChatModelsConfig({
      configured: "/etc/launchstack/chat-models.yaml",
      workerDir,
      cwd,
      exists: () => false,
    });
    expect(result).toBeUndefined();
  });

  it("leaves a relative path alone when no candidate exists (engine reports the real error)", () => {
    const result = resolveChatModelsConfig({
      configured: "nope/chat-models.yaml",
      workerDir,
      cwd,
      exists: () => false,
    });
    expect(result).toBeUndefined();
  });
});
