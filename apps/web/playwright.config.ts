import { defineConfig, devices } from "@playwright/test";

/**
 * Browser end-to-end tests against a running app.
 *
 * These drive the real product — sign-up, workspace, the Documents
 * workspace — through a browser, so they need a server with a database
 * behind it. Point `E2E_BASE_URL` at it (a local `next dev --port 3010`
 * against the Compose Postgres is the usual setup); nothing starts a server
 * here, and the suite is not part of `pnpm test`.
 *
 *   E2E_BASE_URL=http://localhost:3010 pnpm --filter @launchstack/web test:e2e
 */
export default defineConfig({
    testDir: "./e2e",
    timeout: 120_000,
    // A dev server compiles routes on demand, so the first test to reach a
    // route pays for its build. That is slow, not broken — a short expect
    // timeout turns it into a flake on the first run after a restart.
    expect: { timeout: 30_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
    use: {
        baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3010",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "off",
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
