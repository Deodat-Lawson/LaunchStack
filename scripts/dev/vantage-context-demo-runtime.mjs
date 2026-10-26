#!/usr/bin/env node
/** Local synthetic UI runtime. Preserves the existing dedicated PostgreSQL volume and fixtures. */
import { spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    assertLocalDockerEndpoint,
    assertOwnedContainer,
    assertOwnedVolume,
    childEnvironment as tlEnvironment,
    parsePassword,
    CONTAINER,
    VOLUME,
} from "./vantage-integration-tl-test.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const RUNTIME_DIR = resolve(ROOT, "test-output/vantage-context-demo/runtime");
export const FIXTURE_FILE = resolve(RUNTIME_DIR, "fixture.json");
export const CREDENTIALS_FILE = resolve(RUNTIME_DIR, "credentials.json");
export const APP_URL = "http://localhost:3104";
export const DEMO_AS_OF = "2026-10-26T23:59:00.000Z";
export const APPROVED_MODELS_SHA256 =
    "2b5e377779313de1e13868b4c61f0633d15b63a3eb82e03d761f399768e02bb9";
const WEB = resolve(ROOT, "apps/web");
let diagnosticStage = "arguments";

export function assertRuntimeFile(path) {
    const absolute = resolve(path);
    if (!absolute.startsWith(resolve(ROOT, "test-output") + sep))
        throw new Error(
            "Demo files must stay inside this checkout's ignored test-output directory."
        );
    return absolute;
}

export function assertDatabaseUrl(raw) {
    const value = new URL(raw);
    if (
        value.protocol !== "postgres:" ||
        value.hostname !== "127.0.0.1" ||
        value.port !== "55437" ||
        value.pathname !== "/vantage_week2_tl_contract_v1" ||
        value.username !== "vantage_week2_tl" ||
        value.search ||
        value.hash
    )
        throw new Error("Only the existing dedicated synthetic TL PostgreSQL target is allowed.");
    return value;
}

export function assertApprovedAzureEndpoint(raw) {
    let endpoint;
    try {
        endpoint = new URL(raw);
    } catch {
        throw new Error("Invalid synthetic chat endpoint.");
    }
    if (
        endpoint.protocol !== "https:" ||
        !/^[a-z0-9-]+\.openai\.azure\.com$/i.test(endpoint.hostname) ||
        endpoint.pathname.replace(/\/+$/, "") !== "/openai/v1" ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
    )
        throw new Error("Use the approved Azure OpenAI v1 endpoint.");
    return endpoint;
}

export function approvedProvider(inherited = process.env) {
    const { CHAT_BASE_URL, CHAT_API_KEY, CHAT_MODELS_CONFIG } = inherited;
    if (!CHAT_BASE_URL || !CHAT_API_KEY || !CHAT_MODELS_CONFIG)
        throw new Error(
            "Set CHAT_BASE_URL, CHAT_API_KEY and absolute CHAT_MODELS_CONFIG for the approved synthetic Azure deployment."
        );
    assertApprovedAzureEndpoint(CHAT_BASE_URL);
    if (!isAbsolute(CHAT_MODELS_CONFIG)) throw new Error("Use the absolute verified model config.");
    const hash = createHash("sha256").update(readFileSync(CHAT_MODELS_CONFIG)).digest("hex");
    if (hash !== APPROVED_MODELS_SHA256)
        throw new Error(
            "The model config differs from the verified synthetic gpt-6-luna configuration."
        );
    return { CHAT_BASE_URL, CHAT_API_KEY, CHAT_MODELS_CONFIG };
}

export function assertNoDotenv() {
    for (const directory of [ROOT, WEB])
        if (
            readdirSync(directory).some(name =>
                /^\.env(?:$|\.(?:local|development|production|test)(?:\.local)?$)/.test(name)
            )
        )
            throw new Error(
                "This isolated runtime must not load repository/app dotenv files. Existing files were preserved."
            );
}

function credentials() {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    if (!existsSync(CREDENTIALS_FILE))
        writeFileSync(
            CREDENTIALS_FILE,
            JSON.stringify(
                {
                    schemaVersion: "vantage-context-demo-secrets/v1",
                    authSecret: randomBytes(32).toString("base64"),
                    loginPassword: randomBytes(24).toString("hex"),
                    embeddingSecretsKey: randomBytes(32).toString("base64"),
                },
                null,
                2
            ) + "\n",
            { flag: "wx", mode: 0o600 }
        );
    const value = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf8"));
    if (
        value.schemaVersion !== "vantage-context-demo-secrets/v1" ||
        typeof value.authSecret !== "string" ||
        value.authSecret.length < 32 ||
        !/^[a-f0-9]{48}$/.test(value.loginPassword ?? "") ||
        Buffer.from(value.embeddingSecretsKey ?? "", "base64").length !== 32
    )
        throw new Error("The existing local demo credential file is invalid; it was not changed.");
    return value;
}

function databaseEnvironment() {
    const password = parsePassword(
        readFileSync(resolve(ROOT, "scripts/dev/vantage-integration-tl.env.local"), "utf8")
    );
    if (!password) throw new Error("The existing TL database local credential file is required.");
    const env = tlEnvironment(password);
    assertDatabaseUrl(env.DATABASE_URL);
    return env;
}

export function demoEnvironment(base, secret, fixture, provider = {}) {
    assertDatabaseUrl(base.DATABASE_URL);
    return {
        ...base,
        ...provider,
        NODE_ENV: "development",
        TZ: "America/New_York",
        BETTER_AUTH_URL: APP_URL,
        APP_PUBLIC_URL: APP_URL,
        BETTER_AUTH_SECRET: secret.authSecret,
        EMBEDDING_SECRETS_KEY: secret.embeddingSecretsKey,
        VANTAGE_CONTEXT_DEMO_ENABLED: "true",
        VANTAGE_CONTEXT_DEMO_FIXTURE: FIXTURE_FILE,
        VANTAGE_CONTEXT_DEMO_CREDENTIALS: CREDENTIALS_FILE,
        VANTAGE_CONTEXT_DEMO_AS_OF: DEMO_AS_OF,
        VANTAGE_TEST_MODE: "true",
        VANTAGE_TEST_COMPANY_ID: fixture?.companyId ?? "0",
        VANTAGE_TEST_USER_IDS: fixture?.actorId ?? "",
        NEXT_TELEMETRY_DISABLED: "1",
        DEPLOYMENT_MODE: "self-hosted",
        NEXT_PUBLIC_STORAGE_PROVIDER: "database",
        LANGCHAIN_TRACING_V2: "false",
        INNGEST_DEV: "1",
        LOG_LEVEL: "warn",
    };
}

function scrub(text, values) {
    let safe = String(text);
    for (const value of values.filter(Boolean))
        safe = safe.split(value).join("[local-secret-redacted]");
    return safe;
}

function run(command, args, options = {}) {
    return new Promise((done, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd ?? ROOT,
            env: options.env ?? process.env,
            shell: false,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "",
            stderr = "";
        child.stdout.on("data", chunk => {
            stdout += chunk;
        });
        child.stderr.on("data", chunk => {
            stderr += chunk;
        });
        child.once("error", () => reject(new Error("Could not start a local demo prerequisite.")));
        child.once("close", code => done({ code, stdout, stderr }));
    });
}

async function verifyOwnedDatabase(base) {
    const context = await run("docker", ["context", "inspect"]);
    if (context.code !== 0) throw new Error("Local Docker Desktop is unavailable.");
    assertLocalDockerEndpoint(JSON.parse(context.stdout)[0]?.Endpoints?.docker?.Host);
    if (process.env.DOCKER_HOST) assertLocalDockerEndpoint(process.env.DOCKER_HOST);
    const result = await run("docker", ["container", "inspect", CONTAINER]);
    const volumeResult = await run("docker", ["volume", "inspect", VOLUME]);
    if (result.code !== 0 || volumeResult.code !== 0)
        throw new Error(
            "Existing isolated TL database/volume required; this helper never creates or resets them."
        );
    const container = JSON.parse(result.stdout)[0];
    assertOwnedContainer(container);
    assertOwnedVolume(JSON.parse(volumeResult.stdout)[0]);
    const password = new URL(base.DATABASE_URL).password;
    if (!container.State.Running || !container.Config.Env.includes(`POSTGRES_PASSWORD=${password}`))
        throw new Error(
            "The owned TL database is stopped or local credentials do not match. No data was changed."
        );
}

async function prepare() {
    diagnosticStage = "isolated-runtime-files";
    assertNoDotenv();
    const base = databaseEnvironment(),
        secret = credentials();
    diagnosticStage = "existing-owned-database-check";
    await verifyOwnedDatabase(base);
    const env = demoEnvironment(base, secret, null);
    diagnosticStage = "native-synthetic-seed";
    const result = await run(
        process.execPath,
        ["--import", "tsx", resolve(WEB, "scripts/vantage-context-demo-seed.ts")],
        { cwd: WEB, env: { ...env, TSX_TSCONFIG_PATH: resolve(WEB, "tsconfig.json") } }
    );
    const output = scrub(result.stdout + result.stderr, [
        base.DATABASE_URL,
        base.VANTAGE_TL_TEST_PASSWORD,
        secret.authSecret,
        secret.loginPassword,
        secret.embeddingSecretsKey,
    ]);
    if (output) process.stdout.write(output);
    if (result.code !== 0)
        throw new Error("Synthetic seed failed; retained fixture state and logs were not reset.");
    console.log(`[context-demo] Prepared. Login credentials are local-only in ${CREDENTIALS_FILE}`);
}

function readFixture() {
    if (!existsSync(FIXTURE_FILE)) throw new Error("Run --prepare first.");
    return JSON.parse(readFileSync(FIXTURE_FILE, "utf8"));
}

async function enrichCompany() {
    diagnosticStage = "isolated-runtime-files";
    assertNoDotenv();
    const base = databaseEnvironment(),
        secret = credentials(),
        fixture = readFixture();
    diagnosticStage = "existing-owned-database-check";
    await verifyOwnedDatabase(base);
    diagnosticStage = "synthetic-company-enrichment";
    const result = await run(
        process.execPath,
        ["--import", "tsx", resolve(WEB, "scripts/vantage-context-company-enrich.ts"), "--apply"],
        {
            cwd: WEB,
            env: {
                ...demoEnvironment(base, secret, fixture),
                TSX_TSCONFIG_PATH: resolve(WEB, "tsconfig.json"),
            },
        }
    );
    const output = scrub(result.stdout + result.stderr, [
        base.DATABASE_URL,
        base.VANTAGE_TL_TEST_PASSWORD,
        secret.authSecret,
        secret.loginPassword,
        secret.embeddingSecretsKey,
    ]);
    if (output) process.stdout.write(output);
    if (result.code !== 0)
        throw new Error(
            "Synthetic company enrichment failed; preserved local proof must be inspected before retrying."
        );
}

async function serve() {
    diagnosticStage = "isolated-runtime-files";
    assertNoDotenv();
    const base = databaseEnvironment(),
        secret = credentials(),
        fixture = readFixture();
    diagnosticStage = "approved-model-configuration";
    const provider = approvedProvider();
    diagnosticStage = "existing-owned-database-check";
    await verifyOwnedDatabase(base);
    diagnosticStage = "local-app-port";
    await new Promise((done, reject) => {
        const server = createServer();
        server.once("error", () =>
            reject(new Error("Local port 3104 is occupied; no existing process was stopped."))
        );
        server.listen(3104, "localhost", () => server.close(done));
    });
    diagnosticStage = "next-runtime-start";
    const requireWeb = createRequire(resolve(WEB, "package.json"));
    const next = requireWeb.resolve("next/dist/bin/next");
    const env = demoEnvironment(base, secret, fixture, provider);
    console.log(
        `[context-demo] ${APP_URL}/dev/vantage-context — native authentication; synthetic data only; no worker.`
    );
    const child = spawn(
        process.execPath,
        [next, "dev", "--turbo", "--hostname", "localhost", "--port", "3104"],
        {
            cwd: WEB,
            env,
            shell: false,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        }
    );
    const secrets = [
        base.DATABASE_URL,
        base.VANTAGE_TL_TEST_PASSWORD,
        secret.authSecret,
        secret.loginPassword,
        secret.embeddingSecretsKey,
        provider.CHAT_API_KEY,
        provider.CHAT_BASE_URL,
    ];
    try {
        secrets.push(new URL(provider.CHAT_BASE_URL).hostname);
    } catch {
        /* validated above */
    }
    for (const [stream, target] of [
        [child.stdout, process.stdout],
        [child.stderr, process.stderr],
    ]) {
        stream.setEncoding("utf8");
        let pending = "";
        stream.on("data", chunk => {
            pending += chunk;
            let newline;
            while ((newline = pending.indexOf("\n")) >= 0) {
                target.write(scrub(pending.slice(0, newline + 1), secrets));
                pending = pending.slice(newline + 1);
            }
        });
        stream.on("end", () => {
            if (pending) target.write(scrub(pending, secrets));
        });
    }
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
    await new Promise((done, reject) => {
        child.once("error", () => reject(new Error("Could not start the local Next.js runtime.")));
        child.once("close", code => {
            process.exitCode = code ?? 1;
            done();
        });
    });
}

export async function main(args = process.argv.slice(2)) {
    if (
        args.length !== 1 ||
        !["--prepare", "--serve", "--status", "--enrich-company"].includes(args[0])
    ) {
        console.log(
            "node scripts/dev/vantage-context-demo-runtime.mjs --prepare | --serve | --status | --enrich-company"
        );
        if (args[0] !== "--help") process.exitCode = 1;
        return;
    }
    if (args[0] === "--prepare") return prepare();
    if (args[0] === "--serve") return serve();
    if (args[0] === "--enrich-company") return enrichCompany();
    const fixture = existsSync(FIXTURE_FILE) ? readFixture() : null;
    console.log(
        JSON.stringify(
            {
                appUrl: APP_URL,
                prepared: !!fixture,
                fixtureId: fixture?.fixtureId ?? null,
                fixtureFile: FIXTURE_FILE,
                model: "approved gpt-6-luna; only called by explicit interactive generation",
                weeks: fixture?.weeks ?? [],
                credentialsFile: CREDENTIALS_FILE,
            },
            null,
            2
        )
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
    main().catch(() => {
        console.error(
            `[context-demo] Local runtime failed at ${diagnosticStage}. Existing configuration was preserved; no credentials were printed.`
        );
        process.exitCode = 1;
    });
