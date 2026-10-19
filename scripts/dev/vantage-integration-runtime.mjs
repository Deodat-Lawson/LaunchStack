#!/usr/bin/env node
/** Integration-only launcher. No .env loading, inherited provider keys, worker, or mail. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { basename, dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const PROJECT = "vantage-integration-e2e-20261019";
export const CONTAINER = `${PROJECT}-db`;
export const VOLUME = `${PROJECT}-data`;
export const DATABASE = "vantage_integration_e2e_20261019";
export const DATABASE_USER = "vantage_integration_e2e";
export const APP_URL = "http://127.0.0.1:3102";
export const MARKER = "io.launchstack.integration-e2e";
export const RUNTIME_DIR = resolve(ROOT, "test-output", PROJECT);
export const RUNTIME_FILE = resolve(RUNTIME_DIR, "runtime.json");
export const DOCKER_ENDPOINT = "npipe:////./pipe/dockerDesktopLinuxEngine";
const DOCKER_CONFIG = resolve(RUNTIME_DIR, "docker-config");
const COMPOSE = resolve(ROOT, "scripts/dev/vantage-integration.compose.yml");
const COMPOSE_ENV = resolve(RUNTIME_DIR, "compose.env");
const WEB = resolve(ROOT, "apps/web");
const SYSTEM_KEYS = new Set([
    "PATH",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "SYSTEMDRIVE",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMDATA",
    "NUMBER_OF_PROCESSORS",
]);
export const ACCOUNTS = [
    {
        id: "vantage-integration-owner-20261019",
        email: "owner@vantage-integration.test",
        name: "Synthetic Vantage Owner",
        workspace: "primary",
    },
    {
        id: "vantage-integration-denied-20261019",
        email: "denied@vantage-integration.test",
        name: "Synthetic Denied Operator",
        workspace: "primary",
    },
    {
        id: "vantage-integration-outsider-20261019",
        email: "outsider@vantage-integration.test",
        name: "Synthetic Outside Owner",
        workspace: "outside",
    },
];

export function systemEnvironment(inherited = process.env) {
    return Object.fromEntries(
        Object.keys(inherited)
            .filter(key => SYSTEM_KEYS.has(key.toUpperCase()))
            .filter(key => inherited[key] !== undefined)
            .map(key => [key, inherited[key]])
    );
}

export function assertDatabaseUrl(raw) {
    let url;
    try {
        url = new URL(raw);
    } catch {
        throw new Error("Invalid isolated database URL.");
    }
    if (
        url.protocol !== "postgres:" ||
        url.hostname !== "127.0.0.1" ||
        url.port !== "55435" ||
        url.pathname !== `/${DATABASE}` ||
        url.username !== DATABASE_USER ||
        !/^[a-f0-9]{48}$/.test(url.password) ||
        url.search ||
        url.hash
    )
        throw new Error("Refusing a database other than the fixed synthetic loopback database.");
    return url;
}

export function assertNoDotenv(root = ROOT) {
    for (const directory of [root, resolve(root, "apps/web")]) {
        const loaded = readdirSync(directory).filter(name =>
            /^\.env(?:$|\.(?:local|development|production|test)(?:\.local)?$)/.test(name)
        );
        if (loaded.length)
            throw new Error(
                `Refusing runtime because dotenv files exist in ${directory}. No file was read or changed.`
            );
    }
}

export function childEnvironment(config, inherited = process.env) {
    assertDatabaseUrl(config.databaseUrl);
    return {
        ...systemEnvironment(inherited),
        NODE_ENV: "development",
        TZ: "America/New_York",
        NEXT_TELEMETRY_DISABLED: "1",
        DATABASE_URL: config.databaseUrl,
        MIGRATE_DATABASE_URL: config.databaseUrl,
        VANTAGE_TEST_DATABASE_URL: config.databaseUrl,
        VANTAGE_TEST_MODE: "true",
        VANTAGE_TEST_COMPANY_ID: config.companyId ?? "0",
        VANTAGE_TEST_USER_IDS: ACCOUNTS[0].id,
        BETTER_AUTH_URL: APP_URL,
        APP_PUBLIC_URL: APP_URL,
        BETTER_AUTH_SECRET: config.authSecret,
        // Rules-only work can initialise the engine, but any accidental model call fails locally.
        CHAT_BASE_URL: "http://127.0.0.1:9/v1",
        CHAT_API_KEY: "synthetic-disabled-no-provider",
        CHAT_MODELS_CONFIG: resolve(WEB, "config/chat-models.yaml"),
        DEPLOYMENT_MODE: "self-hosted",
        NEXT_PUBLIC_STORAGE_PROVIDER: "database",
        EMAIL_SENDING_ENABLED: "false",
        GMAIL_CONNECTOR_ENABLED: "false",
        AGENT_KNOWLEDGE_CONNECTOR_ENABLED: "false",
        AGENT_SESSIONS_CONNECTOR_ENABLED: "false",
        GOOGLE_DOCS_EDITING_ENABLED: "false",
        LANGCHAIN_TRACING_V2: "false",
        COMPOSE_REMOVE_ORPHANS: "false",
        VANTAGE_INTEGRATION_PASSWORD: config.databasePassword,
        DOCKER_CONFIG,
        DOCKER_HOST: DOCKER_ENDPOINT,
        INNGEST_DEV: "1",
        LOG_LEVEL: "warn",
    };
}

export function assertLocalDockerEndpoint(endpoint) {
    if (
        !/^unix:\/\/\//.test(endpoint ?? "") &&
        !/^npipe:\/{4}(\.|localhost)\/pipe\//.test(endpoint ?? "")
    )
        throw new Error("Only a local Docker Desktop engine is permitted.");
}

function assertLabels(labels) {
    if (labels?.[MARKER] !== PROJECT || labels?.["com.docker.compose.project"] !== PROJECT)
        throw new Error(
            "Refusing an existing resource without the exact integration ownership labels."
        );
}

export function assertOwnedContainer(container) {
    assertLabels(container.Config.Labels);
    const bindings = container.HostConfig.PortBindings?.["5432/tcp"] ?? [];
    const env = new Set(container.Config.Env);
    if (
        container.Name !== `/${CONTAINER}` ||
        container.Config.Image !== "pgvector/pgvector:pg16" ||
        container.Config.Labels["com.docker.compose.service"] !== "db" ||
        bindings.length !== 1 ||
        bindings[0].HostIp !== "127.0.0.1" ||
        bindings[0].HostPort !== "55435" ||
        !env.has(`POSTGRES_DB=${DATABASE}`) ||
        !env.has(`POSTGRES_USER=${DATABASE_USER}`) ||
        container.Mounts.length !== 1 ||
        !container.Mounts.some(
            m =>
                m.Type === "volume" &&
                m.Name === VOLUME &&
                m.Destination === "/var/lib/postgresql/data"
        )
    )
        throw new Error("Unexpected integration container configuration; nothing was reset.");
}

export function assertOwnedVolume(volume) {
    assertLabels(volume.Labels);
    if (volume.Name !== VOLUME || volume.Labels["com.docker.compose.volume"] !== "integration-data")
        throw new Error("Unexpected integration volume; nothing was reset.");
}

function scrub(text, config) {
    let result = String(text);
    for (const value of [
        config?.databaseUrl,
        config?.databasePassword,
        config?.authSecret,
        config?.loginPassword,
    ])
        if (value) result = result.split(value).join("[synthetic-secret-redacted]");
    return result;
}

/** Keep incomplete lines so a secret split across process output chunks is still removed. */
function forwardSanitized(stream, destination, config) {
    stream.setEncoding("utf8");
    let pending = "";
    stream.on("data", data => {
        pending += data;
        let newline;
        while ((newline = pending.indexOf("\n")) !== -1) {
            destination.write(scrub(pending.slice(0, newline + 1), config));
            pending = pending.slice(newline + 1);
        }
    });
    stream.on("end", () => {
        if (pending) destination.write(scrub(pending, config));
    });
}

async function run(
    command,
    args,
    { env = systemEnvironment(), cwd = ROOT, allowFailure = false, config } = {}
) {
    return new Promise((resolveRun, reject) => {
        const child = spawn(command, args, {
            cwd,
            env,
            shell: false,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "",
            stderr = "";
        child.stdout.on("data", data => {
            stdout += data;
        });
        child.stderr.on("data", data => {
            stderr += data;
        });
        child.on("error", error =>
            reject(new Error(`Could not start local task: ${error.code ?? "unknown"}.`))
        );
        child.on("close", code => {
            if (code !== 0 && !allowFailure)
                reject(
                    new Error(
                        scrub(
                            `${command === process.execPath ? "Node task" : command} failed (${code}): ${stderr.trim() || stdout.trim()}`,
                            config
                        )
                    )
                );
            else resolveRun({ code, stdout: stdout.trim(), stderr: stderr.trim() });
        });
    });
}

async function docker(args, options) {
    assertLocalDockerEndpoint(DOCKER_ENDPOINT);
    mkdirSync(DOCKER_CONFIG, { recursive: true });
    const emptyConfig = resolve(DOCKER_CONFIG, "config.json");
    if (existsSync(emptyConfig)) {
        const previous = JSON.parse(readFileSync(emptyConfig, "utf8"));
        if (
            Object.keys(previous).some(
                key => !["auths", "credHelpers", "cliPluginsExtraDirs"].includes(key)
            ) ||
            Object.keys(previous.auths ?? {}).length ||
            Object.keys(previous.credHelpers ?? {}).length
        )
            throw new Error(
                "Task-owned Docker settings unexpectedly contain other settings; no config was overwritten."
            );
    }
    const pluginDirectory = resolve(
        process.env.LOCALAPPDATA ?? "C:/Users/junku/AppData/Local",
        "Programs/DockerDesktop/resources/cli-plugins"
    );
    if (!existsSync(resolve(pluginDirectory, "docker-compose.exe")))
        throw new Error(
            "The local Docker Desktop Compose plugin was not found; no user Docker settings are used."
        );
    writeFileSync(
        emptyConfig,
        JSON.stringify({
            auths: {},
            credHelpers: {},
            cliPluginsExtraDirs: [pluginDirectory],
        }) + "\n",
        { mode: 0o600 }
    );
    const dockerEnv = {
        ...(options?.env ?? systemEnvironment()),
        DOCKER_CONFIG,
        DOCKER_HOST: DOCKER_ENDPOINT,
    };
    return run("docker", ["--host", DOCKER_ENDPOINT, ...args], { ...options, env: dockerEnv });
}

async function inspect(kind, name) {
    const result = await docker([kind, "inspect", name], { allowFailure: true });
    if (result.code === 0) return JSON.parse(result.stdout)[0];
    if (/no such (object|container|volume)|not found/i.test(result.stderr)) return null;
    throw new Error("Could not inspect the dedicated integration resource. Check Docker Desktop.");
}

async function checkDocker() {
    assertLocalDockerEndpoint(DOCKER_ENDPOINT);
    await docker(["info", "--format", "{{.ServerVersion}}"]);
    await docker(["compose", "version"]);
}

async function checkFreePort(port) {
    await new Promise((resolvePort, reject) => {
        const server = createServer();
        server.once("error", () =>
            reject(new Error(`Loopback port ${port} is occupied; no listener was stopped.`))
        );
        server.listen(port, "127.0.0.1", () => server.close(resolvePort));
    });
}

export function readRuntime() {
    const config = JSON.parse(readFileSync(RUNTIME_FILE, "utf8"));
    if (
        config.marker !== PROJECT ||
        config.schemaVersion !== 1 ||
        !/^[a-f0-9]{48}$/.test(config.databasePassword) ||
        !/^[a-f0-9]{64}$/.test(config.authSecret) ||
        !/^[a-f0-9]{48}$/.test(config.loginPassword)
    )
        throw new Error("Saved integration runtime has an unexpected identity or secret format.");
    assertDatabaseUrl(config.databaseUrl);
    if (new URL(config.databaseUrl).password !== config.databasePassword)
        throw new Error("Saved integration credential mismatch.");
    return config;
}

function writeRuntime(config) {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    writeFileSync(RUNTIME_FILE, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    writeFileSync(COMPOSE_ENV, `VANTAGE_INTEGRATION_PASSWORD=${config.databasePassword}\n`, {
        mode: 0o600,
    });
}

function ensureRuntime() {
    if (existsSync(RUNTIME_FILE)) return readRuntime();
    const databasePassword = randomBytes(24).toString("hex");
    const config = {
        schemaVersion: 1,
        marker: PROJECT,
        databasePassword,
        databaseUrl: `postgres://${DATABASE_USER}:${databasePassword}@127.0.0.1:55435/${DATABASE}`,
        authSecret: randomBytes(32).toString("hex"),
        loginPassword: randomBytes(24).toString("hex"),
        appUrl: APP_URL,
        createdAt: new Date().toISOString(),
    };
    writeRuntime(config);
    return config;
}

async function openDatabase(config) {
    assertDatabaseUrl(config.databaseUrl);
    const requireStore = createRequire(resolve(ROOT, "packages/store/package.json"));
    const { default: postgres } = await import(
        pathToFileURL(requireStore.resolve("postgres")).href
    );
    return postgres(config.databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
}

async function verifyDatabase(config, initialise = false) {
    const sql = await openDatabase(config);
    try {
        const [identity] =
            await sql`SELECT current_database() AS database, current_user AS username`;
        if (identity.database !== DATABASE || identity.username !== DATABASE_USER)
            throw new Error("Unexpected SQL database identity; migration/seed was refused.");
        const [existing] =
            await sql`SELECT to_regclass('public._vantage_integration_identity') AS marker`;
        if (!existing.marker) {
            if (!initialise) throw new Error("Missing integration database marker.");
            const tables =
                await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`;
            if (tables.length)
                throw new Error("Unmarked database is not empty; no data was changed.");
            await sql`CREATE TABLE _vantage_integration_identity (marker text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())`;
            await sql`INSERT INTO _vantage_integration_identity (marker) VALUES (${PROJECT})`;
        }
        const marker = await sql`SELECT marker FROM _vantage_integration_identity`;
        if (marker.length !== 1 || marker[0].marker !== PROJECT)
            throw new Error("Integration database marker mismatch.");
    } finally {
        await sql.end({ timeout: 5 });
    }
}

async function seed(config) {
    await verifyDatabase(config);
    const requireWeb = createRequire(resolve(WEB, "package.json"));
    const { hashPassword } = await import(
        pathToFileURL(requireWeb.resolve("better-auth/crypto")).href
    );
    const passwordHash = await hashPassword(config.loginPassword);
    const sql = await openDatabase(config);
    try {
        await sql.begin(async tx => {
            const companies = {};
            for (const [key, slug, name] of [
                [
                    "primary",
                    "vantage-integration-e2e-20261019",
                    "Synthetic Vantage Integration 2026-10-19",
                ],
                [
                    "outside",
                    "vantage-integration-outside-20261019",
                    "Synthetic Vantage Outside Workspace",
                ],
            ]) {
                let [row] = await tx`SELECT id FROM pdr_ai_v2_company WHERE slug=${slug}`;
                if (!row)
                    [row] =
                        await tx`INSERT INTO pdr_ai_v2_company (name, slug, "numberOfEmployees", use_uploadthing) VALUES (${name}, ${slug}, '1', false) RETURNING id`;
                companies[key] = String(row.id);
            }
            config.accounts = [];
            for (const account of ACCOUNTS) {
                const companyId = companies[account.workspace];
                const [existing] =
                    await tx`SELECT email FROM pdr_ai_v2_auth_user WHERE id=${account.id}`;
                if (existing && existing.email !== account.email)
                    throw new Error("Synthetic identity mismatch.");
                await tx`INSERT INTO pdr_ai_v2_auth_user (id, name, email, email_verified, created_at, updated_at) VALUES (${account.id}, ${account.name}, ${account.email}, true, now(), now()) ON CONFLICT (id) DO NOTHING`;
                await tx`INSERT INTO pdr_ai_v2_auth_account (id, issuer, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (${`${account.id}-credential`}, 'local:credential', ${account.id}, 'credential', ${account.id}, ${passwordHash}, now(), now()) ON CONFLICT (id) DO UPDATE SET password=excluded.password, updated_at=now()`;
                let [user] =
                    await tx`SELECT id, company_id FROM pdr_ai_v2_users WHERE "userId"=${account.id}`;
                if (!user)
                    [user] =
                        await tx`INSERT INTO pdr_ai_v2_users (name, email, "userId", company_id) VALUES (${account.name}, ${account.email}, ${account.id}, ${companyId}) RETURNING id, company_id`;
                if (String(user.company_id) !== companyId)
                    throw new Error("Synthetic membership identity mismatch.");
                await tx`INSERT INTO pdr_ai_v2_user_company_memberships (user_id, company_id, role, status) VALUES (${user.id}, ${companyId}, 'owner', 'active') ON CONFLICT (user_id, company_id) DO UPDATE SET role='owner', status='active'`;
                config.accounts.push({ ...account, userPk: String(user.id), companyId });
            }
            config.companyId = companies.primary;
            config.outsideCompanyId = companies.outside;
            const evidence = {
                id: "integration-interview-main-20261014",
                title: "Synthetic export-button interview",
                body: "One synthetic tester could not find the export button.",
                source: "Synthetic interview 2026-10-14",
                observedAt: "2026-10-14",
            };
            const oldEvidence = {
                id: "integration-interview-old-20261001",
                title: "Synthetic historical interview",
                body: "One synthetic tester requested a clearer onboarding checklist.",
                source: "Synthetic interview 2026-10-01",
                observedAt: "2026-10-01",
            };
            const fixtures = [
                oldEvidence,
                evidence,
                ...Array.from({ length: 201 }, (_, index) => ({
                    id: `integration-filler-evidence-${String(index).padStart(3, "0")}`,
                    title: `Synthetic historical filler ${index}`,
                    body: "Synthetic historical reference outside the main agenda week.",
                    source: "Synthetic fixture",
                    observedAt: "2026-10-10",
                })),
            ];
            for (const item of fixtures) {
                await tx`INSERT INTO pdr_ai_v2_vantage_evidence
                    (id, company_id, created_by_user_id, kind, title, body, source, observed_at, visibility, tags, created_at)
                    VALUES (${item.id}, ${companies.primary}, ${ACCOUNTS[0].id}, 'interview', ${item.title}, ${item.body}, ${item.source}, ${item.observedAt}, 'private', '[]'::jsonb, ${`${item.observedAt}T12:00:00.000Z`})
                    ON CONFLICT (id) DO NOTHING`;
            }
            const definitionId = "integration-signups-definition";
            await tx`INSERT INTO pdr_ai_v2_vantage_metric_definitions
                (id, company_id, key, name, definition, unit, created_at)
                VALUES (${definitionId}, ${companies.primary}, 'signups', 'Signups', 'Synthetic new accounts created during the complete Monday-Sunday period; count cannot be negative.', 'count', '2026-09-01T12:00:00.000Z')
                ON CONFLICT (id) DO NOTHING`;
            const observation = {
                id: "integration-signups-main-20261018",
                metricId: definitionId,
                value: 20,
                periodStart: "2026-10-12",
                periodEnd: "2026-10-18",
                createdAt: "2026-10-18T12:00:00.000Z",
            };
            const oldObservation = {
                id: "integration-signups-old-20260920",
                metricId: definitionId,
                value: 3,
                periodStart: "2026-09-14",
                periodEnd: "2026-09-20",
                createdAt: "2026-09-20T12:00:00.000Z",
            };
            const observations = [
                oldObservation,
                observation,
                {
                    id: "integration-signups-previous-20261011",
                    metricId: definitionId,
                    value: 10,
                    periodStart: "2026-10-05",
                    periodEnd: "2026-10-11",
                    createdAt: "2026-10-11T12:00:00.000Z",
                },
                ...Array.from({ length: 501 }, (_, index) => ({
                    id: `integration-filler-observation-${String(index).padStart(3, "0")}`,
                    metricId: definitionId,
                    value: index,
                    periodStart: "2026-09-21",
                    periodEnd: "2026-09-27",
                    createdAt: "2026-09-27T12:00:00.000Z",
                })),
            ];
            for (const item of observations) {
                await tx`INSERT INTO pdr_ai_v2_vantage_metric_observations
                    (id, company_id, metric_id, created_by_user_id, value, period_start, period_end, source, created_at)
                    VALUES (${item.id}, ${companies.primary}, ${item.metricId}, ${ACCOUNTS[0].id}, ${item.value}, ${item.periodStart}, ${item.periodEnd}, 'Synthetic fixture', ${item.createdAt})
                    ON CONFLICT (id) DO NOTHING`;
            }
            config.fixture = {
                weekStart: "2026-10-12",
                followingWeekStart: "2026-10-19",
                evidence,
                oldEvidence,
                observation,
                oldObservation,
                definition: { id: definitionId, key: "signups", name: "Signups", unit: "count" },
                evidenceCount: fixtures.length,
                observationCount: observations.length,
                accounts: config.accounts,
            };
        });
    } finally {
        await sql.end({ timeout: 5 });
    }
    config.preparedAt = new Date().toISOString();
    writeRuntime(config);
    writeFileSync(
        resolve(RUNTIME_DIR, "fixture.json"),
        JSON.stringify(config.fixture, null, 2) + "\n"
    );
    writeFileSync(
        resolve(RUNTIME_DIR, "sanitized-runtime.json"),
        JSON.stringify(
            {
                marker: PROJECT,
                appUrl: APP_URL,
                database: { host: "127.0.0.1", port: 55435, name: DATABASE, user: DATABASE_USER },
                gate: {
                    mode: "true",
                    companyId: config.companyId,
                    allowedSubjects: [ACCOUNTS[0].id],
                },
                accounts: config.accounts,
                provider: "rules-only; model endpoint closed loopback port 9",
                environment: "system allowlist plus synthetic settings; no .env files",
                worker: "not started",
                mail: "disabled",
                connectors: "disabled",
                preparedAt: config.preparedAt,
            },
            null,
            2
        ) + "\n"
    );
}

async function prepare() {
    assertNoDotenv();
    await checkDocker();
    const container = await inspect("container", CONTAINER);
    const volume = await inspect("volume", VOLUME);
    if (container) assertOwnedContainer(container);
    if (volume) assertOwnedVolume(volume);
    if (!container?.State.Running) await checkFreePort(55435);
    const config = ensureRuntime();
    if (container && !container.Config.Env.includes(`POSTGRES_PASSWORD=${config.databasePassword}`))
        throw new Error(
            "Existing integration DB credentials do not match the task runtime; no reset performed."
        );
    const env = childEnvironment(config);
    await docker(
        [
            "compose",
            "--project-name",
            PROJECT,
            "--file",
            COMPOSE,
            "--env-file",
            COMPOSE_ENV,
            "up",
            "--detach",
            "--wait",
            "--wait-timeout",
            "90",
            "db",
        ],
        { env, config }
    );
    assertOwnedContainer(await inspect("container", CONTAINER));
    assertOwnedVolume(await inspect("volume", VOLUME));
    await verifyDatabase(config, true);
    for (const set of ["engine", "product"]) {
        for (const check of [false, true]) {
            const result = await run(
                process.execPath,
                [
                    "packages/store/scripts/migrate.mjs",
                    `--set=${set}`,
                    ...(check ? ["--check"] : []),
                ],
                { env, config }
            );
            console.log(scrub(result.stdout, config));
        }
    }
    await seed(config);
    console.log(
        `[integration] Prepared synthetic DB on 127.0.0.1:55435 and ${ACCOUNTS.length} accounts. Runtime secrets remain in ignored test-output; sanitized-runtime.json contains reviewable settings.`
    );
}

async function serve() {
    assertNoDotenv();
    const config = readRuntime();
    if (!config.preparedAt || !/^[1-9][0-9]*$/.test(config.companyId ?? ""))
        throw new Error("Run --prepare first.");
    await checkDocker();
    const container = await inspect("container", CONTAINER);
    assertOwnedContainer(container);
    if (!container.State.Running) throw new Error("Dedicated integration DB is not running.");
    await verifyDatabase(config);
    await checkFreePort(3102);
    const requireWeb = createRequire(resolve(WEB, "package.json"));
    const next = requireWeb.resolve("next/dist/bin/next");
    console.log(
        `[integration] Starting synthetic rules-only app at ${APP_URL}; no worker or provider is started.`
    );
    const child = spawn(
        process.execPath,
        [next, "dev", "--hostname", "127.0.0.1", "--port", "3102"],
        {
            cwd: WEB,
            env: childEnvironment(config),
            shell: false,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        }
    );
    forwardSanitized(child.stdout, process.stdout, config);
    forwardSanitized(child.stderr, process.stderr, config);
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
    await new Promise((resolveServe, reject) => {
        child.on("error", () => reject(new Error("Could not start the integration app.")));
        child.on("close", code => {
            process.exitCode = code ?? 1;
            resolveServe();
        });
    });
}

async function e2e(grep) {
    assertNoDotenv();
    const config = readRuntime();
    if (!config.preparedAt || !config.companyId) throw new Error("Run --prepare first.");
    await verifyDatabase(config);
    const requireWeb = createRequire(resolve(WEB, "package.json"));
    const cli = requireWeb.resolve("@playwright/test/cli");
    const runId = new Date().toISOString().replace(/[^a-zA-Z0-9-]/g, "-");
    const reportFile = resolve(RUNTIME_DIR, "reports", `${runId}.json`);
    const evidenceDirectory = resolve(RUNTIME_DIR, "evidence", runId);
    mkdirSync(dirname(reportFile), { recursive: true });
    mkdirSync(evidenceDirectory, { recursive: true });
    const result = await run(
        process.execPath,
        [
            cli,
            "test",
            "e2e/vantage-contract-v1.spec.ts",
            "--workers=1",
            "--reporter=list,json",
            "--trace=off",
            ...(grep ? ["--grep", grep] : []),
        ],
        {
            cwd: WEB,
            config,
            allowFailure: true,
            env: {
                ...childEnvironment(config),
                E2E_BASE_URL: APP_URL,
                VANTAGE_E2E_ISOLATED: "1",
                VANTAGE_E2E_EMAIL: ACCOUNTS[0].email,
                VANTAGE_E2E_PASSWORD: config.loginPassword,
                VANTAGE_E2E_FIXTURE_PATH: resolve(RUNTIME_DIR, "fixture.json"),
                VANTAGE_E2E_DENIED_EMAIL: ACCOUNTS[1].email,
                VANTAGE_E2E_OUTSIDER_EMAIL: ACCOUNTS[2].email,
                PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
            },
        }
    );
    const output = scrub(`${result.stdout}\n${result.stderr}\n`, config);
    writeFileSync(resolve(RUNTIME_DIR, "e2e-sanitized.log"), output);
    writeFileSync(resolve(RUNTIME_DIR, "reports", `${runId}.log`), output);
    if (existsSync(reportFile)) {
        const report = JSON.parse(readFileSync(reportFile, "utf8"));
        let count = 0;
        const preserveAttachments = value => {
            if (!value || typeof value !== "object") return;
            if (Array.isArray(value)) {
                value.forEach(preserveAttachments);
                return;
            }
            if (Array.isArray(value.attachments)) {
                value.attachments = value.attachments.filter(attachment => {
                    if (!attachment.path) return attachment.contentType === "application/json";
                    const source = resolve(attachment.path);
                    if (
                        !source.startsWith(resolve(WEB, "test-results") + sep) ||
                        ![".json", ".png"].includes(extname(source).toLowerCase())
                    )
                        return false;
                    const destination = resolve(
                        evidenceDirectory,
                        `${String(++count).padStart(3, "0")}-${basename(source)}`
                    );
                    if (extname(source).toLowerCase() === ".json")
                        writeFileSync(destination, scrub(readFileSync(source, "utf8"), config));
                    else copyFileSync(source, destination);
                    attachment.path = destination;
                    return true;
                });
            }
            Object.values(value).forEach(preserveAttachments);
        };
        preserveAttachments(report);
        writeFileSync(reportFile, scrub(JSON.stringify(report, null, 2), config));
        console.log(`[integration] Sanitized acceptance report: ${reportFile}`);
    }
    console.log(output);
    process.exitCode = result.code ?? 1;
}

export async function main(args = process.argv.slice(2)) {
    if (args[0] === "--e2e" && args.length === 3 && args[1] === "--grep" && args[2].length <= 200)
        return e2e(args[2]);
    if (
        args.length !== 1 ||
        !["--prepare", "--serve", "--e2e", "--status", "--stop"].includes(args[0])
    ) {
        console.log(
            "node scripts/dev/vantage-integration-runtime.mjs --prepare | --serve | --e2e | --status | --stop"
        );
        if (args[0] !== "--help") process.exitCode = 1;
        return;
    }
    if (args[0] === "--prepare") return prepare();
    if (args[0] === "--serve") return serve();
    if (args[0] === "--e2e") return e2e();
    await checkDocker();
    const container = await inspect("container", CONTAINER);
    const volume = await inspect("volume", VOLUME);
    if (container) assertOwnedContainer(container);
    if (volume) assertOwnedVolume(volume);
    if (args[0] === "--stop") {
        if (container?.State.Running) await docker(["stop", "--timeout", "10", CONTAINER]);
        console.log(
            "[integration] Only dedicated DB stopped. Synthetic volume and runtime settings preserved."
        );
    } else
        console.log(
            JSON.stringify({
                project: PROJECT,
                container: container ? (container.State.Running ? "running" : "stopped") : "absent",
                volume: volume ? "present" : "absent",
                appUrl: APP_URL,
                runtime: existsSync(RUNTIME_FILE) ? "present" : "absent",
            })
        );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main().catch(error => {
        let config;
        try {
            if (existsSync(RUNTIME_FILE)) config = readRuntime();
        } catch {
            /* Malformed task config is not printed. */
        }
        console.error(
            `[integration] ${scrub(error instanceof Error ? error.message : String(error), config)}`
        );
        console.error(
            "[integration] No automatic reset, deletion, remote Git operation, or provider request performed."
        );
        process.exitCode = 1;
    });
}
