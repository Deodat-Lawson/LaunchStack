import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const mode = process.argv[2];
const database = "postgres://postgres:vantage_port_disposable@127.0.0.1:55439/vantage_port";
const origin = "http://127.0.0.1:3199";
for (const key of ["DATABASE_URL", "MIGRATE_DATABASE_URL"]) {
    if (process.env[key] && process.env[key] !== database) {
        throw new Error("Vantage acceptance requires its dedicated disposable database.");
    }
}

const artifactDir = resolve(root, "test-output/vantage-acceptance");
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
const keys = JSON.parse(readFileSync(keyPath, "utf8"));
const modeOff = mode === "serve-off" || mode === "browser-off";
const env = {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_URL: database,
    MIGRATE_DATABASE_URL: database,
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: keys.auth,
    EMBEDDING_SECRETS_KEY: keys.encryption,
    E2E_BASE_URL: origin,
    VANTAGE_ACCEPTANCE_STATE: resolve(artifactDir, "fixture.json"),
    CHAT_BASE_URL: "http://127.0.0.1:9/v1",
    CHAT_API_KEY: "synthetic-disabled",
    OPENAI_API_KEY: "",
    EMAIL_SENDING_ENABLED: "false",
    NEXT_TELEMETRY_DISABLED: "1",
    VANTAGE_WEEKLY_REVIEW_ENABLED: modeOff ? "false" : "true",
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

const web = resolve(root, "apps/web");
if (mode === "migrate") {
    run("packages/store/scripts/migrate.mjs");
    run("packages/store/scripts/migrate.mjs", ["--set=product"]);
} else if (mode === "serve" || mode === "serve-off") {
    run(
        "apps/web/node_modules/next/dist/bin/next",
        ["dev", "--hostname", "127.0.0.1", "--port", "3199"],
        web
    );
} else if (mode === "browser" || mode === "browser-off") {
    run(
        "apps/web/node_modules/@playwright/test/cli.js",
        ["test", "e2e/vantage-weekly-review.spec.ts", "--project=chromium"],
        web
    );
} else {
    throw new Error("Use migrate, serve, browser, serve-off, or browser-off.");
}
