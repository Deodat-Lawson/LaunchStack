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
export const PROJECT = "vantage-week2-rebuild-20261022";
export const CONTAINER = `${PROJECT}-db`;
export const VOLUME = `${PROJECT}-data`;
export const DATABASE = "vantage_week2_rebuild_20261022";
export const DATABASE_USER = "vantage_week2_rebuild";
export const DATABASE_HOST = "127.0.0.1";
export const DATABASE_PORT = 55436;
export const APP_HOST = "localhost";
export const APP_PORT = 3103;
export const APP_URL = `http://${APP_HOST}:${APP_PORT}`;
export const MARKER = "io.launchstack.integration-e2e";
export const RUNTIME_DIR = resolve(ROOT, "test-output", PROJECT);
export const RUNTIME_FILE = resolve(RUNTIME_DIR, "runtime.json");
export const RUNTIME_ARCHIVE_DIR = resolve(RUNTIME_DIR, "archive");
export const DOCKER_ENDPOINT = "npipe:////./pipe/dockerDesktopLinuxEngine";
export const FIXTURE_WEEK_START = "2026-10-12";
export const FIXTURE_FOLLOWING_WEEK_START = "2026-10-19";
export const FIXTURE_MAIN_EVIDENCE_DATE = "2026-10-18";
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
        id: "vantage-week2-owner-20261022",
        email: "owner@vantage-week2.test",
        name: "Synthetic Vantage Owner",
        workspace: "primary",
    },
    {
        id: "vantage-week2-denied-20261022",
        email: "denied@vantage-week2.test",
        name: "Synthetic Denied Operator",
        workspace: "primary",
    },
    {
        id: "vantage-week2-outsider-20261022",
        email: "outsider@vantage-week2.test",
        name: "Synthetic Outside Owner",
        workspace: "outside",
    },
];

const LEGACY_WORKSPACE_SLUGS = {
    primary: "vantage-week2-rebuild-20261022",
    outside: "vantage-week2-outside-20261022",
};

const LEGACY_FIXTURE_IDS = {
    evidence: "integration-interview-main-20261022",
    oldEvidence: "integration-interview-old-20261001",
    evidenceFiller: "integration-filler-evidence",
    definition: "integration-signups-definition",
    observation: "integration-signups-main-20261018",
    oldObservation: "integration-signups-old-20260920",
    previousObservation: "integration-signups-previous-20261011",
    observationFiller: "integration-filler-observation",
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
            email: `owner+${config.runNamespace}@vantage-week2.test`,
            name: "Synthetic Vantage Owner",
            workspace: "primary",
        },
        {
            id: `${prefix}-denied`,
            email: `denied+${config.runNamespace}@vantage-week2.test`,
            name: "Synthetic Denied Operator",
            workspace: "primary",
        },
        {
            id: `${prefix}-outsider`,
            email: `outsider+${config.runNamespace}@vantage-week2.test`,
            name: "Synthetic Outside Owner",
            workspace: "outside",
        },
    ];
}

export function workspaceSlugsFor(config = {}) {
    if (!config.runNamespace) return { ...LEGACY_WORKSPACE_SLUGS };
    return {
        primary: `${PROJECT}-${config.runNamespace}-primary`,
        outside: `${PROJECT}-${config.runNamespace}-outside`,
    };
}

export function fixtureIdsFor(config = {}) {
    if (!config.runNamespace) return { ...LEGACY_FIXTURE_IDS };
    // Fixture IDs land in varchar(64) columns. Keep the per-run entropy while
    // avoiding the long project slug plus namespace combination.
    const prefix = `vantage-${config.runNamespace.slice(1)}`;
    return {
        evidence: `${prefix}-interview-main`,
        oldEvidence: `${prefix}-interview-old`,
        evidenceFiller: `${prefix}-filler-evidence`,
        definition: `${prefix}-signups-definition`,
        observation: `${prefix}-signups-main`,
        oldObservation: `${prefix}-signups-old`,
        previousObservation: `${prefix}-signups-previous`,
        observationFiller: `${prefix}-filler-observation`,
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
        TZ: "America/New_York",
        NEXT_TELEMETRY_DISABLED: "1",
        DATABASE_URL: config.databaseUrl,
        MIGRATE_DATABASE_URL: config.databaseUrl,
        VANTAGE_TEST_DATABASE_URL: config.databaseUrl,
        VANTAGE_TEST_MODE: "true",
        VANTAGE_TEST_COMPANY_ID: config.companyId ?? "0",
        VANTAGE_TEST_USER_IDS: accounts[0].id,
        BETTER_AUTH_URL: runtimeAppUrl(config),
        APP_PUBLIC_URL: runtimeAppUrl(config),
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
        loginPassword: randomBytes(24).toString("hex"),
        appUrl: APP_URL,
        createdAt: new Date().toISOString(),
    };
    config.companySlugs = workspaceSlugsFor(config);
    config.fixtureIds = fixtureIdsFor(config);
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
    const accounts = accountsFor(config);
    const slugs = workspaceSlugsFor(config);
    const fixtureIds = fixtureIdsFor(config);
    config.companySlugs = slugs;
    config.fixtureIds = fixtureIds;
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
                ["primary", slugs.primary, "Synthetic Vantage Week 2 Rebuild 2026-10-22"],
                ["outside", slugs.outside, "Synthetic Vantage Week 2 Outside Workspace"],
            ]) {
                let [row] = await tx`SELECT id FROM pdr_ai_v2_company WHERE slug=${slug}`;
                if (!row)
                    [row] =
                        await tx`INSERT INTO pdr_ai_v2_company (name, slug, "numberOfEmployees", use_uploadthing) VALUES (${name}, ${slug}, '1', false) RETURNING id`;
                companies[key] = String(row.id);
            }
            config.accounts = [];
            for (const account of accounts) {
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
                id: fixtureIds.evidence,
                title: "Synthetic export-button interview",
                body: "One synthetic tester could not find the export button.",
                source: `Synthetic interview ${FIXTURE_MAIN_EVIDENCE_DATE}`,
                observedAt: FIXTURE_MAIN_EVIDENCE_DATE,
            };
            const oldEvidence = {
                id: fixtureIds.oldEvidence,
                title: "Synthetic historical interview",
                body: "One synthetic tester requested a clearer onboarding checklist.",
                source: "Synthetic interview 2026-10-01",
                observedAt: "2026-10-01",
            };
            const fixtures = [
                oldEvidence,
                evidence,
                ...Array.from({ length: 201 }, (_, index) => ({
                    id: `${fixtureIds.evidenceFiller}-${String(index).padStart(3, "0")}`,
                    title: `Synthetic historical filler ${index}`,
                    body: "Synthetic historical reference outside the main agenda week.",
                    source: "Synthetic fixture",
                    observedAt: "2026-10-10",
                })),
            ];
            for (const item of fixtures) {
                await tx`INSERT INTO pdr_ai_v2_vantage_evidence
                    (id, company_id, created_by_user_id, kind, title, body, source, observed_at, visibility, tags, created_at)
                    VALUES (${item.id}, ${companies.primary}, ${accounts[0].id}, 'interview', ${item.title}, ${item.body}, ${item.source}, ${item.observedAt}, 'private', '[]'::jsonb, ${`${item.observedAt}T12:00:00.000Z`})
                    ON CONFLICT (id) DO NOTHING`;
            }
            const definitionId = fixtureIds.definition;
            await tx`INSERT INTO pdr_ai_v2_vantage_metric_definitions
                (id, company_id, key, name, definition, unit, created_at)
                VALUES (${definitionId}, ${companies.primary}, 'signups', 'Signups', 'Synthetic finite signed metric recorded for the complete Monday-Sunday period; negative values represent a decrease.', 'count', '2026-09-01T12:00:00.000Z')
                ON CONFLICT (id) DO NOTHING`;
            const observation = {
                id: fixtureIds.observation,
                metricId: definitionId,
                value: 20,
                periodStart: "2026-10-12",
                periodEnd: "2026-10-18",
                createdAt: "2026-10-18T12:00:00.000Z",
            };
            const oldObservation = {
                id: fixtureIds.oldObservation,
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
                    id: fixtureIds.previousObservation,
                    metricId: definitionId,
                    value: 10,
                    periodStart: "2026-10-05",
                    periodEnd: "2026-10-11",
                    createdAt: "2026-10-11T12:00:00.000Z",
                },
                ...Array.from({ length: 501 }, (_, index) => ({
                    id: `${fixtureIds.observationFiller}-${String(index).padStart(3, "0")}`,
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
                    VALUES (${item.id}, ${companies.primary}, ${item.metricId}, ${accounts[0].id}, ${item.value}, ${item.periodStart}, ${item.periodEnd}, 'Synthetic fixture', ${item.createdAt})
                    ON CONFLICT (id) DO NOTHING`;
            }
            config.fixture = {
                weekStart: FIXTURE_WEEK_START,
                followingWeekStart: FIXTURE_FOLLOWING_WEEK_START,
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
                database: {
                    host: DATABASE_HOST,
                    port: DATABASE_PORT,
                    name: DATABASE,
                    user: DATABASE_USER,
                },
                gate: {
                    mode: "true",
                    companyId: config.companyId,
                    allowedSubjects: [accounts[0].id],
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

function archiveRuntime() {
    if (!existsSync(RUNTIME_FILE)) return null;
    mkdirSync(RUNTIME_ARCHIVE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[^0-9]/g, "");
    const archiveBase = `${stamp}-${randomBytes(4).toString("hex")}`;
    const archived = [];
    for (const name of ["runtime.json", "fixture.json", "sanitized-runtime.json"]) {
        const source = resolve(RUNTIME_DIR, name);
        if (!existsSync(source)) continue;
        const destination = resolve(RUNTIME_ARCHIVE_DIR, `${archiveBase}-${name}`);
        copyFileSync(source, destination);
        archived.push(destination);
    }
    return archived;
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
        `[integration] Prepared synthetic DB on ${DATABASE_HOST}:${DATABASE_PORT} and ${accountsFor(config).length} accounts. Runtime secrets remain in ignored test-output; sanitized-runtime.json contains reviewable settings.`
    );
}

async function prepareFresh() {
    assertNoDotenv();
    // A running app may still hold the previous auth/runtime namespace. Refuse
    // before Docker inspection or archive writes so a retry is safe and clear.
    await checkFreePort(APP_PORT, APP_HOST);
    await checkDocker();
    const previous = ensureRuntime();
    await prepareDatabase(previous);
    archiveRuntime();
    const config = createRuntime(previous);
    writeRuntime(config);
    await seed(config);
    console.log(
        `[integration] Prepared fresh synthetic namespace ${config.runNamespace} on ${DATABASE_HOST}:${DATABASE_PORT}; previous runtime state was archived without changing existing rows.`
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
        `[integration] Starting synthetic rules-only app at ${APP_URL}; no worker or provider is started.`
    );
    const child = spawn(
        process.execPath,
        [next, "dev", "--turbo", "--hostname", APP_HOST, "--port", String(APP_PORT)],
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
    const accounts = accountsFor(config);
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
                E2E_BASE_URL: runtimeAppUrl(config),
                VANTAGE_E2E_ISOLATED: "1",
                VANTAGE_E2E_EMAIL: accounts[0].email,
                VANTAGE_E2E_PASSWORD: config.loginPassword,
                VANTAGE_E2E_FIXTURE_PATH: resolve(RUNTIME_DIR, "fixture.json"),
                VANTAGE_E2E_DENIED_EMAIL: accounts[1].email,
                VANTAGE_E2E_OUTSIDER_EMAIL: accounts[2].email,
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
        !["--prepare", "--prepare-fresh", "--serve", "--e2e", "--status", "--stop"].includes(
            args[0]
        )
    ) {
        console.log(
            "node scripts/dev/vantage-integration-runtime.mjs --prepare | --prepare-fresh | --serve | --e2e | --status | --stop"
        );
        if (args[0] !== "--help") process.exitCode = 1;
        return;
    }
    if (args[0] === "--prepare") return prepare();
    if (args[0] === "--prepare-fresh") return prepareFresh();
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
