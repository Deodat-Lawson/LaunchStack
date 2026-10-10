#!/usr/bin/env node
/**
 * Read-only check for a LaunchStack developer machine.
 *
 * Reports whether Docker, the daemon, and `.env` are ready for the standard
 * Compose path. It never installs software, never writes `.env`, and never
 * prints secret values. The mutating setup wizard described in
 * docs/developer-onboarding.md is a later step; this is the check it should
 * run first.
 *
 *   node scripts/dev/setup-doctor.mjs
 *   pnpm setup:check
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const DOCKER_INSTALL = {
    darwin: "https://docs.docker.com/desktop/setup/install/mac-install/",
    win32: "https://docs.docker.com/desktop/setup/install/windows-install/",
    linux: "https://docs.docker.com/engine/install/",
};

const PLACEHOLDER_SECRETS = new Set([
    "BETTER_AUTH_SECRET",
    "replace-me",
    "changeme",
    "secret",
    "password",
]);

/** @param {string} text */
export function parseEnv(text) {
    /** @type {Record<string, string>} */
    const out = {};
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        out[key] = value;
    }
    return out;
}

/** @param {string | undefined} value */
export function isRealSecret(value) {
    const text = value?.trim() ?? "";
    if (text.length < 16) return false;
    if (PLACEHOLDER_SECRETS.has(text)) return false;
    return true;
}

/** @param {string | undefined} value */
export function isPlaceholderKey(value) {
    const text = value?.trim() ?? "";
    if (!text) return false;
    return text === "AIza..." || text.endsWith("...");
}

/** @param {string | undefined} value */
function hasUsableKey(value) {
    const text = value?.trim() ?? "";
    return text.length > 0 && !isPlaceholderKey(text);
}

/**
 * @param {string | undefined} baseUrl
 * @param {string | undefined} apiKey
 */
function chatPairReady(baseUrl, apiKey) {
    const url = baseUrl?.trim() ?? "";
    if (!url) return false;
    const key = apiKey?.trim() ?? "";
    if (!key) {
        return /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);
    }
    return hasUsableKey(key);
}

/**
 * @param {{
 *   platform: string,
 *   dockerCli: boolean,
 *   compose: boolean,
 *   daemon: boolean | null,
 *   envExists: boolean,
 *   env: Record<string, string>,
 *   nodeMajor: number | null,
 *   pnpmVersion: string | null,
 * }} facts
 */
export function assess(facts) {
    /** @type {string[]} */
    const ok = [];
    /** @type {string[]} */
    const missing = [];
    /** @type {string[]} */
    const warnings = [];

    const installUrl = DOCKER_INSTALL[facts.platform] ?? DOCKER_INSTALL.linux;

    if (!facts.dockerCli) {
        missing.push(
            `Docker is not installed. Download it for this machine: ${installUrl}`
        );
    } else {
        ok.push("Docker CLI is installed.");
    }

    if (facts.dockerCli && !facts.compose) {
        missing.push(
            "Docker Compose v2 is not available (`docker compose version`). It ships with Docker Desktop; on Linux install the compose plugin."
        );
    } else if (facts.compose) {
        ok.push("Docker Compose v2 is available.");
    }

    if (facts.dockerCli && facts.compose && facts.daemon === false) {
        missing.push(
            facts.platform === "linux"
                ? "The Docker daemon is not running. Start it (for example `sudo service docker start`) and re-run this check."
                : "Docker Desktop is not running. Start Docker Desktop and wait until it reports the engine is running, then re-run this check."
        );
    } else if (facts.daemon === true) {
        ok.push("The Docker engine is running.");
    }

    if (!facts.envExists) {
        missing.push(
            "No .env file at the repository root. Copy .env.example to .env, then set BETTER_AUTH_SECRET to the output of `openssl rand -base64 32`."
        );
    } else if (!isRealSecret(facts.env.BETTER_AUTH_SECRET)) {
        missing.push(
            "BETTER_AUTH_SECRET is missing or still the placeholder from .env.example. Generate one with `openssl rand -base64 32` and put it in .env. The app refuses to boot without it, and Compose has no default."
        );
    } else {
        ok.push("BETTER_AUTH_SECRET is set.");
    }

    if (facts.envExists && !facts.env.DATABASE_URL?.trim()) {
        warnings.push(
            "DATABASE_URL is unset. Compose injects its own URL inside containers. Host commands (db:migrate, db:seed, psql) need postgresql://postgres:password@localhost:5433/pdr_ai_v2, which is the line in .env.example."
        );
    } else if (facts.envExists && facts.env.DATABASE_URL?.trim()) {
        ok.push("DATABASE_URL is set for host tools.");
    }

    const chatReady =
        chatPairReady(facts.env.CHAT_BASE_URL, facts.env.CHAT_API_KEY) ||
        hasUsableKey(facts.env.GOOGLE_AI_API_KEY) ||
        chatPairReady(facts.env.AI_BASE_URL, facts.env.AI_API_KEY);

    if (facts.envExists && !chatReady) {
        warnings.push(
            "Chat has no usable credential. The app still boots and defaults to Gemini, and requests fail until you set GOOGLE_AI_API_KEY (https://aistudio.google.com/apikey) or CHAT_BASE_URL plus CHAT_API_KEY. A local Ollama endpoint is CHAT_BASE_URL=http://localhost:11434/v1 with the key left empty. The .env.example value CHAT_API_KEY=AIza... is a placeholder, not a key."
        );
    } else if (chatReady) {
        ok.push("A chat endpoint credential is set.");
    }

    const embeddingReady =
        (Boolean(facts.env.EMBEDDING_API_BASE_URL?.trim()) &&
            hasUsableKey(facts.env.EMBEDDING_API_KEY)) ||
        (Boolean(facts.env.AI_BASE_URL?.trim()) &&
            (hasUsableKey(facts.env.AI_API_KEY) || hasUsableKey(facts.env.OPENAI_API_KEY)));

    if (facts.envExists && !embeddingReady) {
        warnings.push(
            "Embeddings have no endpoint. Search indexing will not run until you set EMBEDDING_API_BASE_URL and EMBEDDING_API_KEY together (or AI_BASE_URL and AI_API_KEY). Embeddings do not fall back to Gemini: vectors are stored, so the provider has to be chosen on purpose. A new database can use EMBEDDING_INDEX=gemini-embedding-768 with Gemini's OpenAI-compatible URL."
        );
    } else if (embeddingReady) {
        ok.push("An embedding endpoint is set.");
    }

    if (facts.envExists && !facts.env.DEV_SEED_PASSWORD?.trim()) {
        warnings.push(
            "DEV_SEED_PASSWORD is unset. Sign-up in the browser still works (the first account becomes the workspace owner). The fixed accounts owner@ / admin@ / member@ / viewer@launchstack.test are created only after this password is set and `docker compose --env-file .env --profile seed run --rm seed` is run."
        );
    } else if (facts.env.DEV_SEED_PASSWORD?.trim() && facts.env.DEV_SEED_PASSWORD.trim().length < 8) {
        warnings.push("DEV_SEED_PASSWORD must be at least 8 characters or the seed script will refuse to run.");
    } else if (facts.env.DEV_SEED_PASSWORD?.trim()) {
        ok.push("DEV_SEED_PASSWORD is set (value not shown).");
    }

    if (facts.nodeMajor == null) {
        warnings.push(
            "Node.js is not on PATH. `make up-prod` does not need it. Hot reload (`pnpm --filter @launchstack/web dev`) needs Node 20 or newer."
        );
    } else if (facts.nodeMajor < 20) {
        warnings.push(
            `Node.js ${facts.nodeMajor} is installed. The app and CI expect Node 20 or newer.`
        );
    } else {
        ok.push(`Node.js ${facts.nodeMajor} is installed.`);
    }

    if (!facts.pnpmVersion) {
        warnings.push(
            "pnpm is not on PATH. Enable it with `corepack enable && corepack prepare pnpm@10.15.1 --activate` before host-side installs. The Compose app image carries its own pnpm."
        );
    } else if (facts.pnpmVersion !== "10.15.1") {
        warnings.push(
            `pnpm ${facts.pnpmVersion} is on PATH. This repo pins pnpm@10.15.1 via the packageManager field. Run \`corepack prepare pnpm@10.15.1 --activate\` before pnpm install.`
        );
    } else {
        ok.push("pnpm 10.15.1 is installed.");
    }

    return { ok, missing, warnings, installUrl };
}

/** @param {string} command @param {string[]} args */
function commandOk(command, args) {
    try {
        execFileSync(command, args, { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

function commandOutput(command, args) {
    try {
        return execFileSync(command, args, { encoding: "utf8" }).trim();
    } catch {
        return null;
    }
}

function collectFacts() {
    const dockerCli = commandOk("docker", ["--version"]);
    const compose = commandOk("docker", ["compose", "version"]);
    const daemon = dockerCli ? commandOk("docker", ["info"]) : null;
    const envPath = join(ROOT, ".env");
    const envExists = existsSync(envPath);
    const env = envExists ? parseEnv(readFileSync(envPath, "utf8")) : {};
    const nodeText = commandOutput("node", ["-p", "process.versions.node"]);
    const nodeMajor = nodeText ? Number(nodeText.split(".")[0]) : null;
    const pnpmText = commandOutput("pnpm", ["-v"]);
    return {
        platform: process.platform,
        dockerCli,
        compose,
        daemon,
        envExists,
        env,
        nodeMajor: Number.isFinite(nodeMajor) ? nodeMajor : null,
        pnpmVersion: pnpmText,
    };
}

function printReport(report) {
    console.log("LaunchStack setup check");
    console.log("");
    if (report.ok.length) {
        console.log("Ready");
        for (const line of report.ok) console.log(`  ok  ${line}`);
        console.log("");
    }
    if (report.warnings.length) {
        console.log("Optional — the app can boot, these features stay dark");
        for (const line of report.warnings) console.log(`  warn  ${line}`);
        console.log("");
    }
    if (report.missing.length) {
        console.log("Blocking — fix these before `make up-prod`");
        for (const line of report.missing) console.log(`  missing  ${line}`);
        console.log("");
        console.log("See docs/developer-onboarding.md for the full setup path.");
        return 1;
    }
    console.log("Next: make up-prod");
    console.log("Windows without make: docker compose --env-file .env up --build -d");
    console.log("App: http://localhost:3000  Worker health: http://localhost:8020/healthz");
    return 0;
}

function main() {
    const code = printReport(assess(collectFacts()));
    process.exit(code);
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entry) main();
