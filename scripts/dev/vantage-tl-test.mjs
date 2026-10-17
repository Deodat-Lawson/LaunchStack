#!/usr/bin/env node
/** Local TL environment only. Never starts the app or installs an AI adapter. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PROJECT = "launchstack-vantage-tl";
const CONTAINER = "launchstack-vantage-tl-db";
const VOLUME = "launchstack-vantage-tl-data";
const DATABASE = "vantage_tl_contract_v1";
const USER = "vantage_tl";
const MARKER = "io.launchstack.tl-test";
const DATA_DIR = "/var/lib/postgresql/data";
const COMPOSE = resolve(ROOT, "scripts/dev/vantage-tl.compose.yml");
const LOCAL_ENV = resolve(ROOT, "scripts/dev/vantage-tl.env.local");
const EXAMPLE_ENV = resolve(ROOT, "scripts/dev/vantage-tl.env.example");
const VITEST = resolve(ROOT, "pipelines/node_modules/vitest/vitest.mjs");
const JEST = resolve(ROOT, "apps/web/node_modules/jest/bin/jest.js");
const PIPELINE_TESTS = [
    "src/vantage/week.test.ts",
    "src/vantage/update.test.ts",
    "src/vantage/signals.test.ts",
    "src/vantage/csv.test.ts",
    "src/vantage/contract-v1.test.ts",
    "src/vantage/repository-v1.integration.test.ts",
];
const WEB_TESTS = [
    "__tests__/api/vantage/contract-v1.route.test.ts",
    "__tests__/api/vantage/contract-v1.integration.test.ts",
    "__tests__/api/vantage/decide.route.test.ts",
    "__tests__/api/vantage/triage.route.test.ts",
    "__tests__/server/vantage-access-v1.test.ts",
    "__tests__/server/vantage-service-v1.test.ts",
    "__tests__/server/vantage-auth-v1.integration.test.ts",
    "__tests__/lib/require-workspace-context.test.ts",
    "__tests__/lib/active-workspace.test.ts",
    "__tests__/authz/resolve.test.ts",
    "__tests__/server/history.test.ts",
];

export function childEnvironment(password, inherited = process.env) {
    const url = `postgres://${USER}:${encodeURIComponent(password)}@127.0.0.1:55434/${DATABASE}`;
    return {
        ...inherited,
        DATABASE_URL: url,
        MIGRATE_DATABASE_URL: url,
        VANTAGE_TL_TEST_DATABASE_URL: url,
        VANTAGE_TEST_DATABASE_URL: url,
        VANTAGE_TL_TEST_PASSWORD: password,
        PGPASSWORD: password,
        NODE_ENV: "test",
        COMPOSE_REMOVE_ORPHANS: "false",
    };
}

export function parsePassword(text) {
    let password = "";
    for (const line of text.split(/\r?\n/)) {
        const setting = line.trim();
        if (!setting || setting.startsWith("#")) continue;
        const match = /^VANTAGE_TL_TEST_PASSWORD=([A-Za-z0-9_-]*)$/.exec(setting);
        if (!match) throw new Error("The TL settings file accepts only VANTAGE_TL_TEST_PASSWORD.");
        password = match[1];
    }
    if (password && !/^[A-Za-z0-9_-]{16,128}$/.test(password))
        throw new Error(
            "Use a local test password of 16-128 letters, digits, underscores or hyphens."
        );
    return password;
}

export function assertLocalDockerEndpoint(endpoint) {
    if (
        !/^unix:\/\/\//.test(endpoint ?? "") &&
        !/^npipe:\/{4}(\.|localhost)\/pipe\//.test(endpoint ?? "")
    )
        throw new Error(
            "Use a local Docker Desktop/unix-socket context; remote Docker is not supported."
        );
}

function assertLabels(labels) {
    if (labels?.[MARKER] !== "contract-v1" || labels?.["com.docker.compose.project"] !== PROJECT)
        throw new Error(
            "An existing Docker resource lacks the TL ownership labels; it was not changed."
        );
}

export function assertOwnedVolume(volume) {
    assertLabels(volume.Labels);
    if (volume.Name !== VOLUME || volume.Labels["com.docker.compose.volume"] !== "tl-data")
        throw new Error("The existing test volume does not match this environment.");
}

export function assertOwnedContainer(container) {
    assertLabels(container.Config.Labels);
    const bindings = container.HostConfig.PortBindings?.["5432/tcp"] ?? [];
    const environment = new Set(container.Config.Env);
    if (
        container.Name !== `/${CONTAINER}` ||
        container.Config.Image !== "pgvector/pgvector:pg16" ||
        container.Config.Labels["com.docker.compose.service"] !== "db" ||
        bindings.length !== 1 ||
        bindings[0].HostIp !== "127.0.0.1" ||
        bindings[0].HostPort !== "55434" ||
        !environment.has(`POSTGRES_DB=${DATABASE}`) ||
        !environment.has(`POSTGRES_USER=${USER}`) ||
        container.Mounts.length !== 1 ||
        !container.Mounts.some(
            m => m.Type === "volume" && m.Name === VOLUME && m.Destination === DATA_DIR
        )
    )
        throw new Error(
            "The existing TL container has an unexpected image, port, database or volume; it was not changed."
        );
}

function run(
    command,
    args,
    { env = process.env, cwd = ROOT, capture = false, allowFailure = false } = {}
) {
    return new Promise((resolveRun, reject) => {
        const child = spawn(command, args, {
            cwd,
            env,
            shell: false,
            windowsHide: true,
            stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
        });
        let stdout = "",
            stderr = "";
        if (capture) {
            child.stdout.on("data", data => {
                stdout += data;
            });
            child.stderr.on("data", data => {
                stderr += data;
            });
        }
        child.on("error", error =>
            reject(
                new Error(
                    `Could not start ${command === process.execPath ? "Node" : command}: ${error.code ?? "unknown error"}. Check the documented prerequisites.`
                )
            )
        );
        child.on("close", code => {
            if (code !== 0 && !allowFailure)
                reject(
                    new Error(
                        `${command === process.execPath ? "Node task" : command} failed (${code ?? "signal"}).${capture ? ` ${stderr.trim()}` : " See the output above."}`
                    )
                );
            else resolveRun({ code, stdout: stdout.trim(), stderr: stderr.trim() });
        });
    });
}

async function inspect(kind, name) {
    const result = await run("docker", [kind, "inspect", name], {
        capture: true,
        allowFailure: true,
    });
    if (result.code === 0) return JSON.parse(result.stdout)[0];
    if (/no such (object|container|volume)|not found/i.test(result.stderr)) return null;
    throw new Error(`Could not inspect the dedicated TL ${kind}. Check Docker Desktop.`);
}

async function checkDocker() {
    if (process.env.DOCKER_HOST) assertLocalDockerEndpoint(process.env.DOCKER_HOST);
    const context = await run("docker", ["context", "inspect"], { capture: true });
    assertLocalDockerEndpoint(JSON.parse(context.stdout)[0]?.Endpoints?.docker?.Host);
    await run("docker", ["info", "--format", "{{.ServerVersion}}"], { capture: true });
    await run("docker", ["compose", "version"], { capture: true });
}

async function checkFreePort() {
    await new Promise((resolvePort, reject) => {
        const server = createServer();
        server.once("error", () =>
            reject(
                new Error(
                    "Local port 55434 is occupied. Stop the conflicting listener yourself; no existing service was changed."
                )
            )
        );
        server.listen(55434, "127.0.0.1", () => server.close(resolvePort));
    });
}

function localPassword() {
    const exists = existsSync(LOCAL_ENV);
    const password = parsePassword(readFileSync(exists ? LOCAL_ENV : EXAMPLE_ENV, "utf8"));
    if (password) return password;
    const generated = randomBytes(24).toString("hex");
    writeFileSync(
        LOCAL_ENV,
        `# Generated local TL test credentials. Keep this file for reruns.\nVANTAGE_TL_TEST_PASSWORD=${generated}\n`,
        { mode: 0o600, flag: exists ? "w" : "wx" }
    );
    console.log("[TL] Created ignored local test credentials; keep this file for reruns.");
    return generated;
}

async function ensureDependencies(env) {
    const required = [
        VITEST,
        JEST,
        resolve(ROOT, "packages/store/node_modules/postgres/package.json"),
        resolve(ROOT, "packages/store/node_modules/dotenv/package.json"),
    ];
    if (required.every(file => existsSync(file))) return;
    const pnpm = process.env.npm_execpath;
    if (!pnpm || !existsSync(pnpm) || !/pnpm\.(cjs|mjs|js)$/.test(pnpm))
        throw new Error(
            "Dependencies are missing. Run this launcher with pnpm test:tl to install the locked dependencies."
        );
    console.log(
        "[TL] Installing missing dependencies with the frozen lockfile (first run may download packages)."
    );
    await run(process.execPath, [pnpm, "install", "--frozen-lockfile", "--prod=false"], {
        env: { ...env, CI: "true" },
    });
    if (!required.every(file => existsSync(file)))
        throw new Error("Dependency install did not provide the required TL test tools.");
}

async function waitForDatabase() {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
        const container = await inspect("container", CONTAINER);
        if (container) {
            assertOwnedContainer(container);
            if (container.State.Health?.Status === "healthy") return container;
            if (!container.State.Running)
                throw new Error("The TL database stopped during startup. Inspect its Docker logs.");
        }
        await new Promise(done => setTimeout(done, 1000));
    }
    throw new Error(
        "The TL database did not become healthy within 90 seconds. Inspect its Docker logs."
    );
}

export async function main(args = process.argv.slice(2)) {
    args = args.filter(arg => arg !== "--");
    if (args.includes("--help")) {
        console.log(
            "pnpm test:tl        Start the isolated local DB, migrate, and run TL tests.\npnpm test:tl --stop Stop only the TL container, preserving its database volume."
        );
        return;
    }
    if (args.some(arg => arg !== "--stop") || args.length > 1)
        throw new Error("Use pnpm test:tl, pnpm test:tl --stop, or --help.");
    if (Number(process.versions.node.split(".")[0]) < 20)
        throw new Error("Node.js 20 or later is required.");
    console.log("[TL] Checking the local Docker engine and dedicated test resources.");
    await checkDocker();
    const existing = await inspect("container", CONTAINER);
    const volume = await inspect("volume", VOLUME);
    if (existing) assertOwnedContainer(existing);
    if (volume) assertOwnedVolume(volume);
    if (args.includes("--stop")) {
        if (existing?.State.Running) await run("docker", ["stop", "--timeout", "10", CONTAINER]);
        console.log(
            "[TL] Dedicated database stopped; its volume and local credentials are preserved."
        );
        return;
    }
    if (!existing?.State.Running) await checkFreePort();
    const password = localPassword();
    if (existing && !existing.Config.Env.includes(`POSTGRES_PASSWORD=${password}`))
        throw new Error(
            "The saved local credentials differ from the existing TL container. Restore its original local settings; no data was reset."
        );
    const env = childEnvironment(password);
    await ensureDependencies(env);
    console.log("[TL] Starting the isolated database on 127.0.0.1:55434.");
    await run(
        "docker",
        [
            "compose",
            "--project-name",
            PROJECT,
            "--file",
            COMPOSE,
            "--env-file",
            LOCAL_ENV,
            "up",
            "--detach",
            "db",
        ],
        { env }
    );
    await waitForDatabase();
    const identity = await run(
        "docker",
        [
            "exec",
            "--env",
            "PGPASSWORD",
            CONTAINER,
            "psql",
            "--host",
            "127.0.0.1",
            "--username",
            USER,
            "--dbname",
            DATABASE,
            "--tuples-only",
            "--no-align",
            "--command",
            "SELECT current_database(), current_user",
        ],
        { env, capture: true }
    );
    if (identity.stdout !== `${DATABASE}|${USER}`)
        throw new Error("Unexpected database identity; migrations were not run.");
    console.log("[TL] Applying and checking the engine/product migration sets.");
    for (const set of ["engine", "product"]) {
        await run(process.execPath, ["packages/store/scripts/migrate.mjs", `--set=${set}`], {
            env,
        });
        await run(
            process.execPath,
            ["packages/store/scripts/migrate.mjs", `--set=${set}`, "--check"],
            { env }
        );
    }
    console.log(
        "[TL] Running the fixed pipeline suite, including real PostgreSQL persistence cases."
    );
    await run(process.execPath, [VITEST, "run", ...PIPELINE_TESTS], {
        env,
        cwd: resolve(ROOT, "pipelines"),
    });
    console.log("[TL] Running the fixed API/auth/history suite, including real PostgreSQL cases.");
    await run(process.execPath, [JEST, "--runInBand", "--runTestsByPath", ...WEB_TESTS], {
        env,
        cwd: resolve(ROOT, "apps/web"),
    });
    console.log(
        "[TL] PASS: TL tests completed with real database suites enabled. Session identity and generation remain test doubles; no app, browser or model was started."
    );
    console.log(
        "[TL] Database remains running for reruns. Stop it with pnpm test:tl --stop (data is preserved)."
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main().catch(error => {
        console.error(`[TL] ${error.message}`);
        console.error("[TL] No automatic database reset or volume removal was performed.");
        process.exitCode = 1;
    });
}
