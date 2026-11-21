/**
 * Tests for the deployment preflight. Run with node's own runner, like
 * apps/landing/scripts/smoke.test.mjs (jest's testMatch only collects
 * __tests__ directories, and this script must stay importable as plain ESM):
 *
 *   node --test apps/web/scripts/deploy-check.test.mjs
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
    checkEnv,
    main,
    formatReport,
    parseEnvFile,
    runProbes,
    signS3Request,
} from "./deploy-check.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "deploy-check.mjs");

/** Distinct, recognisable values so a leak into a finding is detectable. */
const hex = seed => seed.repeat(64).slice(0, 64);
const SECRETS = {
    POSTGRES_PASSWORD: hex("a1"),
    BETTER_AUTH_SECRET: hex("b2"),
    FILE_ACCESS_TOKEN_SECRET: hex("c3"),
    EMBEDDING_SECRETS_KEY: Buffer.alloc(32, 7).toString("base64"),
    S3_ACCESS_KEY: hex("d4").slice(0, 20),
    S3_SECRET_KEY: hex("e5"),
    ADEU_SERVICE_API_KEY: hex("f6"),
    DOCUMENT_CONVERTER_API_KEY: hex("07"),
    TRANSCRIPTION_SERVICE_API_KEY: hex("18"),
    GOTENBERG_SERVICE_PASSWORD: hex("29"),
    INNGEST_EVENT_KEY: hex("3a"),
    INNGEST_SIGNING_KEY: hex("4b"),
    SEARXNG_SECRET: hex("5c"),
    GOOGLE_AI_API_KEY: "AIzaSyTESTONLY-not-a-real-key-000000000",
    EMBEDDING_API_KEY: "AIzaSyTESTONLY-not-a-real-key-111111111",
};

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai";

const localEnv = (overrides = {}) => ({
    ...SECRETS,
    LAUNCHSTACK_VERSION: "2.0.0",
    DOMAIN: "",
    LAUNCHSTACK_HTTP_PORT: "3000",
    LAUNCHSTACK_FILES_PORT: "8333",
    LAUNCHSTACK_BIND: "127.0.0.1",
    COMPOSE_PROFILES: "",
    BETTER_AUTH_URL: "http://localhost:3000",
    EMBEDDING_API_BASE_URL: GEMINI,
    EMBEDDING_MODEL: "gemini-embedding-001",
    EMBEDDING_INDEX: "gemini-embedding-768",
    ...overrides,
});

const domainEnv = (overrides = {}) =>
    localEnv({
        DOMAIN: "docs.example.com",
        ACME_EMAIL: "ops@example.com",
        COMPOSE_PROFILES: "domain,ocr,search",
        DOCLING_SERVE_URL: "http://docling-serve:5001",
        BETTER_AUTH_URL: "https://docs.example.com",
        SEARCH_PROVIDER: "searxng",
        SEARXNG_URL: "http://searxng:8080",
        ...overrides,
    });

const errorsOf = findings => findings.filter(f => f.level === "error");
const codesOf = findings => errorsOf(findings).map(f => f.code);

test("a good local configuration has no errors, only what-you-lose warnings", () => {
    const findings = checkEnv(localEnv());
    assert.deepEqual(errorsOf(findings), []);
    assert.deepEqual(findings.map(f => f.code).sort(), ["OCR_OFF", "WEB_SEARCH_OFF"]);
});

test("a good domain configuration has no errors and no warnings", () => {
    assert.deepEqual(checkEnv(domainEnv()), []);
});

test("an OpenAI-compatible chat endpoint and the legacy OpenAI index pass", () => {
    const findings = checkEnv(
        localEnv({
            GOOGLE_AI_API_KEY: "",
            CHAT_BASE_URL: "https://openrouter.ai/api/v1",
            CHAT_API_KEY: "sk-or-TESTONLY-000000000000",
            EMBEDDING_API_BASE_URL: "https://api.openai.com/v1",
            EMBEDDING_MODEL: "text-embedding-3-large",
            EMBEDDING_INDEX: "legacy-openai-1536",
        })
    );
    assert.deepEqual(errorsOf(findings), []);
});

const BROKEN = [
    [
        "missing BETTER_AUTH_SECRET",
        { BETTER_AUTH_SECRET: "" },
        "REQUIRED_MISSING",
        "BETTER_AUTH_SECRET",
    ],
    [
        "missing BETTER_AUTH_URL",
        { BETTER_AUTH_URL: undefined },
        "REQUIRED_MISSING",
        "BETTER_AUTH_URL",
    ],
    [
        "EMBEDDING_API_KEY without its base URL",
        { EMBEDDING_API_BASE_URL: "" },
        "PAIR_INCOMPLETE",
        "EMBEDDING_API_BASE_URL",
    ],
    [
        "embeddings base URL without its key",
        { EMBEDDING_API_KEY: "" },
        "PAIR_INCOMPLETE",
        "EMBEDDING_API_KEY",
    ],
    [
        "CHAT_API_KEY without CHAT_BASE_URL",
        { CHAT_API_KEY: "sk-TESTONLY-0000000000000000" },
        "PAIR_INCOMPLETE",
        "CHAT_BASE_URL",
    ],
    [
        "a pdr_local_* default left in",
        { ADEU_SERVICE_API_KEY: "pdr_local_adeu_key" },
        "INSECURE_DEFAULT",
        "ADEU_SERVICE_API_KEY",
    ],
    [
        "POSTGRES_PASSWORD=password",
        { POSTGRES_PASSWORD: "password" },
        "INSECURE_DEFAULT",
        "POSTGRES_PASSWORD",
    ],
    [
        "changeme on an optional secret",
        { METRICS_SCRAPE_TOKEN: "changeme" },
        "INSECURE_DEFAULT",
        "METRICS_SCRAPE_TOKEN",
    ],
    [
        "a short secret",
        { FILE_ACCESS_TOKEN_SECRET: "abc123def4" },
        "SECRET_TOO_SHORT",
        "FILE_ACCESS_TOKEN_SECRET",
    ],
    [
        "BETTER_AUTH_SECRET under the app's 32-character floor",
        { BETTER_AUTH_SECRET: "0123456789abcdef01234567" },
        "SECRET_TOO_SHORT",
        "BETTER_AUTH_SECRET",
    ],
    [
        "a database password that breaks DATABASE_URL",
        { POSTGRES_PASSWORD: "p@ss/word:with#url?chars" },
        "POSTGRES_PASSWORD_URL_UNSAFE",
        "POSTGRES_PASSWORD",
    ],
    [
        "EMBEDDING_SECRETS_KEY that is hex, not base64 of 32 bytes",
        { EMBEDDING_SECRETS_KEY: hex("9d") },
        "SECRETS_KEY_INVALID",
        "EMBEDDING_SECRETS_KEY",
    ],
    [
        "DOMAIN set with an http BETTER_AUTH_URL",
        {
            DOMAIN: "docs.example.com",
            COMPOSE_PROFILES: "domain",
            BETTER_AUTH_URL: "http://docs.example.com",
        },
        "URL_DOMAIN_MISMATCH",
        "BETTER_AUTH_URL",
    ],
    [
        "DOMAIN set with a URL on another host",
        {
            DOMAIN: "docs.example.com",
            COMPOSE_PROFILES: "domain",
            BETTER_AUTH_URL: "https://other.example.com",
        },
        "URL_DOMAIN_MISMATCH",
        "BETTER_AUTH_URL",
    ],
    [
        "DOMAIN set without the domain profile",
        { DOMAIN: "docs.example.com", BETTER_AUTH_URL: "https://docs.example.com" },
        "DOMAIN_PROFILE_MISMATCH",
        "COMPOSE_PROFILES",
    ],
    [
        "the domain profile without DOMAIN",
        { COMPOSE_PROFILES: "domain" },
        "DOMAIN_PROFILE_MISMATCH",
        "DOMAIN",
    ],
    [
        "DOMAIN written as a URL",
        { DOMAIN: "https://docs.example.com", COMPOSE_PROFILES: "domain" },
        "DOMAIN_INVALID",
        "DOMAIN",
    ],
    [
        "a local URL on the wrong port",
        { LAUNCHSTACK_HTTP_PORT: "8080" },
        "URL_PORT_MISMATCH",
        "LAUNCHSTACK_HTTP_PORT",
    ],
    [
        "a LAN address while bound to loopback",
        { BETTER_AUTH_URL: "http://192.168.1.20:3000" },
        "URL_HOST_NOT_BOUND",
        "LAUNCHSTACK_BIND",
    ],
    [
        "only one Inngest key",
        { INNGEST_SIGNING_KEY: "" },
        "INNGEST_KEY_MISSING",
        "INNGEST_SIGNING_KEY",
    ],
    [
        "an Inngest key that is not hex",
        { INNGEST_EVENT_KEY: "not-hex-at-all-zzzz" },
        "INNGEST_KEY_NOT_HEX",
        "INNGEST_EVENT_KEY",
    ],
    ["no chat configured", { GOOGLE_AI_API_KEY: "" }, "CHAT_NOT_CONFIGURED", "GOOGLE_AI_API_KEY"],
    [
        "no embeddings configured",
        { EMBEDDING_API_BASE_URL: "", EMBEDDING_API_KEY: "" },
        "EMBEDDINGS_NOT_CONFIGURED",
        "EMBEDDING_API_BASE_URL",
    ],
    [
        "the OpenAI index pointed at a Gemini endpoint",
        { EMBEDDING_INDEX: "legacy-openai-1536" },
        "EMBEDDING_INDEX_MISMATCH",
        "EMBEDDING_INDEX",
    ],
    [
        "EMBEDDING_INDEX unset (defaults to the OpenAI index) with a Gemini endpoint",
        { EMBEDDING_INDEX: "" },
        "EMBEDDING_INDEX_MISMATCH",
        "EMBEDDING_INDEX",
    ],
    [
        "an index name that does not exist",
        { EMBEDDING_INDEX: "gemini-768" },
        "EMBEDDING_INDEX_UNKNOWN",
        "EMBEDDING_INDEX",
    ],
    [
        "the Ollama index without its variables",
        { EMBEDDING_INDEX: "ollama-default" },
        "EMBEDDING_INDEX_UNKNOWN",
        "OLLAMA_BASE_URL",
    ],
    [
        "a misspelt SEARCH_PROVIDER",
        { SEARCH_PROVIDER: "google" },
        "ENUM_INVALID",
        "SEARCH_PROVIDER",
    ],
    [
        "a secret only a profile uses, which Compose still demands",
        { SEARXNG_SECRET: "" },
        "REQUIRED_MISSING",
        "SEARXNG_SECRET",
    ],
    [
        "the app and object storage on one port",
        { LAUNCHSTACK_FILES_PORT: "3000" },
        "PORT_CONFLICT",
        "LAUNCHSTACK_FILES_PORT",
    ],
];

for (const [name, overrides, code, variable] of BROKEN) {
    test(`fails: ${name} -> ${code}`, () => {
        const findings = checkEnv(localEnv(overrides));
        const match = errorsOf(findings).find(f => f.code === code && f.vars.includes(variable));
        assert.ok(
            match,
            `expected ${code} naming ${variable}; got ${JSON.stringify(codesOf(findings))}`
        );
        assert.ok(match.message.length > 0 && match.fix.length > 0);
    });
}

test("a pair finding names the missing half first", () => {
    const [finding] = errorsOf(checkEnv(localEnv({ EMBEDDING_API_BASE_URL: "" })));
    assert.equal(finding.vars[0], "EMBEDDING_API_BASE_URL");
    assert.match(finding.message, /^EMBEDDING_API_BASE_URL is missing/);
});

test("profile and optional-feature problems are warnings, never errors", () => {
    const cases = [
        [
            { SEARCH_PROVIDER: "searxng", SEARXNG_URL: "http://searxng:8080" },
            "PROFILE_SEARCH_MISMATCH",
        ],
        [{ COMPOSE_PROFILES: "search" }, "PROFILE_SEARCH_MISMATCH"],
        [{ OCR_DEFAULT_PROVIDER: "DOCLING" }, "PROFILE_OCR_MISMATCH"],
        [{ TRANSCRIPTION_PROVIDER: "sidecar" }, "PROFILE_WHISPER_MISMATCH"],
        [{ COMPOSE_PROFILES: "whisper" }, "PROFILE_WHISPER_MISMATCH"],
        [{ COMPOSE_PROFILES: "ocr,gpu" }, "PROFILE_UNKNOWN"],
        [{ COMPOSE_PROFILES: "ocr" }, "PROFILE_OCR_MISMATCH"],
        [{ DOCLING_SERVE_URL: "http://docling-serve:5001" }, "PROFILE_OCR_MISMATCH"],
        [{ SEARCH_PROVIDER: "exa" }, "WEB_SEARCH_OFF"],
        [{ EMBEDDING_MODEL: "" }, "EMBEDDING_MODEL_MISMATCH"],
        [
            { LAUNCHSTACK_BIND: "0.0.0.0", BETTER_AUTH_URL: "http://192.168.1.20:3000" },
            "INSECURE_HTTP",
        ],
        [
            { LAUNCHSTACK_BIND: "0.0.0.0", BETTER_AUTH_URL: "http://192.168.1.20:3000" },
            "FILES_URL_LOCAL_ONLY",
        ],
        [
            {
                DOMAIN: "docs.example.com",
                COMPOSE_PROFILES: "domain",
                BETTER_AUTH_URL: "https://docs.example.com",
            },
            "ACME_EMAIL_MISSING",
        ],
    ];
    for (const [overrides, code] of cases) {
        const findings = checkEnv(localEnv(overrides));
        assert.deepEqual(errorsOf(findings), [], `${code}: ${JSON.stringify(codesOf(findings))}`);
        assert.ok(
            findings.some(f => f.level === "warn" && f.code === code),
            `expected warning ${code}; got ${findings.map(f => f.code)}`
        );
    }
});

test("errors are listed before warnings", () => {
    const levels = checkEnv(localEnv({ BETTER_AUTH_SECRET: "", GOOGLE_AI_API_KEY: "" })).map(
        f => f.level
    );
    assert.deepEqual(
        levels,
        [...levels].sort((a, b) => (a === b ? 0 : a === "error" ? -1 : 1))
    );
    assert.ok(levels.includes("error") && levels.includes("warn"));
});

test("no finding, in either output format, contains a secret value", () => {
    const leaky = {
        // Every secret is wrong in a way that produces a finding about it.
        POSTGRES_PASSWORD: "s3cr3t@value/with:url#chars",
        BETTER_AUTH_SECRET: "shortAuthSecret-9931",
        FILE_ACCESS_TOKEN_SECRET: "tooShort-7712",
        EMBEDDING_SECRETS_KEY: "notBase64Of32Bytes-5521",
        S3_ACCESS_KEY: "ak-4410",
        S3_SECRET_KEY: "sk-short-8853",
        ADEU_SERVICE_API_KEY: "adeu-6627",
        DOCUMENT_CONVERTER_API_KEY: "conv-1193",
        GOTENBERG_SERVICE_PASSWORD: "goten-2248",
        INNGEST_EVENT_KEY: "event-key-not-hex-3371",
        INNGEST_SIGNING_KEY: "signing-key-not-hex-9015",
        CHAT_API_KEY: "sk-chat-lonely-key-4466",
        EMBEDDING_API_KEY: "emb-lonely-key-7788",
        AI_API_KEY: "ai-lonely-key-1212",
        GOOGLE_AI_API_KEY: "",
        EMBEDDING_API_BASE_URL: "",
        AUTH_GOOGLE_CLIENT_SECRET: "google-secret-5599",
    };
    const env = localEnv(leaky);
    const findings = checkEnv(env);
    assert.ok(errorsOf(findings).length >= 12, "the fixture should trip many checks");
    const rendered = [JSON.stringify(findings), formatReport(findings)].join("\n");
    for (const [name, value] of Object.entries({ ...SECRETS, ...leaky })) {
        if (!value || !/(SECRET|PASSWORD|TOKEN|_KEY)$/.test(name)) continue;
        assert.ok(!rendered.includes(value), `${name}'s value appears in the output`);
    }
});

test("parseEnvFile handles quotes, comments, export and blank lines", () => {
    const env = parseEnvFile(
        [
            "# a comment",
            "",
            "PLAIN=value",
            "  SPACED = padded value  ",
            'DOUBLE="quoted # not a comment"',
            "SINGLE='single $quoted'",
            "export EXPORTED=yes",
            "INLINE=value # trailing comment",
            "HASH=abc#def",
            "EMPTY=",
            'EMPTY_QUOTED=""',
            "URL=https://example.com/a?b=c",
            'ESCAPED="line1\\nline2"',
            "not a variable line",
            "PLAIN=last wins",
            "",
        ].join("\r\n")
    );
    assert.deepEqual(env, {
        PLAIN: "last wins",
        SPACED: "padded value",
        DOUBLE: "quoted # not a comment",
        SINGLE: "single $quoted",
        EXPORTED: "yes",
        INLINE: "value",
        HASH: "abc#def",
        EMPTY: "",
        EMPTY_QUOTED: "",
        URL: "https://example.com/a?b=c",
        ESCAPED: "line1\nline2",
    });
});

// ── CLI ──────────────────────────────────────────────────────────────

const toEnvFile = env =>
    Object.entries(env)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}="${value}"`)
        .join("\n");

function runCli(env, ...flags) {
    const dir = mkdtempSync(join(tmpdir(), "deploy-check-"));
    const file = join(dir, ".env");
    writeFileSync(file, `# written by the test\nexport IGNORED=1\n\n${toEnvFile(env)}\n`);
    // A clean process environment proves --env-file is the only input.
    return spawnSync(process.execPath, [SCRIPT, "--env-file", file, ...flags], {
        encoding: "utf8",
        env: { PATH: process.env.PATH },
    });
}

test("CLI: a good file exits 0 and says PASS", () => {
    const result = runCli(domainEnv());
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /0 errors, 0 warnings/);
    assert.match(result.stdout, /PASS\n$/);
});

test("CLI: warnings alone still exit 0", () => {
    const result = runCli(localEnv());
    assert.equal(result.status, 0);
    assert.match(result.stdout, /0 errors, 2 warnings/);
});

test("CLI: a bad file exits 1, errors first, one finding and one fix line each", () => {
    const result = runCli(localEnv({ BETTER_AUTH_SECRET: "", INNGEST_SIGNING_KEY: "" }));
    assert.equal(result.status, 1);
    const lines = result.stdout.split("\n");
    assert.ok(
        lines.indexOf("Errors (must be fixed)") < lines.indexOf("Warnings (features that are off)")
    );
    const index = lines.findIndex(line => line.includes("[REQUIRED_MISSING] BETTER_AUTH_SECRET"));
    assert.ok(index > 0);
    assert.match(lines[index + 1], /^ {6}fix: /);
    assert.match(result.stdout, /FAIL\n$/);
});

test("CLI: --json prints { ok, findings: [{ level, code, vars, message, fix }] }", () => {
    const bad = JSON.parse(runCli(localEnv({ BETTER_AUTH_SECRET: "" }), "--json").stdout);
    assert.deepEqual(Object.keys(bad), ["ok", "findings"]);
    assert.equal(bad.ok, false);
    for (const finding of bad.findings) {
        assert.deepEqual(Object.keys(finding), ["level", "code", "vars", "message", "fix"]);
        assert.ok(["error", "warn"].includes(finding.level));
        assert.ok(Array.isArray(finding.vars));
        assert.equal(typeof finding.message, "string");
        assert.equal(typeof finding.fix, "string");
    }
    assert.equal(bad.findings[0].code, "REQUIRED_MISSING");

    const good = runCli(domainEnv(), "--json");
    assert.equal(good.status, 0);
    assert.deepEqual(JSON.parse(good.stdout), { ok: true, findings: [] });
});

test("CLI: without --env-file it reads the process environment", () => {
    const result = spawnSync(process.execPath, [SCRIPT, "--json"], {
        encoding: "utf8",
        env: { PATH: process.env.PATH, ...domainEnv() },
    });
    assert.equal(result.status, 0, result.stdout);
    assert.deepEqual(JSON.parse(result.stdout), { ok: true, findings: [] });
});

test("CLI: an unreadable file fails with a finding; a bad flag exits 2", async t => {
    const clean = { encoding: "utf8", env: { PATH: process.env.PATH } };
    // Node 20.6+ also recognises --env-file after the script name and exits 9
    // itself when the file is missing, before this script runs. Either way the
    // command fails; main() is called directly to cover the script's own path.
    const missing = spawnSync(process.execPath, [SCRIPT, "--env-file", "/nonexistent/.env"], clean);
    assert.ok([1, 9].includes(missing.status), `status ${missing.status}`);

    const printed = [];
    t.mock.method(console, "log", line => printed.push(line));
    assert.equal(await main(["--env-file", "/nonexistent/.env", "--json"]), 1);
    const report = JSON.parse(printed.join("\n"));
    assert.equal(report.ok, false);
    assert.equal(report.findings[0].code, "ENV_FILE_UNREADABLE");

    assert.equal(spawnSync(process.execPath, [SCRIPT, "--nope"], clean).status, 2);
});

// ── Probes (against stand-in services; never a live stack) ───────────

test("signS3Request reproduces the S3 API reference's worked example", () => {
    // "Signature Calculations for the Authorization Header", GET Bucket (List
    // Objects) example. The credentials are the documentation's public ones.
    const headers = signS3Request({
        url: "https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J",
        region: "us-east-1",
        accessKey: "AKIAIOSFODNN7EXAMPLE",
        secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        now: new Date("2013-05-24T00:00:00Z"),
    });
    assert.equal(headers["x-amz-date"], "20130524T000000Z");
    assert.match(
        headers.authorization,
        /Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7$/
    );
});

/** One HTTP server standing in for every service, routed by path. */
async function withStack(overrides, run) {
    const env = localEnv({
        COMPOSE_PROFILES: "whisper,ocr,search",
        TRANSCRIPTION_PROVIDER: "sidecar",
    });
    const basic = `Basic ${Buffer.from(`launchstack:${env.GOTENBERG_SERVICE_PASSWORD}`).toString("base64")}`;
    const routes = {
        "GET /": req =>
            req.headers.authorization?.startsWith(
                `AWS4-HMAC-SHA256 Credential=${env.S3_ACCESS_KEY}/`
            )
                ? 200
                : 403,
        "GET /health": () => 200,
        "GET /healthz": () => 200,
        "GET /readyz": () => 200,
        "GET /api/health": () => 200,
        "GET /gotenberg/health": () => 200,
        "GET /gotenberg/version": req => (req.headers.authorization === basic ? 200 : 401),
        "POST /adeu/accept-all": req =>
            req.headers["x-api-key"] === env.ADEU_SERVICE_API_KEY ? 422 : 401,
        "GET /capabilities": req =>
            req.headers["x-api-key"] === env.DOCUMENT_CONVERTER_API_KEY ? 200 : 401,
        "POST /transcribe": req =>
            req.headers["x-api-key"] === env.TRANSCRIPTION_SERVICE_API_KEY ? 422 : 401,
        ...overrides.routes,
    };
    const server = createServer((req, res) => {
        const handler = routes[`${req.method} ${req.url}`];
        res.writeHead(handler ? handler(req) : 404).end("{}");
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const targets = {
        storage: base,
        adeu: base,
        converter: base,
        gotenberg: `${base}/gotenberg`,
        transcription: base,
        docling: base,
        searxng: base,
        inngest: base,
        worker: base,
        app: base,
        ...overrides.targets,
    };
    // A stand-in for the `postgres` driver: a tagged-template function with .end().
    const loadPostgres =
        overrides.loadPostgres ??
        (async () => () => {
            const sql = async () => [{ available: 1, installed: 1 }];
            sql.end = async () => undefined;
            return sql;
        });
    try {
        return await run(await runProbes({ ...env, ...overrides.env }, { targets, loadPostgres }));
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

test("probes: a healthy stack with matching credentials reports nothing", async () => {
    await withStack({}, findings => assert.deepEqual(findings, []));
});

test("probes: each disagreement names the service and the variable", async () => {
    const stale = {
        S3_SECRET_KEY: hex("aa"),
        S3_ACCESS_KEY: "rotated-access-key-0001",
        ADEU_SERVICE_API_KEY: hex("bb"),
        DOCUMENT_CONVERTER_API_KEY: hex("cc"),
        TRANSCRIPTION_SERVICE_API_KEY: hex("dd"),
        GOTENBERG_SERVICE_PASSWORD: hex("ee"),
    };
    // The stand-ins hold the original values, so the "new" ones are rejected.
    const base = localEnv();
    await withStack(
        {
            env: stale,
            routes: {
                "GET /": req =>
                    req.headers.authorization?.includes(`Credential=${base.S3_ACCESS_KEY}/`)
                        ? 200
                        : 403,
                "GET /gotenberg/version": () => 401,
                "POST /adeu/accept-all": () => 401,
                "GET /capabilities": () => 401,
                "POST /transcribe": () => 401,
            },
        },
        findings => {
            const by = code => findings.filter(f => f.code === code);
            assert.deepEqual(by("PROBE_STORAGE_AUTH")[0].vars, ["S3_ACCESS_KEY", "S3_SECRET_KEY"]);
            assert.deepEqual(
                by("PROBE_KEY_MISMATCH")
                    .map(f => f.vars[0])
                    .sort(),
                [
                    "ADEU_SERVICE_API_KEY",
                    "DOCUMENT_CONVERTER_API_KEY",
                    "GOTENBERG_SERVICE_PASSWORD",
                    "TRANSCRIPTION_SERVICE_API_KEY",
                ]
            );
            assert.match(by("PROBE_KEY_MISMATCH")[0].message, /and this configuration disagree/);
            const rendered = JSON.stringify(findings);
            for (const value of Object.values(stale)) assert.ok(!rendered.includes(value));
        }
    );
});

test("probes: unhealthy, unreachable and database failures are reported", async () => {
    const pgError = code => async () => () => {
        const sql = async () => {
            throw Object.assign(new Error(`password authentication failed for user "postgres"`), {
                code,
            });
        };
        sql.end = async () => undefined;
        return sql;
    };
    await withStack(
        {
            routes: { "GET /api/health": () => 503 },
            targets: { worker: "http://127.0.0.1:1" },
            loadPostgres: pgError("28P01"),
        },
        findings => {
            assert.deepEqual(findings.map(f => f.code).sort(), [
                "PROBE_DB_AUTH",
                "PROBE_UNREACHABLE",
                "PROBE_UNREACHABLE",
            ]);
            assert.ok(findings.some(f => /^app is not healthy: HTTP 503/.test(f.message)));
            assert.ok(findings.some(f => /^worker is not healthy: /.test(f.message)));
            assert.ok(findings.every(f => f.level === "error"));
        }
    );
    await withStack({ loadPostgres: pgError("ECONNREFUSED") }, findings =>
        assert.deepEqual(
            findings.map(f => f.code),
            ["PROBE_DB_UNREACHABLE"]
        )
    );
    await withStack(
        {
            loadPostgres: async () => () => {
                const sql = async () => [{ available: 0, installed: 0 }];
                sql.end = async () => undefined;
                return sql;
            },
        },
        findings =>
            assert.deepEqual(
                findings.map(f => f.code),
                ["PROBE_PGVECTOR_MISSING"]
            )
    );
    await withStack(
        {
            loadPostgres: async () => {
                throw new Error("Cannot find package 'postgres'");
            },
        },
        findings =>
            assert.deepEqual(
                findings.map(f => f.code),
                ["PROBE_DRIVER_MISSING"]
            )
    );
});
