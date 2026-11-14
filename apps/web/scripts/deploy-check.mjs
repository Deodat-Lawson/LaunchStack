#!/usr/bin/env node
/**
 * Deployment preflight for a self-hosted LaunchStack (design:
 * docs/design/self-host-readiness.md, "W1 — Preflight validation").
 *
 * Reads one environment (the process's, or a .env file) and reports every
 * misconfiguration that env.ts cannot see from inside a single container:
 * half-configured pairs, local-only defaults, values that must agree with each
 * other, and (with --probe) components that hold different copies of a secret.
 *
 *   node scripts/deploy-check.mjs [--env-file <path>] [--probe] [--json]
 *
 *   --env-file <path>  check that file instead of process.env
 *   --probe            also run live checks; only meaningful inside the Compose
 *                      network, where db, seaweedfs, app, ... resolve
 *   --json             print { ok, findings: [{ level, code, vars, message, fix }] }
 *
 * Exit codes: 0 no errors (warnings never fail), 1 at least one error,
 * 2 bad command line.
 *
 * Node 20.6+ itself also honours --env-file wherever it appears on the command
 * line: it loads the same file into process.env (harmless: only the parsed file
 * is checked) and, if the file does not exist, exits 9 with "not found" before
 * this script starts.
 *
 * Plain ESM with no dependencies for the static checks, like
 * packages/store/scripts/migrate.mjs, so it runs in the light `migrate` image.
 * --probe additionally loads `postgres`, the driver that image already carries
 * for the migration runner. No finding ever contains a secret's value: only the
 * variable name and, where it matters, its length.
 *
 * Every rule cites the code or Compose behaviour it mirrors. Do not add a rule
 * that does not.
 */

import { createHash, createHmac } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ── Facts mirrored from the application ──────────────────────────────

/** packages/llm/src/types.ts: GEMINI_BASE_URL — its host identifies a Gemini endpoint. */
const GEMINI_HOST = "generativelanguage.googleapis.com";
const OPENAI_HOST = "api.openai.com";

/**
 * packages/llm/src/embeddings/index-registry.ts. For the two built-in indexes
 * the request's model and dimension come from the index, never from
 * EMBEDDING_MODEL (factory.ts createEmbeddingModel passes index.model).
 */
const STATIC_EMBEDDING_INDEXES = {
    "legacy-openai-1536": { model: "text-embedding-3-large", dimension: 1536 },
    "gemini-embedding-768": { model: "gemini-embedding-001", dimension: 768 },
};
/** index-registry.ts LEGACY_OPENAI_INDEX is the fallback when EMBEDDING_INDEX is unset. */
const DEFAULT_EMBEDDING_INDEX = "legacy-openai-1536";
/** index-registry.ts isSupportedDimensionTableDimension. */
const DIMENSION_TABLE_DIMENSIONS = [768, 1024];
/** apps/web/src/server/notes/embedding-config.ts DEFAULT_EMBEDDING_MODEL. */
const NOTES_DEFAULT_EMBEDDING_MODEL = "text-embedding-3-large";

/** apps/web/src/env.ts AUTH_SECRET_MIN_LENGTH and AUTH_SECRET_PLACEHOLDER. */
const AUTH_SECRET_MIN_LENGTH = 32;
const AUTH_SECRET_PLACEHOLDER = "BETTER_AUTH_SECRET";
/**
 * Floor for the other generated secrets. The installer contract asks for a
 * length floor; 16 is the floor the app itself enforces on an HMAC secret it
 * validates (EMAIL_UNSUBSCRIBE_SECRET, see env.ts), and every generator the
 * repo documents (openssl rand -hex 32, -base64 32) clears it several times over.
 */
const SECRET_MIN_LENGTH = 16;
/** packages/store/src/crypto/secret-box.ts: the key must base64-decode to 32 bytes. */
const SECRETS_KEY_BYTES = 32;

/** packages/tools/src/web-research: SEARCH_PROVIDER_IDS order and each provider's `credential`. */
const SEARCH_CREDENTIALS = {
    exa: "EXA_API_KEY",
    serper: "SERPER_API_KEY",
    brave: "BRAVE_SEARCH_API_KEY",
    tavily: "TAVILY_API_KEY",
    searxng: "SEARXNG_URL",
};
/** web-research/setup.ts RETIRED_SETTINGS: accepted by env.ts, treated as unset. */
const RETIRED_SEARCH_SETTINGS = ["fallback", "parallel"];
/** env.ts OCR_DEFAULT_PROVIDER enum. */
const OCR_PROVIDERS = ["DOCLING", "NATIVE_PDF", "AZURE", "LANDING_AI", "DATALAB"];

/** Profiles the self-host Compose file defines (installer contract, "Compose"). */
const KNOWN_PROFILES = ["domain", "ocr", "whisper", "search"];

/**
 * Secrets the stack cannot run without, and what stops working. Each one is
 * interpolated by Compose into at least two containers (docker-compose.yml
 * x-shared-env and the service that verifies it), so an empty value either
 * fails `${VAR:?}` in deploy/compose.yml or falls back to a public default.
 */
const REQUIRED_SECRETS = [
    ["POSTGRES_PASSWORD", "the database, and with it every other service, cannot start"],
    ["BETTER_AUTH_SECRET", "the app refuses to boot (env.ts), so nobody can sign in"],
    [
        "FILE_ACCESS_TOKEN_SECRET",
        "the document converter cannot read uploaded files, so ingestion fails",
    ],
    [
        "EMBEDDING_SECRETS_KEY",
        "workspace API keys and connector grants (Drive, Slack, Notion) cannot be stored",
    ],
    ["S3_ACCESS_KEY", "uploads and file previews fail (object storage rejects the app)"],
    ["S3_SECRET_KEY", "uploads and file previews fail (object storage rejects the app)"],
    ["ADEU_SERVICE_API_KEY", "Word document editing returns 401"],
    ["DOCUMENT_CONVERTER_API_KEY", "PDF and Office ingestion returns 401"],
    ["GOTENBERG_SERVICE_PASSWORD", "PDF export and Office previews return 401"],
    // Their containers run only under the whisper / search profiles, but
    // deploy/compose.yml declares both `${VAR:?}` and Compose interpolates every
    // service, active or not: without them `docker compose up` refuses to run.
    [
        "TRANSCRIPTION_SERVICE_API_KEY",
        "Compose refuses to start the stack (and self-hosted transcription would reject every recording)",
    ],
    [
        "SEARXNG_SECRET",
        "Compose refuses to start the stack (and the bundled SearXNG would have no cookie secret)",
    ],
];

/** A value that names a secret: used for the default check and for redaction. */
const SECRET_NAME = /(SECRET|PASSWORD|TOKEN|_KEY)$/;
/** Public by design (docker-compose.yml: "Public by design; the app serves them to the browser"). */
const NOT_SECRET = new Set(["NEXT_PUBLIC_GOOGLE_API_KEY"]);

/**
 * Local-only defaults. `pdr_local_*` and `password` are what docker-compose.yml
 * substitutes so `make up` works with no .env; the rest are the placeholders
 * people type instead of generating a value.
 */
const INSECURE_VALUES = new Set(["password", "changeme", "change-me", "change_me", "secret"]);
function isInsecureDefault(name, value) {
    const lower = value.toLowerCase();
    if (lower.startsWith("pdr_local_")) return true;
    if (INSECURE_VALUES.has(lower)) return true;
    // env.ts: the literal .env.example once shipped for this variable.
    return name === "BETTER_AUTH_SECRET" && value === AUTH_SECRET_PLACEHOLDER;
}

// ── Small helpers ────────────────────────────────────────────────────

/** env.ts `normalize`: a blank value is unset. */
function get(env, name) {
    const value = env[name];
    if (typeof value !== "string") return undefined;
    const text = value.trim();
    return text.length > 0 ? text : undefined;
}

function parseUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
    } catch {
        return undefined;
    }
}

/** Host of a URL-valued variable, for messages: never the path, query or userinfo. */
function hostOf(value) {
    return parseUrl(value ?? "")?.hostname.toLowerCase();
}

function profilesOf(env) {
    return (get(env, "COMPOSE_PROFILES") ?? "")
        .split(",")
        .map(p => p.trim())
        .filter(Boolean);
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function finding(level, code, vars, message, fix) {
    return { level, code, vars: [].concat(vars), message, fix };
}
const error = (code, vars, message, fix) => finding("error", code, vars, message, fix);
const warn = (code, vars, message, fix) => finding("warn", code, vars, message, fix);

/**
 * Last line of defence for "never print a secret": strip any secret value that
 * reached a finding through text this script did not write (a driver error, a
 * response body). The checks themselves never interpolate one.
 */
function redact(findings, env) {
    const secrets = Object.entries(env)
        .filter(
            ([name, value]) =>
                SECRET_NAME.test(name) &&
                !NOT_SECRET.has(name) &&
                typeof value === "string" &&
                value.trim().length >= 8 &&
                !isInsecureDefault(name, value.trim())
        )
        .map(([, value]) => value.trim());
    if (secrets.length === 0) return findings;
    const scrub = text =>
        secrets.reduce((out, secret) => out.split(secret).join("[redacted]"), text);
    return findings.map(f => ({ ...f, message: scrub(f.message), fix: scrub(f.fix) }));
}

// ── Static checks ────────────────────────────────────────────────────

function checkRequiredSecrets(env, out) {
    for (const [name, consequence] of REQUIRED_SECRETS) {
        if (!get(env, name)) {
            out.push(
                error(
                    "REQUIRED_MISSING",
                    name,
                    `${name} is not set: ${consequence}.`,
                    name === "EMBEDDING_SECRETS_KEY"
                        ? `Generate it: openssl rand -base64 32`
                        : `Generate it: openssl rand -hex 32`
                )
            );
        }
    }
    if (!get(env, "BETTER_AUTH_URL")) {
        out.push(
            error(
                "REQUIRED_MISSING",
                "BETTER_AUTH_URL",
                "BETTER_AUTH_URL is not set: every link, invitation and OAuth redirect is built on it (server/public-origin.ts).",
                "Set it to the address people open: https://<DOMAIN>, or http://localhost:<LAUNCHSTACK_HTTP_PORT>."
            )
        );
    }
}

function checkSecretQuality(env, out) {
    const generated = new Set([
        ...REQUIRED_SECRETS.map(([name]) => name),
        "INNGEST_EVENT_KEY",
        "INNGEST_SIGNING_KEY",
    ]);

    for (const name of Object.keys(env).sort()) {
        const value = get(env, name);
        if (!value || !SECRET_NAME.test(name) || NOT_SECRET.has(name)) continue;

        if (isInsecureDefault(name, value)) {
            out.push(
                error(
                    "INSECURE_DEFAULT",
                    name,
                    `${name} is still a local development default (${value.length} characters, published in the repository). Anyone can use it against this deployment.`,
                    "Replace it with a generated value: openssl rand -hex 32"
                )
            );
            continue;
        }

        if (!generated.has(name)) continue;
        const floor = name === "BETTER_AUTH_SECRET" ? AUTH_SECRET_MIN_LENGTH : SECRET_MIN_LENGTH;
        if (value.length < floor) {
            out.push(
                error(
                    "SECRET_TOO_SHORT",
                    name,
                    `${name} is ${value.length} characters; at least ${floor} are required${
                        name === "BETTER_AUTH_SECRET" ? " (the app refuses to boot below that)" : ""
                    }.`,
                    "Generate a longer one: openssl rand -hex 32"
                )
            );
        }
    }

    // docker-compose.yml builds DATABASE_URL (and Inngest's INNGEST_POSTGRES_URI)
    // by pasting the password into a URL: postgresql://postgres:${POSTGRES_PASSWORD}@db.
    const dbPassword = get(env, "POSTGRES_PASSWORD");
    if (dbPassword && !/^[A-Za-z0-9._~-]+$/.test(dbPassword)) {
        out.push(
            error(
                "POSTGRES_PASSWORD_URL_UNSAFE",
                "POSTGRES_PASSWORD",
                "POSTGRES_PASSWORD contains a character that is not safe inside a URL. Compose pastes it into DATABASE_URL unescaped, so the app, worker and Inngest would connect with a different password than the database has.",
                "Use only letters, digits and - . _ ~ (openssl rand -hex 32 does). To change the password of an existing database, also run ALTER USER postgres PASSWORD ... inside it."
            )
        );
    }

    // secret-box.ts resolveKey: Buffer.from(raw, "base64") must be 32 bytes.
    const secretsKey = get(env, "EMBEDDING_SECRETS_KEY");
    if (secretsKey && !isInsecureDefault("EMBEDDING_SECRETS_KEY", secretsKey)) {
        const bytes = Buffer.from(secretsKey, "base64").length;
        if (bytes !== SECRETS_KEY_BYTES) {
            out.push(
                error(
                    "SECRETS_KEY_INVALID",
                    "EMBEDDING_SECRETS_KEY",
                    `EMBEDDING_SECRETS_KEY decodes to ${bytes} bytes; it must be base64 for exactly ${SECRETS_KEY_BYTES}. Saving a workspace API key or a connector grant would fail.`,
                    "Generate it: openssl rand -base64 32 (keep it constant afterwards: it decrypts stored credentials)."
                )
            );
        }
    }
}

/**
 * Halves that are read together. `needs` is the half that makes `has` usable.
 * Sources: packages/llm/src/providers/registry.ts resolveEndpoint (a capability
 * key is only sent to a URL the operator named), apps/web/src/server/engine.ts
 * (the embeddings override is taken only when its base URL is set),
 * services/document-converter/src/providers.ts (Azure needs endpoint and key),
 * apps/web/src/server/auth/providers.ts `both()` (id and secret).
 */
function checkPairs(env, out) {
    const has = name => Boolean(get(env, name));
    const incomplete = (present, missing, consequence, fix) =>
        out.push(
            error(
                "PAIR_INCOMPLETE",
                [missing, present],
                `${missing} is missing: ${present} is set without it, so ${consequence}.`,
                fix ?? `Set ${missing}, or remove ${present}.`
            )
        );

    if (has("CHAT_API_KEY") && !has("CHAT_BASE_URL")) {
        incomplete(
            "CHAT_API_KEY",
            "CHAT_BASE_URL",
            "the key is never sent anywhere (chat-endpoint.ts pairs it only with CHAT_BASE_URL)",
            "Set CHAT_BASE_URL to the provider's OpenAI-compatible URL, or use GOOGLE_AI_API_KEY for Gemini."
        );
    }

    if (has("EMBEDDING_API_KEY") && !has("EMBEDDING_API_BASE_URL")) {
        incomplete(
            "EMBEDDING_API_KEY",
            "EMBEDDING_API_BASE_URL",
            'the key is ignored and document indexing fails with "API key not configured"',
            `Set EMBEDDING_API_BASE_URL (Gemini: https://${GEMINI_HOST}/v1beta/openai).`
        );
    }
    if (has("EMBEDDING_API_BASE_URL") && !has("EMBEDDING_API_KEY")) {
        incomplete(
            "EMBEDDING_API_BASE_URL",
            "EMBEDDING_API_KEY",
            'indexing fails with "API key not configured for embeddings" (embeddings.ts) the first time a document is uploaded'
        );
    }

    // AI_API_KEY names who you are, not where the request goes (registry.ts).
    if (has("AI_API_KEY") && !has("AI_BASE_URL")) {
        incomplete("AI_API_KEY", "AI_BASE_URL", "the key is never sent anywhere");
    }
    for (const capability of ["RERANK", "NER", "TRANSCRIPTION"]) {
        const key = `${capability}_API_KEY`;
        const url = `${capability}_API_BASE_URL`;
        if (has(key) && !has(url) && !has("AI_BASE_URL")) {
            incomplete(
                key,
                url,
                "the key is never sent anywhere (requests fall back to Gemini without it)"
            );
        }
    }

    const mutual = [
        ["AZURE_DOC_INTELLIGENCE_ENDPOINT", "AZURE_DOC_INTELLIGENCE_KEY", "Azure OCR stays off"],
        ["AUTH_GOOGLE_CLIENT_ID", "AUTH_GOOGLE_CLIENT_SECRET", "Sign in with Google stays off"],
        ["AUTH_GITHUB_CLIENT_ID", "AUTH_GITHUB_CLIENT_SECRET", "Sign in with GitHub stays off"],
        [
            "AUTH_MICROSOFT_CLIENT_ID",
            "AUTH_MICROSOFT_CLIENT_SECRET",
            "Sign in with Microsoft stays off",
        ],
        ["AUTH_OIDC_CLIENT_ID", "AUTH_OIDC_CLIENT_SECRET", "single sign-on stays off"],
    ];
    for (const [a, b, consequence] of mutual) {
        if (has(a) && !has(b)) incomplete(a, b, consequence);
        if (has(b) && !has(a)) incomplete(b, a, consequence);
    }
}

/**
 * DOMAIN, BETTER_AUTH_URL and COMPOSE_PROFILES describe one decision (installer
 * contract, "Two access modes"): a domain behind Caddy with HTTPS, or plain
 * HTTP on a local port.
 */
function checkAccess(env, out) {
    const domain = get(env, "DOMAIN");
    const urlText = get(env, "BETTER_AUTH_URL");
    const profiles = profilesOf(env);
    const url = urlText ? parseUrl(urlText) : undefined;

    if (urlText && !url) {
        out.push(
            error(
                "URL_INVALID",
                "BETTER_AUTH_URL",
                "BETTER_AUTH_URL is not an http(s) URL, so links, invitations and OAuth redirects would be malformed.",
                "Write it with its scheme: https://<DOMAIN> or http://localhost:<port>."
            )
        );
    }

    if (domain) {
        // Caddy serves ${DOMAIN} and files.${DOMAIN} (docker/Caddyfile.prod), so it
        // must be a bare hostname.
        if (
            !/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i.test(domain)
        ) {
            out.push(
                error(
                    "DOMAIN_INVALID",
                    "DOMAIN",
                    "DOMAIN must be a bare hostname such as docs.example.com: no scheme, port or path. Caddy requests certificates for it and for files.<DOMAIN>.",
                    "Remove https:// and anything after the hostname."
                )
            );
        } else if (
            url &&
            (url.protocol !== "https:" ||
                url.hostname.toLowerCase() !== domain.toLowerCase() ||
                url.port !== "" ||
                url.pathname !== "/")
        ) {
            out.push(
                error(
                    "URL_DOMAIN_MISMATCH",
                    ["BETTER_AUTH_URL", "DOMAIN"],
                    `BETTER_AUTH_URL (${url.protocol}//${url.host}) and DOMAIN (${domain}) disagree: Caddy serves the app only at https://${domain}, so sign-in cookies and OAuth redirects would target an address that does not answer.`,
                    `Set BETTER_AUTH_URL=https://${domain}`
                )
            );
        }
        if (!profiles.includes("domain")) {
            out.push(
                error(
                    "DOMAIN_PROFILE_MISMATCH",
                    ["COMPOSE_PROFILES", "DOMAIN"],
                    'DOMAIN is set but COMPOSE_PROFILES does not include "domain": Caddy would not start, and nothing publishes ports 80/443.',
                    "Add domain to COMPOSE_PROFILES (comma-separated)."
                )
            );
        }
        if (!get(env, "ACME_EMAIL")) {
            out.push(
                warn(
                    "ACME_EMAIL_MISSING",
                    "ACME_EMAIL",
                    "ACME_EMAIL is not set: certificates are still issued, but you will not be warned before one fails to renew.",
                    "Set ACME_EMAIL to an address you read."
                )
            );
        }
        return;
    }

    // Local mode.
    if (profiles.includes("domain")) {
        out.push(
            error(
                "DOMAIN_PROFILE_MISMATCH",
                ["COMPOSE_PROFILES", "DOMAIN"],
                'COMPOSE_PROFILES includes "domain" but DOMAIN is empty: Caddy would start with no site to serve and take ports 80/443.',
                "Set DOMAIN, or remove domain from COMPOSE_PROFILES."
            )
        );
    }
    if (!url) return;

    if (url.protocol === "https:") {
        out.push(
            warn(
                "URL_LOCAL_HTTPS",
                ["BETTER_AUTH_URL", "DOMAIN"],
                "BETTER_AUTH_URL is https but DOMAIN is empty, so this stack serves plain HTTP only. That works only if your own reverse proxy terminates TLS in front of it.",
                `Set DOMAIN=${url.hostname} and add domain to COMPOSE_PROFILES to let the bundled Caddy do it.`
            )
        );
        return;
    }

    const port = get(env, "LAUNCHSTACK_HTTP_PORT") ?? "3000";
    const urlPort = url.port || "80";
    if (urlPort !== port) {
        out.push(
            error(
                "URL_PORT_MISMATCH",
                ["BETTER_AUTH_URL", "LAUNCHSTACK_HTTP_PORT"],
                `BETTER_AUTH_URL uses port ${urlPort} but the app is published on LAUNCHSTACK_HTTP_PORT=${port}: sign-in redirects would go to a port nothing listens on.`,
                `Set BETTER_AUTH_URL=http://${url.hostname}:${port}`
            )
        );
    }

    // deploy/compose.yml publishes the app and object storage on the same bind
    // address, one port each.
    const filesPort = get(env, "LAUNCHSTACK_FILES_PORT") ?? "8333";
    if (filesPort === port) {
        out.push(
            error(
                "PORT_CONFLICT",
                ["LAUNCHSTACK_FILES_PORT", "LAUNCHSTACK_HTTP_PORT"],
                `LAUNCHSTACK_HTTP_PORT and LAUNCHSTACK_FILES_PORT are both ${port}: the app and object storage cannot publish the same port, so one of them fails to start.`,
                "Give them different ports (the defaults are 3000 and 8333)."
            )
        );
    }

    const bind = get(env, "LAUNCHSTACK_BIND") ?? "127.0.0.1";
    if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
        if (LOOPBACK_HOSTS.has(bind)) {
            out.push(
                error(
                    "URL_HOST_NOT_BOUND",
                    ["BETTER_AUTH_URL", "LAUNCHSTACK_BIND"],
                    `BETTER_AUTH_URL points at ${url.hostname} but the app listens only on ${bind}, so that address cannot reach it.`,
                    `Use http://localhost:${port}, or set LAUNCHSTACK_BIND=0.0.0.0 to serve other machines.`
                )
            );
        } else {
            // env.ts (MCP_SERVER_ENABLED): the assistant connector is off unless
            // BETTER_AUTH_URL is HTTPS or loopback.
            out.push(
                warn(
                    "INSECURE_HTTP",
                    "BETTER_AUTH_URL",
                    `The app is served to other machines over plain HTTP (${url.hostname}): passwords and sessions cross the network unencrypted, and connecting Claude or ChatGPT to the workspace is disabled.`,
                    "Use a domain (DOMAIN + the domain profile) for anything beyond a trusted LAN."
                )
            );
            // deploy/compose.yml: stored files are served from
            // http://files.localhost:<port> unless LAUNCHSTACK_FILES_URL says
            // otherwise, and *.localhost is always the viewer's own machine.
            if (!get(env, "LAUNCHSTACK_FILES_URL")) {
                out.push(
                    warn(
                        "FILES_URL_LOCAL_ONLY",
                        ["LAUNCHSTACK_FILES_URL", "BETTER_AUTH_URL"],
                        `People open the app at ${url.hostname}, but stored files are linked as http://files.localhost:${filesPort}, which only resolves on this machine: on other computers previews and downloads fail.`,
                        `Set LAUNCHSTACK_FILES_URL=http://${url.hostname}:${filesPort}`
                    )
                );
            }
        }
    }
}

/** apps/web/src/server/chat-endpoint.ts resolveChatEndpoint / isChatEndpointConfigured. */
function checkChat(env, out) {
    const baseUrl = get(env, "CHAT_BASE_URL");
    if (baseUrl) {
        if (!parseUrl(baseUrl)) {
            out.push(
                error(
                    "URL_INVALID",
                    "CHAT_BASE_URL",
                    "CHAT_BASE_URL is not an http(s) URL, so every chat request fails.",
                    "Use the provider's OpenAI-compatible base URL, for example https://openrouter.ai/api/v1."
                )
            );
        } else if (!get(env, "CHAT_API_KEY")) {
            out.push(
                warn(
                    "CHAT_KEY_MISSING",
                    ["CHAT_API_KEY", "CHAT_BASE_URL"],
                    `CHAT_API_KEY is not set, so chat requests to ${hostOf(baseUrl)} carry no credential. Fine for a local model server; a hosted provider will answer 401.`,
                    "Set CHAT_API_KEY unless the endpoint needs none."
                )
            );
        }
        return;
    }
    if (get(env, "AI_BASE_URL")) {
        out.push(
            warn(
                "CHAT_LEGACY_ALIAS",
                ["AI_BASE_URL", "CHAT_BASE_URL"],
                "Chat is configured through AI_BASE_URL/AI_API_KEY, a deprecated alias that will be removed next release.",
                "Rename them to CHAT_BASE_URL and CHAT_API_KEY."
            )
        );
        return;
    }
    if (get(env, "GOOGLE_AI_API_KEY")) return; // the built-in Gemini default

    const strays = ["OPENAI_API_KEY", "OPENROUTER_API_KEY"].filter(name => get(env, name));
    out.push(
        error(
            "CHAT_NOT_CONFIGURED",
            ["GOOGLE_AI_API_KEY", "CHAT_BASE_URL", "CHAT_API_KEY"],
            "No chat model is configured: chat falls back to Gemini with no key, so every question is rejected as unauthenticated." +
                (strays.length
                    ? ` ${strays.join(" and ")} is set but names no endpoint, so it is not used.`
                    : ""),
            "Set GOOGLE_AI_API_KEY (Gemini), or CHAT_BASE_URL + CHAT_API_KEY for any OpenAI-compatible provider."
        )
    );
}

/**
 * Embeddings have no default endpoint (embeddings.ts, engine.ts): the
 * embeddings pair first, then the shared AI_BASE_URL pair, else nothing.
 */
function checkEmbeddings(env, out) {
    const index = get(env, "EMBEDDING_INDEX") ?? DEFAULT_EMBEDDING_INDEX;
    const dimensionOk = name => DIMENSION_TABLE_DIMENSIONS.includes(Number(get(env, name)));

    // Dynamic indexes exist only while their provider variables do
    // (index-registry.ts buildDynamicIndexes, engine.ts buildConfig).
    if (index === "ollama-default" || index === "huggingface-default") {
        const needs =
            index === "ollama-default"
                ? ["OLLAMA_BASE_URL", "OLLAMA_EMBEDDING_DIMENSION"]
                : [
                      "HUGGINGFACE_API_KEY",
                      "HUGGINGFACE_EMBEDDING_MODEL",
                      "HUGGINGFACE_EMBEDDING_DIMENSION",
                  ];
        const missing = needs.filter(name => !get(env, name));
        if (
            index === "ollama-default" &&
            !get(env, "OLLAMA_EMBEDDING_MODEL") &&
            !get(env, "OLLAMA_MODEL")
        ) {
            missing.push("OLLAMA_EMBEDDING_MODEL");
        }
        const dimensionVar =
            index === "ollama-default"
                ? "OLLAMA_EMBEDDING_DIMENSION"
                : "HUGGINGFACE_EMBEDDING_DIMENSION";
        if (missing.length > 0 || !dimensionOk(dimensionVar)) {
            out.push(
                error(
                    "EMBEDDING_INDEX_UNKNOWN",
                    ["EMBEDDING_INDEX", ...(missing.length ? missing : [dimensionVar])],
                    missing.length
                        ? `EMBEDDING_INDEX=${index} is only registered when ${needs.join(", ")} are set; ${missing.join(", ")} is missing, so uploads fail with "index is not registered".`
                        : `EMBEDDING_INDEX=${index} needs ${dimensionVar} to be 768 or 1024 (the only vector widths the store has tables for).`,
                    "Set the missing variable(s), or pick a built-in index: gemini-embedding-768 or legacy-openai-1536."
                )
            );
        }
        return;
    }

    const spec = STATIC_EMBEDDING_INDEXES[index];
    if (!spec) {
        out.push(
            error(
                "EMBEDDING_INDEX_UNKNOWN",
                "EMBEDDING_INDEX",
                `EMBEDDING_INDEX=${index} is not a registered index, so every upload and search fails with "index is not registered or not enabled".`,
                "Use gemini-embedding-768 (Gemini), legacy-openai-1536 (OpenAI text-embedding-3-large), ollama-default or huggingface-default."
            )
        );
        return;
    }

    const ownUrl = get(env, "EMBEDDING_API_BASE_URL");
    const sharedUrl = get(env, "AI_BASE_URL");
    const endpoint = ownUrl ?? sharedUrl;
    if (!endpoint) {
        // A lone EMBEDDING_API_KEY is reported by checkPairs, naming the URL.
        if (!get(env, "EMBEDDING_API_KEY")) {
            out.push(
                error(
                    "EMBEDDINGS_NOT_CONFIGURED",
                    ["EMBEDDING_API_BASE_URL", "EMBEDDING_API_KEY"],
                    "No embeddings endpoint is configured. Unlike chat there is no default, so uploaded documents would never become searchable.",
                    `Set EMBEDDING_API_BASE_URL and EMBEDDING_API_KEY. With a Gemini key: EMBEDDING_API_BASE_URL=https://${GEMINI_HOST}/v1beta/openai, EMBEDDING_MODEL=gemini-embedding-001, EMBEDDING_INDEX=gemini-embedding-768.`
                )
            );
        }
        return;
    }
    if (!parseUrl(endpoint)) {
        out.push(
            error(
                "URL_INVALID",
                ownUrl ? "EMBEDDING_API_BASE_URL" : "AI_BASE_URL",
                `${ownUrl ? "EMBEDDING_API_BASE_URL" : "AI_BASE_URL"} is not an http(s) URL, so document indexing fails.`,
                "Use the provider's OpenAI-compatible base URL."
            )
        );
        return;
    }
    if (!ownUrl && !get(env, "AI_API_KEY") && !get(env, "OPENAI_API_KEY")) {
        out.push(
            error(
                "EMBEDDINGS_NOT_CONFIGURED",
                ["EMBEDDING_API_KEY", "AI_API_KEY"],
                'Embeddings fall back to AI_BASE_URL, but no AI_API_KEY accompanies it, so indexing fails with "API key not configured".',
                "Set EMBEDDING_API_BASE_URL + EMBEDDING_API_KEY (preferred), or AI_API_KEY."
            )
        );
    }

    // The index decides the model on the wire. A vendor that does not serve
    // that model rejects every request (notes/embedding-config.ts: "the OpenAI
    // default 404s on Gemini").
    const host = hostOf(endpoint);
    const urlVar = ownUrl ? "EMBEDDING_API_BASE_URL" : "AI_BASE_URL";
    const wrongVendor =
        (host === GEMINI_HOST && index !== "gemini-embedding-768") ||
        (host === OPENAI_HOST && index !== "legacy-openai-1536");
    if (wrongVendor) {
        const right = host === GEMINI_HOST ? "gemini-embedding-768" : "legacy-openai-1536";
        out.push(
            error(
                "EMBEDDING_INDEX_MISMATCH",
                ["EMBEDDING_INDEX", urlVar],
                `EMBEDDING_INDEX=${index} asks ${host} for the model ${spec.model}, which that provider does not serve. Every upload would fail at the indexing step.`,
                `Set EMBEDDING_INDEX=${right} (and EMBEDDING_MODEL=${STATIC_EMBEDDING_INDEXES[right].model}). On an existing install, changing the index requires re-embedding every document.`
            )
        );
        return;
    }

    // Notes are the one place EMBEDDING_MODEL is read (notes/embedding-config.ts),
    // defaulting to the OpenAI model.
    const model = get(env, "EMBEDDING_MODEL") ?? NOTES_DEFAULT_EMBEDDING_MODEL;
    if (ownUrl && model !== spec.model) {
        out.push(
            warn(
                "EMBEDDING_MODEL_MISMATCH",
                ["EMBEDDING_MODEL", "EMBEDDING_INDEX"],
                `Documents are embedded with ${spec.model} (chosen by EMBEDDING_INDEX=${index}), but notes would use ${model}${
                    get(env, "EMBEDDING_MODEL")
                        ? ""
                        : " (the default when EMBEDDING_MODEL is unset)"
                }. If ${host} does not serve both, note search silently returns nothing.`,
                `Set EMBEDDING_MODEL=${spec.model}`
            )
        );
    }
}

/**
 * Self-hosted Inngest runs signed (docker-compose.prod.yml `inngest`): the
 * server takes events only with INNGEST_EVENT_KEY and signs calls to the worker
 * with INNGEST_SIGNING_KEY, both `${VAR:?}` there. `inngest start` documents its
 * signing key as "hex string with even number of chars"; the installer contract
 * holds the event key to the same shape (both come from openssl rand -hex 32).
 */
function checkInngest(env, out) {
    for (const name of ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"]) {
        const value = get(env, name);
        if (!value) {
            const other =
                name === "INNGEST_EVENT_KEY" ? "INNGEST_SIGNING_KEY" : "INNGEST_EVENT_KEY";
            out.push(
                error(
                    "INNGEST_KEY_MISSING",
                    name,
                    get(env, other)
                        ? `${name} is missing although ${other} is set: background jobs (Drive and Gmail sync, scheduled work, Prospects and Proposals runs) are ${
                              name === "INNGEST_SIGNING_KEY"
                                  ? "accepted and then never run"
                                  : "rejected by the job server"
                          }.`
                        : `${name} is not set: the job server will not start, so background jobs (Drive and Gmail sync, scheduled work, Prospects and Proposals runs) never run.`,
                    "Generate it: openssl rand -hex 32"
                )
            );
            continue;
        }
        // The SDK strips an optional signkey-<env>- prefix before using the hex.
        const hex = name === "INNGEST_SIGNING_KEY" ? value.replace(/^signkey-[a-z]+-/, "") : value;
        if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
            out.push(
                error(
                    "INNGEST_KEY_NOT_HEX",
                    name,
                    `${name} (${value.length} characters) is not an even-length hexadecimal string. ${
                        name === "INNGEST_SIGNING_KEY"
                            ? "The self-hosted Inngest server requires that shape and would refuse to start, so no background job runs."
                            : "The installer generates it as hex; a hand-typed value here usually means the two keys were swapped or truncated."
                    }`,
                    "Generate it: openssl rand -hex 32"
                )
            );
        }
    }
}

function checkEnums(env, out) {
    const enums = [
        // env.ts SEARCH_PROVIDER (lower-cased before validation)
        [
            "SEARCH_PROVIDER",
            [...Object.keys(SEARCH_CREDENTIALS), ...RETIRED_SEARCH_SETTINGS],
            v => v.toLowerCase(),
        ],
        ["OCR_DEFAULT_PROVIDER", OCR_PROVIDERS, v => v],
        ["TRANSCRIPTION_PROVIDER", ["cloud", "sidecar"], v => v],
        ["DEPLOYMENT_MODE", ["self-hosted", "cloud"], v => v],
    ];
    for (const [name, allowed, normalise] of enums) {
        const value = get(env, name);
        if (value && !allowed.includes(normalise(value))) {
            out.push(
                error(
                    "ENUM_INVALID",
                    name,
                    `${name} has a value the app does not recognise, so it refuses to boot (env.ts).`,
                    `Use one of: ${allowed.filter(v => !RETIRED_SEARCH_SETTINGS.includes(v)).join(", ")}; or leave it empty.`
                )
            );
        }
    }
}

/** Optional services: what is switched on must be reachable, and what is off costs a feature. */
function checkOptional(env, out) {
    const profiles = profilesOf(env);
    const has = name => Boolean(get(env, name));

    const unknown = profiles.filter(p => !KNOWN_PROFILES.includes(p));
    if (unknown.length > 0) {
        out.push(
            warn(
                "PROFILE_UNKNOWN",
                "COMPOSE_PROFILES",
                `COMPOSE_PROFILES names ${unknown.join(", ")}, which the self-host stack does not define; Compose ignores it silently.`,
                `Use a comma-separated list of: ${KNOWN_PROFILES.join(", ")}.`
            )
        );
    }

    // Web search (packages/tools/src/web-research/setup.ts resolveSearchSetup).
    const requested = get(env, "SEARCH_PROVIDER")?.toLowerCase();
    const named = requested && requested in SEARCH_CREDENTIALS ? requested : undefined;
    const searxngHost = hostOf(get(env, "SEARXNG_URL"));
    if (named && !has(SEARCH_CREDENTIALS[named])) {
        out.push(
            warn(
                "WEB_SEARCH_OFF",
                ["SEARCH_PROVIDER", SEARCH_CREDENTIALS[named]],
                `SEARCH_PROVIDER=${named} needs ${SEARCH_CREDENTIALS[named]}, which is not set. Web search is off: chat cannot look anything up online and Prospects cannot find companies.`,
                named === "searxng"
                    ? "Set SEARXNG_URL=http://searxng:8080 and add search to COMPOSE_PROFILES."
                    : `Set ${SEARCH_CREDENTIALS[named]}.`
            )
        );
    } else if (!named && !Object.values(SEARCH_CREDENTIALS).some(has)) {
        out.push(
            warn(
                "WEB_SEARCH_OFF",
                ["SEARCH_PROVIDER", "SEARXNG_URL"],
                "No web search engine is configured: chat answers only from your documents, and Prospects cannot find companies.",
                "Free and self-hosted: add search to COMPOSE_PROFILES, SEARCH_PROVIDER=searxng, SEARXNG_URL=http://searxng:8080. Or set EXA_API_KEY."
            )
        );
    }
    // The bundled SearXNG is the Compose service `searxng`, started only by the
    // `search` profile (docker-compose.yml).
    const usesBundledSearxng =
        searxngHost === "searxng" &&
        (named === "searxng" ||
            (!named &&
                !["EXA_API_KEY", "SERPER_API_KEY", "BRAVE_SEARCH_API_KEY", "TAVILY_API_KEY"].some(
                    has
                )));
    if (usesBundledSearxng && !profiles.includes("search")) {
        out.push(
            warn(
                "PROFILE_SEARCH_MISMATCH",
                ["COMPOSE_PROFILES", "SEARXNG_URL"],
                'Web search points at the bundled SearXNG (SEARXNG_URL), but COMPOSE_PROFILES does not include "search", so that container never starts and every search fails.',
                "Add search to COMPOSE_PROFILES."
            )
        );
    }
    if (profiles.includes("search") && !has("SEARXNG_URL")) {
        out.push(
            warn(
                "PROFILE_SEARCH_MISMATCH",
                ["SEARXNG_URL", "COMPOSE_PROFILES"],
                "The search profile starts SearXNG, but SEARXNG_URL is empty, so the app never uses it.",
                "Set SEARXNG_URL=http://searxng:8080 (and SEARCH_PROVIDER=searxng)."
            )
        );
    }

    // OCR (services/document-converter/src/providers.ts OCR_PROVIDER_ORDER).
    const ocrEngines = [
        has("AZURE_DOC_INTELLIGENCE_ENDPOINT") && has("AZURE_DOC_INTELLIGENCE_KEY"),
        profiles.includes("ocr") && has("DOCLING_SERVE_URL"),
        has("LANDING_AI_API_KEY"),
        has("DATALAB_API_KEY"),
    ];
    if (!ocrEngines.some(Boolean)) {
        out.push(
            warn(
                "OCR_OFF",
                ["COMPOSE_PROFILES", "AZURE_DOC_INTELLIGENCE_KEY"],
                "No OCR engine is configured: scanned PDFs and images are stored but their text is not read, so they cannot be searched or cited. PDFs with a text layer still work.",
                "Add ocr to COMPOSE_PROFILES and set DOCLING_SERVE_URL=http://docling-serve:5001 (Docling, about 800 MB of RAM), or set AZURE_DOC_INTELLIGENCE_ENDPOINT + AZURE_DOC_INTELLIGENCE_KEY."
            )
        );
    }
    // deploy/compose.yml passes DOCLING_SERVE_URL through empty ("no Docling");
    // the converter offers Docling only when the URL is set and answers
    // (services/document-converter/src/providers.ts).
    if (profiles.includes("ocr") && !has("DOCLING_SERVE_URL")) {
        out.push(
            warn(
                "PROFILE_OCR_MISMATCH",
                ["DOCLING_SERVE_URL", "COMPOSE_PROFILES"],
                "The ocr profile runs Docling, but DOCLING_SERVE_URL is empty, so the document converter never uses it and scanned PDFs stay unread.",
                "Set DOCLING_SERVE_URL=http://docling-serve:5001"
            )
        );
    }
    if (hostOf(get(env, "DOCLING_SERVE_URL")) === "docling-serve" && !profiles.includes("ocr")) {
        out.push(
            warn(
                "PROFILE_OCR_MISMATCH",
                ["COMPOSE_PROFILES", "DOCLING_SERVE_URL"],
                'DOCLING_SERVE_URL points at the bundled Docling, but COMPOSE_PROFILES does not include "ocr", so it is not running: Office files sent to the converter fail against it.',
                "Add ocr to COMPOSE_PROFILES, or clear DOCLING_SERVE_URL."
            )
        );
    }
    if (get(env, "OCR_DEFAULT_PROVIDER") === "DOCLING" && !profiles.includes("ocr")) {
        out.push(
            warn(
                "PROFILE_OCR_MISMATCH",
                ["COMPOSE_PROFILES", "OCR_DEFAULT_PROVIDER"],
                'OCR_DEFAULT_PROVIDER=DOCLING but COMPOSE_PROFILES does not include "ocr", so Docling is not running and the preference is skipped.',
                "Add ocr to COMPOSE_PROFILES, or clear OCR_DEFAULT_PROVIDER."
            )
        );
    }

    // Transcription (packages/llm/src/providers/registry.ts
    // resolveTranscriptionProvider: the service is used only when
    // TRANSCRIPTION_PROVIDER=sidecar, never inferred).
    const sidecar = get(env, "TRANSCRIPTION_PROVIDER") === "sidecar";
    if (sidecar && !profiles.includes("whisper")) {
        out.push(
            warn(
                "PROFILE_WHISPER_MISMATCH",
                ["COMPOSE_PROFILES", "TRANSCRIPTION_PROVIDER"],
                'TRANSCRIPTION_PROVIDER=sidecar but COMPOSE_PROFILES does not include "whisper", so the transcription container is not running and audio uploads fail.',
                "Add whisper to COMPOSE_PROFILES, or clear TRANSCRIPTION_PROVIDER to transcribe through the cloud provider."
            )
        );
    }
    if (profiles.includes("whisper") && !sidecar) {
        out.push(
            warn(
                "PROFILE_WHISPER_MISMATCH",
                ["TRANSCRIPTION_PROVIDER", "COMPOSE_PROFILES"],
                'The whisper profile runs the transcription container, but TRANSCRIPTION_PROVIDER is not "sidecar", so recordings still go to the cloud provider and the container sits idle.',
                "Set TRANSCRIPTION_PROVIDER=sidecar, or remove whisper from COMPOSE_PROFILES."
            )
        );
    }
}

/**
 * Every static check, as a pure function of the environment.
 * @param {Record<string, string | undefined>} env
 * @returns {{ level: "error" | "warn", code: string, vars: string[], message: string, fix: string }[]}
 */
export function checkEnv(env) {
    const out = [];
    checkRequiredSecrets(env, out);
    checkSecretQuality(env, out);
    checkPairs(env, out);
    checkAccess(env, out);
    checkChat(env, out);
    checkEmbeddings(env, out);
    checkInngest(env, out);
    checkEnums(env, out);
    checkOptional(env, out);
    return sortFindings(redact(out, env));
}

function sortFindings(findings) {
    // Stable: errors first, original order within a level.
    return [
        ...findings.filter(f => f.level === "error"),
        ...findings.filter(f => f.level !== "error"),
    ];
}

// ── .env parsing ─────────────────────────────────────────────────────

/**
 * Parse a .env file the way Compose and dotenv agree on: KEY=value, optional
 * `export`, `#` comments, single or double quotes. Later lines win.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnvFile(text) {
    const env = {};
    for (const rawLine of text.replace(/^﻿/, "").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line === "" || line.startsWith("#")) continue;
        const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
        if (!match) continue;
        const [, key, rest] = match;
        let value;
        const quote = rest[0];
        if (quote === '"' || quote === "'") {
            const end = rest.indexOf(quote, 1);
            value = end === -1 ? rest.slice(1) : rest.slice(1, end);
            if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"');
        } else {
            // Unquoted: an inline comment starts at whitespace + '#'.
            value = rest.replace(/\s+#.*$/, "").trim();
        }
        env[key] = value;
    }
    return env;
}

// ── Live probes ──────────────────────────────────────────────────────

const PROBE_TIMEOUT_MS = 5_000;

/**
 * Service addresses on the Compose network (docker-compose.yml service names
 * and the ports each listens on inside its container).
 */
export const DEFAULT_TARGETS = {
    db: { host: "db", port: 5432, user: "postgres", database: "pdr_ai_v2" },
    storage: "http://seaweedfs:8333",
    adeu: "http://adeu-docs-editing:8000",
    converter: "http://document-converter:8002",
    gotenberg: "http://gotenberg:3000",
    transcription: "http://transcription:8000",
    docling: "http://docling-serve:5001",
    searxng: "http://searxng:8080",
    inngest: "http://inngest:8288",
    worker: "http://worker:8020",
    app: "http://app:3000",
};

const sha256hex = data => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
const rfc3986 = text =>
    encodeURIComponent(text).replace(
        /[!'()*]/g,
        c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
    );

/**
 * AWS Signature Version 4 headers for a body-less S3 request. Written by hand
 * so the migrate image needs no AWS SDK; verified in the tests against the
 * worked example in the S3 API reference.
 */
export function signS3Request({
    method = "GET",
    url,
    region,
    accessKey,
    secretKey,
    now = new Date(),
}) {
    const target = new URL(url);
    const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
    const day = amzDate.slice(0, 8);
    const payloadHash = sha256hex("");
    const query = [...target.searchParams.entries()]
        .map(([k, v]) => [rfc3986(k), rfc3986(v)])
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${k}=${v}`)
        .join("&");
    const headers = {
        host: target.host,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
    };
    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonical = [
        method,
        target.pathname || "/",
        query,
        ...Object.keys(headers)
            .sort()
            .map(name => `${name}:${headers[name]}`),
        "",
        signedHeaders,
        payloadHash,
    ].join("\n");
    const scope = `${day}/${region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonical)].join("\n");
    const key = ["s3", "aws4_request"].reduce(hmac, hmac(hmac(`AWS4${secretKey}`, day), region));
    const signature = hmac(key, toSign).toString("hex");
    return {
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
}

/** One bounded HTTP call. Never throws: { status } or { failure }. */
async function request(fetchImpl, url, init = {}, timeoutMs = PROBE_TIMEOUT_MS) {
    try {
        const response = await fetchImpl(url, {
            ...init,
            redirect: "manual",
            signal: AbortSignal.timeout(timeoutMs),
        });
        // Drain the body so the connection is released; its content is not used.
        await response.arrayBuffer().catch(() => undefined);
        return { status: response.status };
    } catch (cause) {
        // A timeout is a DOMException whose legacy numeric `code` is 23, so the
        // name is checked before any code.
        const timedOut = cause?.name === "TimeoutError" || cause?.name === "AbortError";
        const code = cause?.cause?.code ?? cause?.code ?? cause?.name ?? "error";
        const failure = timedOut
            ? `no answer within ${timeoutMs / 1000}s`
            : code === "ENOTFOUND" || code === "EAI_AGAIN"
              ? "its hostname does not resolve (the container is not running, or this check is not on its network)"
              : code === "ECONNREFUSED"
                ? "connection refused (the container is up but the service inside is not listening yet)"
                : `request failed (${code})`;
        return { failure };
    }
}

async function probeDatabase(env, target, loadPostgres, out) {
    const password = get(env, "POSTGRES_PASSWORD");
    if (!password) return; // REQUIRED_MISSING already says so
    let postgres;
    try {
        postgres = await loadPostgres();
    } catch {
        out.push(
            error(
                "PROBE_DRIVER_MISSING",
                [],
                "The database could not be probed: the `postgres` driver is not installed where this script runs.",
                "Run the probe inside the stack: launchstack doctor (docker compose run --rm migrate node scripts/deploy-check.mjs --probe)."
            )
        );
        return;
    }
    const sql = postgres({
        host: target.host,
        port: target.port,
        user: target.user,
        password,
        database: target.database,
        max: 1,
        connect_timeout: PROBE_TIMEOUT_MS / 1000,
        idle_timeout: 1,
        onnotice: () => undefined,
    });
    try {
        const [row] = await sql`
            SELECT
                (SELECT count(*)::int FROM pg_available_extensions WHERE name = 'vector') AS available,
                (SELECT count(*)::int FROM pg_extension WHERE extname = 'vector') AS installed
        `;
        if (!row || row.available === 0) {
            out.push(
                error(
                    "PROBE_PGVECTOR_MISSING",
                    [],
                    `Postgres at ${target.host} does not offer the "vector" extension, so the schema migration fails and no document can be indexed.`,
                    "Use the pgvector/pgvector:pg16 image the stack ships, or install pgvector on your own server."
                )
            );
        }
    } catch (cause) {
        const code = cause?.code ?? "";
        if (code === "28P01" || code === "28000") {
            out.push(
                error(
                    "PROBE_DB_AUTH",
                    "POSTGRES_PASSWORD",
                    `The database and this configuration disagree: Postgres at ${target.host} rejected POSTGRES_PASSWORD. A database volume keeps the password it was first created with; changing the variable later does not change it.`,
                    "Restore the original POSTGRES_PASSWORD, or change it inside the database too (ALTER USER postgres PASSWORD ...)."
                )
            );
        } else {
            out.push(
                error(
                    "PROBE_DB_UNREACHABLE",
                    [],
                    `Postgres at ${target.host}:${target.port} did not answer (${code || cause?.message || "unknown error"}). The app, worker, object storage and job server all depend on it.`,
                    "Check it: launchstack status, then launchstack logs db."
                )
            );
        }
    } finally {
        await sql.end({ timeout: 1 }).catch(() => undefined);
    }
}

/**
 * Object storage with the configured credentials: a signed ListBuckets.
 * docker/seaweedfs-entrypoint.sh writes S3_ACCESS_KEY/S3_SECRET_KEY into the
 * container's identity file at start, so a refusal means the container still
 * holds an older pair. Reaching it at all also proves the filer authenticated
 * to Postgres, the failure that took production's file origin down.
 */
async function probeStorage(env, target, fetchImpl, out) {
    const accessKey = get(env, "S3_ACCESS_KEY");
    const secretKey = get(env, "S3_SECRET_KEY");
    if (!accessKey || !secretKey) return;
    const url = `${target}/`;
    const headers = signS3Request({
        url,
        region: get(env, "S3_REGION") ?? "us-east-1",
        accessKey,
        secretKey,
    });
    const result = await request(fetchImpl, url, { headers });
    if (result.failure) {
        out.push(
            error(
                "PROBE_STORAGE_UNREACHABLE",
                [],
                `Object storage (seaweedfs) is unreachable: ${result.failure}. Uploads and file previews fail. If its log shows a Postgres authentication error, seaweedfs and db disagree about POSTGRES_PASSWORD.`,
                "Check it: launchstack logs seaweedfs."
            )
        );
    } else if (result.status === 401 || result.status === 403) {
        out.push(
            error(
                "PROBE_STORAGE_AUTH",
                ["S3_ACCESS_KEY", "S3_SECRET_KEY"],
                `Object storage and this configuration disagree: seaweedfs rejected S3_ACCESS_KEY/S3_SECRET_KEY (HTTP ${result.status}). The app and worker would fail every upload.`,
                "seaweedfs reads the pair when it starts: launchstack restart, so it picks up the current values."
            )
        );
    } else if (result.status >= 400) {
        out.push(
            error(
                "PROBE_STORAGE_UNREACHABLE",
                [],
                `Object storage (seaweedfs) answered HTTP ${result.status} to a signed list request, so it is not healthy.`,
                "Check it: launchstack logs seaweedfs."
            )
        );
    }
}

/**
 * A service's open health endpoint, then one cheap call with its key. The
 * services answer 401 on a wrong or missing key before looking at the request
 * (services/[name]/app/auth.py, services/document-converter/src/auth.ts), so any
 * other status proves the two copies of the key match.
 */
async function probeService(fetchImpl, out, spec) {
    const { service, base, health, keyVar, authCall, feature } = spec;
    const unhealthy = detail =>
        out.push(
            error(
                "PROBE_UNREACHABLE",
                [],
                `${service} is not healthy: ${detail}. ${feature}`,
                `Check it: launchstack logs ${service}.`
            )
        );
    const mismatch = status =>
        out.push(
            error(
                "PROBE_KEY_MISMATCH",
                keyVar,
                `${service} and this configuration disagree: it rejected ${keyVar} (HTTP ${status}), so the app and worker get 401 from it. ${feature}`,
                `${service} reads the key when it starts: launchstack restart, so every container picks up the current value.`
            )
        );
    const rejected = status => status === 401 || status === 403;

    const healthResult = await request(fetchImpl, `${base}${health}`, undefined, spec.timeoutMs);
    if (healthResult.failure) return unhealthy(healthResult.failure);
    if (healthResult.status < 200 || healthResult.status >= 300) {
        return unhealthy(`HTTP ${healthResult.status} from ${health}`);
    }
    if (!authCall) return undefined;

    const authResult = await request(fetchImpl, `${base}${authCall.path}`, authCall.init);
    if (authResult.failure) return unhealthy(authResult.failure);
    if (rejected(authResult.status)) return mismatch(authResult.status);
    return undefined;
}

/**
 * Live checks. Run inside the Compose network.
 * @param {Record<string, string | undefined>} env
 * @param {{ targets?: Partial<typeof DEFAULT_TARGETS>, fetch?: typeof fetch, loadPostgres?: () => Promise<Function> }} [options]
 */
export async function runProbes(env, options = {}) {
    const targets = {
        ...DEFAULT_TARGETS,
        // deploy/compose.yml sets the S3 port inside the container to
        // LAUNCHSTACK_FILES_PORT (S3_PORT in docker/seaweedfs-entrypoint.sh).
        storage: `http://seaweedfs:${get(env, "LAUNCHSTACK_FILES_PORT") ?? "8333"}`,
        ...options.targets,
    };
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const loadPostgres = options.loadPostgres ?? (async () => (await import("postgres")).default);
    const profiles = profilesOf(env);
    const out = [];
    const key = name => ({ "X-API-Key": get(env, name) ?? "" });

    const services = [
        {
            service: "adeu-docs-editing",
            base: targets.adeu,
            health: "/health",
            keyVar: "ADEU_SERVICE_API_KEY",
            // An empty request: 401 on a wrong key, a validation error on the right one.
            authCall: {
                path: "/adeu/accept-all",
                init: { method: "POST", headers: key("ADEU_SERVICE_API_KEY") },
            },
            feature: "Word document editing depends on it.",
        },
        {
            service: "document-converter",
            base: targets.converter,
            health: "/health",
            keyVar: "DOCUMENT_CONVERTER_API_KEY",
            authCall: {
                path: "/capabilities",
                init: { headers: key("DOCUMENT_CONVERTER_API_KEY") },
            },
            feature: "PDF and Office ingestion depends on it.",
        },
        {
            // With --api-enable-basic-auth Gotenberg 8 still answers /health
            // openly; /version is its cheapest route that takes the credential.
            service: "gotenberg",
            base: targets.gotenberg,
            health: "/health",
            keyVar: "GOTENBERG_SERVICE_PASSWORD",
            authCall: {
                path: "/version",
                init: {
                    headers: {
                        authorization: `Basic ${Buffer.from(
                            `${get(env, "GOTENBERG_SERVICE_USERNAME") ?? "launchstack"}:${get(env, "GOTENBERG_SERVICE_PASSWORD") ?? ""}`
                        ).toString("base64")}`,
                    },
                },
            },
            feature: "PDF export and Office previews depend on it.",
        },
        {
            service: "inngest",
            base: targets.inngest,
            health: "/health",
            feature: "Background jobs (Drive and Gmail sync, scheduled work) depend on it.",
        },
        {
            // apps/worker/src/main.ts: /readyz runs SELECT 1 through the worker's pool.
            service: "worker",
            base: targets.worker,
            health: "/readyz",
            feature:
                "Document ingestion runs in the worker; a failing /readyz means the worker cannot reach db.",
        },
        {
            // apps/web/src/app/api/health/route.ts: 503 when its database check fails.
            service: "app",
            base: targets.app,
            health: "/api/health",
            // The first request after a start loads the route, which can take
            // several seconds on a small machine.
            timeoutMs: 15_000,
            feature: "This is the web application itself; a 503 here means app cannot reach db.",
        },
    ];
    if (profiles.includes("whisper")) {
        services.push({
            service: "transcription",
            base: targets.transcription,
            health: "/health",
            keyVar: "TRANSCRIPTION_SERVICE_API_KEY",
            authCall: {
                path: "/transcribe",
                init: { method: "POST", headers: key("TRANSCRIPTION_SERVICE_API_KEY") },
            },
            feature: "Self-hosted audio transcription depends on it.",
        });
    }
    if (profiles.includes("ocr")) {
        services.push({
            service: "docling-serve",
            base: targets.docling,
            health: "/health",
            feature:
                "OCR of scanned PDFs and Office conversion depend on it (it can take two minutes to load its models).",
        });
    }
    if (profiles.includes("search")) {
        services.push({
            service: "searxng",
            base: targets.searxng,
            health: "/healthz",
            feature: "Web search depends on it.",
        });
    }
    await Promise.all([
        probeDatabase(env, targets.db, loadPostgres, out),
        probeStorage(env, targets.storage, fetchImpl, out),
        ...services.map(spec => probeService(fetchImpl, out, spec)),
    ]);
    return sortFindings(redact(out, env));
}

// ── CLI ──────────────────────────────────────────────────────────────

/** @param {{ level: string, code: string, vars: string[], message: string, fix: string }[]} findings */
export function formatReport(findings, { probed = false } = {}) {
    const errors = findings.filter(f => f.level === "error");
    const warnings = findings.filter(f => f.level !== "error");
    const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    const lines = [
        `LaunchStack preflight (${probed ? "configuration + live probes" : "configuration"}): ${count(errors.length, "error")}, ${count(warnings.length, "warning")}`,
    ];
    const section = (title, items, mark) => {
        if (items.length === 0) return;
        lines.push("", title);
        for (const f of items) {
            lines.push(`  ${mark} [${f.code}] ${f.message}`, `      fix: ${f.fix}`);
        }
    };
    section("Errors (must be fixed)", errors, "x");
    section("Warnings (features that are off)", warnings, "!");
    lines.push("", errors.length === 0 ? "PASS" : "FAIL");
    return lines.join("\n");
}

function parseArgs(argv) {
    const args = { envFile: undefined, probe: false, json: false, help: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--probe") args.probe = true;
        else if (arg === "--json") args.json = true;
        else if (arg === "--help" || arg === "-h") args.help = true;
        else if (arg === "--env-file") {
            args.envFile = argv[++i];
            if (!args.envFile) throw new Error("--env-file needs a path");
        } else if (arg.startsWith("--env-file=")) args.envFile = arg.slice("--env-file=".length);
        else if (arg === "--")
            continue; // pnpm forwards a bare separator
        else throw new Error(`unknown argument: ${arg}`);
    }
    return args;
}

const USAGE = "Usage: node scripts/deploy-check.mjs [--env-file <path>] [--probe] [--json]";

export async function main(argv = process.argv.slice(2)) {
    let args;
    try {
        args = parseArgs(argv);
    } catch (cause) {
        console.error(`[deploy-check] ${cause.message}\n${USAGE}`);
        return 2;
    }
    if (args.help) {
        console.log(USAGE);
        return 0;
    }

    let env = process.env;
    let findings;
    if (args.envFile) {
        try {
            env = parseEnvFile(readFileSync(args.envFile, "utf8"));
        } catch (cause) {
            findings = [
                error(
                    "ENV_FILE_UNREADABLE",
                    [],
                    `The environment file ${args.envFile} could not be read (${cause.code ?? cause.message}).`,
                    "Pass the path of the .env to check, for example ~/.launchstack/.env."
                ),
            ];
        }
    }
    if (!findings) {
        findings = checkEnv(env);
        if (args.probe) findings = sortFindings([...findings, ...(await runProbes(env))]);
    }

    const ok = !findings.some(f => f.level === "error");
    console.log(
        args.json
            ? JSON.stringify({ ok, findings }, null, 2)
            : formatReport(findings, { probed: args.probe })
    );
    return ok ? 0 : 1;
}

function isMainModule() {
    try {
        return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
}

if (isMainModule()) {
    process.exitCode = await main();
}
