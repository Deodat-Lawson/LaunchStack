#!/usr/bin/env node
/** Isolated Grounding replay app. No .env loading, inherited provider keys, worker, or mail. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const PROJECT = "vantage-grounding-m3-20261106";
export const CONTAINER = `${PROJECT}-db`;
export const VOLUME = `${PROJECT}-data`;
export const DATABASE = "vantage_grounding_m3_20261106";
export const DATABASE_USER = "vantage_grounding_m3";
export const DATABASE_HOST = "127.0.0.1";
export const DATABASE_PORT = 55448;
export const APP_HOST = "localhost";
export const APP_PORT = 3188;
export const APP_URL = `http://${APP_HOST}:${APP_PORT}`;
export const MARKER = "io.launchstack.grounding-m3";
export const RUNTIME_DIR = resolve(ROOT, "test-output", PROJECT);
export const RUNTIME_FILE = resolve(RUNTIME_DIR, "runtime.json");
export const DOCKER_ENDPOINT = "npipe:////./pipe/dockerDesktopLinuxEngine";
export const FIXTURE_WEEK_START = "2026-10-12";
export const FIXTURE_FOLLOWING_WEEK_START = "2026-10-19";
export const FIXTURE_MAIN_EVIDENCE_DATE = "2026-10-29";
const DOCKER_CONFIG = resolve(RUNTIME_DIR, "docker-config");
const COMPOSE = resolve(ROOT, "scripts/dev/vantage-grounding-m3.compose.yml");
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
        id: "vantage-grounding-owner-20261106",
        email: "owner@vantage-grounding.test",
        name: "Synthetic Vantage Owner",
        workspace: "primary",
    },
    {
        id: "vantage-grounding-peer-20261106",
        email: "peer@vantage-grounding.test",
        name: "Synthetic Grounding Peer",
        workspace: "primary",
    },
    {
        id: "vantage-grounding-outsider-20261106",
        email: "outsider@vantage-grounding.test",
        name: "Synthetic Outside Owner",
        workspace: "outside",
    },
];

const DEFAULT_WORKSPACE_SLUGS = {
    primary: "vantage-grounding-m3-20261106",
    outside: "vantage-grounding-m3-20261106-outside",
};

export function isSafeRunNamespace(value) {
    return typeof value === "string" && /^r[a-f0-9]{16}$/.test(value);
}

export function createRunNamespace() {
    return `r${randomBytes(8).toString("hex")}`;
}

export function accountsFor(config = {}) {
    if (!config.runNamespace) return ACCOUNTS.map(account => ({ ...account }));
    const prefix = `vantage-${config.runNamespace}`;
    return [
        {
            id: `${prefix}-owner`,
            email: `owner+${config.runNamespace}@vantage-grounding.test`,
            name: "Synthetic Vantage Owner",
            workspace: "primary",
        },
        {
            id: `${prefix}-peer`,
            email: `peer+${config.runNamespace}@vantage-grounding.test`,
            name: "Synthetic Grounding Peer",
            workspace: "primary",
        },
        {
            id: `${prefix}-outsider`,
            email: `outsider+${config.runNamespace}@vantage-grounding.test`,
            name: "Synthetic Outside Owner",
            workspace: "outside",
        },
    ];
}

export function workspaceSlugsFor(config = {}) {
    if (!config.runNamespace) return { ...DEFAULT_WORKSPACE_SLUGS };
    return {
        primary: `${PROJECT}-${config.runNamespace}-primary`,
        outside: `${PROJECT}-${config.runNamespace}-outside`,
    };
}

export function isFixtureWeekDate(value) {
    const date = Date.parse(`${value}T00:00:00.000Z`);
    const start = Date.parse(`${FIXTURE_WEEK_START}T00:00:00.000Z`);
    const following = Date.parse(`${FIXTURE_FOLLOWING_WEEK_START}T00:00:00.000Z`);
    return Number.isFinite(date) && date >= start && date < following;
}

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
        url.hostname !== DATABASE_HOST ||
        url.port !== String(DATABASE_PORT) ||
        url.pathname !== `/${DATABASE}` ||
        url.username !== DATABASE_USER ||
        !/^[a-f0-9]{48}$/.test(url.password) ||
        url.search ||
        url.hash
    )
        throw new Error("Refusing a database other than the fixed synthetic loopback database.");
    return url;
}

/** The app and Better Auth must use one stable public origin for every child. */
export function assertAppUrl(raw) {
    let url;
    try {
        url = new URL(raw);
    } catch {
        throw new Error("Invalid isolated app URL.");
    }
    if (
        url.protocol !== "http:" ||
        url.hostname !== APP_HOST ||
        url.port !== String(APP_PORT) ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
    )
        throw new Error("Refusing an app origin other than the fixed localhost integration app.");
    return url;
}

export function runtimeAppUrl(config = {}) {
    const value = config.appUrl ?? APP_URL;
    assertAppUrl(value);
    return value;
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
    runtimeAppUrl(config);
    const accounts = accountsFor(config);
    return {
        ...systemEnvironment(inherited),
        NODE_ENV: "development",
        NODE_OPTIONS: `--require="${resolve(ROOT, "scripts/dev/vantage-grounding-network-guard.cjs").replaceAll("\\", "/")}"`,
        NEXT_FONT_GOOGLE_MOCKED_RESPONSES: resolve(ROOT, "scripts/dev/vantage-grounding-fonts.cjs"),
        TZ: "America/New_York",
        NEXT_TELEMETRY_DISABLED: "1",
        DATABASE_URL: config.databaseUrl,
        MIGRATE_DATABASE_URL: config.databaseUrl,
        VANTAGE_TEST_DATABASE_URL: config.databaseUrl,
        VANTAGE_TEST_MODE: "true",
        VANTAGE_TEST_COMPANY_ID: config.companyId ?? "0",
        VANTAGE_TEST_USER_IDS: accounts.slice(0, 2).map(account => account.id).join(","),
        VANTAGE_GROUNDING_M3_ENABLED: "true",
        VANTAGE_GROUNDING_M3_LIVE: "false",
        VANTAGE_GROUNDING_M3_OFFLINE_CONFIG: resolve(RUNTIME_DIR, "offline-runtime.json"),
        VANTAGE_GROUNDING_NETWORK_LOG: resolve(RUNTIME_DIR, "network-denials.jsonl"),
        VANTAGE_GROUNDING_M3_AS_OF: "2026-10-19T12:00:00.000Z",
        BETTER_AUTH_URL: runtimeAppUrl(config),
        APP_PUBLIC_URL: runtimeAppUrl(config),
        BETTER_AUTH_SECRET: config.authSecret,
        EMBEDDING_SECRETS_KEY: config.storageSecretKey,
        // No live model transport; any accidental client call fails on closed loopback.
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
        PROPOSALS_EXECUTOR: "inline",
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
        bindings[0].HostPort !== String(DATABASE_PORT) ||
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
        config?.storageSecretKey,
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

export function composePluginCandidates(inherited = process.env) {
    const candidates = [];
    if (inherited.DOCKER_COMPOSE_PLUGIN_DIR) candidates.push(inherited.DOCKER_COMPOSE_PLUGIN_DIR);
    for (const root of [
        inherited.LOCALAPPDATA ?? inherited.LocalAppData,
        inherited.PROGRAMFILES ?? inherited.ProgramFiles,
        inherited["PROGRAMFILES(X86)"] ?? inherited["ProgramFiles(x86)"],
    ]) {
        if (!root) continue;
        candidates.push(
            resolve(root, "Docker", "Docker", "resources", "cli-plugins"),
            resolve(root, "DockerDesktop", "resources", "cli-plugins")
        );
    }
    const userProfile = inherited.USERPROFILE ?? inherited.UserProfile;
    if (userProfile) candidates.push(resolve(userProfile, ".docker", "cli-plugins"));
    return [...new Set(candidates)];
}

export function discoverComposePlugin(inherited = process.env, fileExists = existsSync) {
    return (
        composePluginCandidates(inherited).find(directory =>
            fileExists(
                resolve(
                    directory,
                    process.platform === "win32" ? "docker-compose.exe" : "docker-compose"
                )
            )
        ) ?? null
    );
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
    const pluginDirectory = discoverComposePlugin(process.env);
    // Docker Desktop installations differ between per-user and machine-wide
    // layouts. When the CLI already has a built-in Compose plugin, leave its
    // discovery alone; otherwise add only the task-owned, empty plugin config.
    const configValue = pluginDirectory
        ? { auths: {}, credHelpers: {}, cliPluginsExtraDirs: [pluginDirectory] }
        : { auths: {}, credHelpers: {} };
    writeFileSync(emptyConfig, JSON.stringify(configValue) + "\n", { mode: 0o600 });
    const dockerEnv = {
        ...(options?.env ?? systemEnvironment()),
        DOCKER_CONFIG,
        DOCKER_HOST: DOCKER_ENDPOINT,
    };
    return run("C:/Users/junku/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe", ["--host", DOCKER_ENDPOINT, ...args], { ...options, env: dockerEnv });
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

async function checkFreePort(port, host = DATABASE_HOST) {
    await new Promise((resolvePort, reject) => {
        const server = createServer();
        server.once("error", () =>
            reject(
                new Error(`Loopback port ${port} on ${host} is occupied; no listener was stopped.`)
            )
        );
        server.listen(port, host, () => server.close(resolvePort));
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
    if (config.runNamespace !== undefined && !isSafeRunNamespace(config.runNamespace))
        throw new Error("Saved integration runtime has an unsafe run namespace.");
    if (config.storageSecretKey !== undefined && (!/^[A-Za-z0-9+/]{43}=$/.test(config.storageSecretKey) || Buffer.from(config.storageSecretKey, "base64").length !== 32))
        throw new Error("Saved Grounding storage key has an invalid format.");
    assertDatabaseUrl(config.databaseUrl);
    assertAppUrl(config.appUrl);
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

export function createRuntime(previous) {
    const databasePassword = previous?.databasePassword ?? randomBytes(24).toString("hex");
    const runNamespace = createRunNamespace();
    const config = {
        schemaVersion: 1,
        marker: PROJECT,
        runNamespace,
        databasePassword,
        databaseUrl:
            previous?.databaseUrl ??
            `postgres://${DATABASE_USER}:${databasePassword}@${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE}`,
        authSecret: randomBytes(32).toString("hex"),
        storageSecretKey: randomBytes(32).toString("base64"),
        loginPassword: randomBytes(24).toString("hex"),
        appUrl: APP_URL,
        createdAt: new Date().toISOString(),
    };
    config.companySlugs = workspaceSlugsFor(config);
    return config;
}

function ensureRuntime() {
    if (existsSync(RUNTIME_FILE)) return readRuntime();
    const config = createRuntime();
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
    const { seedGrounding } = await import("./vantage-grounding-seed.mjs");
    await seedGrounding(config);
    const { initializeUnapprovedM3Plan, openBudgetDatabase } = await import("./vantage-grounding-budget.mjs");
    // Persist company IDs before the counter opens the strictly-owned connection.
    writeRuntime(config);
    const budgetSql = await openBudgetDatabase();
    try { await initializeUnapprovedM3Plan(budgetSql); } finally { await budgetSql.end({ timeout: 5 }); }
    config.preparedAt = new Date().toISOString();
    writeRuntime(config);
}
async function prepareDatabase(config) {
    const container = await inspect("container", CONTAINER);
    const volume = await inspect("volume", VOLUME);
    if (container) assertOwnedContainer(container);
    if (volume) assertOwnedVolume(volume);
    if (!container?.State.Running) await checkFreePort(DATABASE_PORT);
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
}

async function prepare() {
    assertNoDotenv();
    await checkDocker();
    const config = ensureRuntime();
    await prepareDatabase(config);
    console.log(
        `[grounding] Prepared synthetic DB on ${DATABASE_HOST}:${DATABASE_PORT} and ${accountsFor(config).length} accounts. Runtime secrets remain in ignored test-output; sanitized-runtime.json contains reviewable settings.`
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
    await checkFreePort(APP_PORT, APP_HOST);
    const requireWeb = createRequire(resolve(WEB, "package.json"));
    const next = requireWeb.resolve("next/dist/bin/next");
    console.log(
        `[grounding] Starting actual synthetic Grounding app at ${APP_URL}; no worker or provider is started.`
    );
    const child = spawn(
        process.execPath,
        [next, "dev", "--hostname", APP_HOST, "--port", String(APP_PORT)],
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

async function serveFixture(refresh=false){
    assertNoDotenv();
    const requireRoot=createRequire(resolve(ROOT,'package.json'));
    const env={...systemEnvironment(),NODE_ENV:'development',SKIP_ENV_VALIDATION:'true',NEXT_TELEMETRY_DISABLED:'1',TSX_TSCONFIG_PATH:resolve(WEB,'tsconfig.json'),NODE_OPTIONS:`--require="${resolve(ROOT,'scripts/dev/vantage-grounding-network-guard.cjs').replaceAll('\\','/')}"`,VANTAGE_GROUNDING_NETWORK_LOG:resolve(RUNTIME_DIR,'network-denials.jsonl')};
    const child=spawn(process.execPath,['--import',pathToFileURL(requireRoot.resolve('tsx')).href,resolve(ROOT,'scripts/dev/vantage-grounding-fixture-server.mjs'),...(refresh?['--refresh']:[])],{cwd:WEB,env,shell:false,windowsHide:true,stdio:'inherit'});
    for(const signal of['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
    await new Promise((resolveRun,reject)=>{child.on('error',reject);child.on('close',code=>{process.exitCode=code??1;resolveRun();});});
}

export async function main(args = process.argv.slice(2)) {
    if (
        args.length !== 1 ||
        !["--prepare", "--serve", "--fixture", "--fixture-refresh", "--status", "--stop"].includes(
            args[0]
        )
    ) {
        console.log(
            "node scripts/dev/vantage-grounding-runtime.mjs --prepare | --fixture | --fixture-refresh | --serve | --status | --stop"
        );
        if (args[0] !== "--help") process.exitCode = 1;
        return;
    }
    if (args[0] === "--prepare") return prepare();
    if (args[0] === "--serve") return serve();
    if (args[0] === "--fixture") return serveFixture();
    if (args[0] === "--fixture-refresh") return serveFixture(true);
    await checkDocker();
    const container = await inspect("container", CONTAINER);
    const volume = await inspect("volume", VOLUME);
    if (container) assertOwnedContainer(container);
    if (volume) assertOwnedVolume(volume);
    if (args[0] === "--stop") {
        if (container?.State.Running) await docker(["stop", "--timeout", "10", CONTAINER]);
        console.log(
            "[grounding] Only dedicated DB stopped. Synthetic volume and runtime settings preserved."
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
            `[grounding] ${scrub(error instanceof Error ? error.message : String(error), config)}`
        );
        console.error(
            "[grounding] No automatic reset, deletion, remote Git operation, or provider request performed."
        );
        process.exitCode = 1;
    });
}
