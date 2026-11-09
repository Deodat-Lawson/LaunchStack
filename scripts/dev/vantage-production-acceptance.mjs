#!/usr/bin/env node
// Task-owned synthetic acceptance runner. Never accepts a production database.
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const mode = process.argv[2];
const database =
    "postgres://vantage_test:vantage_test_only@127.0.0.1:55569/vantage_production_acceptance";
const origin = "http://127.0.0.1:3199";
if (process.env.DATABASE_URL && process.env.DATABASE_URL !== database) {
    throw new Error("Refusing an environment that points at another database.");
}
const artifactDir = resolve(root, "test-output/vantage-production-acceptance");
mkdirSync(artifactDir, { recursive: true });
const keyPath = resolve(artifactDir, "synthetic-keys.json");
if (!existsSync(keyPath)) {
    writeFileSync(
        keyPath,
        JSON.stringify({
            auth: randomBytes(48).toString("base64url"),
            encryption: randomBytes(32).toString("base64"),
        }),
        { flag: "wx", mode: 0o600 }
    );
}
const syntheticKeys = JSON.parse(readFileSync(keyPath, "utf8"));
const env = {
    ...process.env,
    DATABASE_URL: database,
    MIGRATE_DATABASE_URL: database,
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: syntheticKeys.auth,
    EMBEDDING_SECRETS_KEY: syntheticKeys.encryption,
    E2E_BASE_URL: origin,
    // No real provider credential is supplied by this runner.
    CHAT_API_KEY: "",
    OPENAI_API_KEY: "",
    AI_API_KEY: "",
    CHAT_BASE_URL: "http://127.0.0.1:9/v1",
    NEXT_TELEMETRY_DISABLED: "1",
    VANTAGE_WEEKLY_REVIEW_ENABLED: "true",
    VANTAGE_WEEKLY_REVIEW_TEST_PROVIDER: "true",
};
function run(script, args = [], cwd = root) {
    const result = spawnSync(process.execPath, [resolve(root, script), ...args], {
        cwd,
        env,
        stdio: "inherit",
        windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
if (mode === "migrate") {
    run("packages/store/scripts/migrate.mjs");
    run("packages/store/scripts/migrate.mjs", ["--set=product"]);
} else if (mode === "serve") {
    run(
        "apps/web/node_modules/next/dist/bin/next",
        ["dev", "--hostname", "127.0.0.1", "--port", "3199"],
        resolve(root, "apps/web")
    );
} else if (mode === "browser") {
    run(
        "apps/web/node_modules/@playwright/test/cli.js",
        ["test", "e2e/vantage-weekly-review.spec.ts", "--project=chromium"],
        resolve(root, "apps/web")
    );
} else if (mode === "build") {
    env.NODE_ENV = "production";
    env.VANTAGE_WEEKLY_REVIEW_ENABLED = "false";
    env.VANTAGE_WEEKLY_REVIEW_TEST_PROVIDER = "false";
    run("apps/web/scripts/copy-pdf-worker.mjs", [], resolve(root, "apps/web"));
    run("apps/web/node_modules/next/dist/bin/next", ["build"], resolve(root, "apps/web"));
} else {
    throw new Error(
        "Use migrate, serve, browser, or build. This runner never enables live providers."
    );
}
