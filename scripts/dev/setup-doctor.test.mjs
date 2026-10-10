import assert from "node:assert/strict";
import test from "node:test";

import { assess, isPlaceholderKey, isRealSecret, parseEnv } from "./setup-doctor.mjs";

const readyMachine = {
    platform: "darwin",
    dockerCli: true,
    compose: true,
    daemon: true,
    envExists: true,
    env: {
        DATABASE_URL: "postgresql://postgres:password@localhost:5433/pdr_ai_v2",
        BETTER_AUTH_SECRET: "abcdefghijklmnopqrstuvwxyz012345",
        GOOGLE_AI_API_KEY: "AIza-real-key-value",
        EMBEDDING_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
        EMBEDDING_API_KEY: "AIza-real-key-value",
        DEV_SEED_PASSWORD: "local-dev-password",
    },
    nodeMajor: 22,
    pnpmVersion: "10.15.1",
};

test("parseEnv keeps quoted values and skips comments", () => {
    const env = parseEnv(`
# comment
BETTER_AUTH_SECRET="abc def"
CHAT_API_KEY='AIza...'
EMPTY=
NOT_ASSIGNMENT
`);
    assert.equal(env.BETTER_AUTH_SECRET, "abc def");
    assert.equal(env.CHAT_API_KEY, "AIza...");
    assert.equal(env.EMPTY, "");
    assert.equal(env.NOT_ASSIGNMENT, undefined);
});

test("placeholder secrets and example API keys are not real", () => {
    assert.equal(isRealSecret("BETTER_AUTH_SECRET"), false);
    assert.equal(isRealSecret("short"), false);
    assert.equal(isRealSecret("abcdefghijklmnopqrstuvwxyz012345"), true);
    assert.equal(isPlaceholderKey("AIza..."), true);
    assert.equal(isPlaceholderKey(""), false);
    assert.equal(isPlaceholderKey("AIza-real-key-value"), false);
});

test("a ready Mac with Docker and a real secret has nothing blocking", () => {
    const report = assess(readyMachine);
    assert.deepEqual(report.missing, []);
    assert.ok(report.ok.some(line => line.includes("Docker engine")));
    assert.ok(report.ok.some(line => line.includes("pnpm 10.15.1")));
});

test("missing Docker is blocking and points at the platform installer", () => {
    const mac = assess({ ...readyMachine, dockerCli: false, compose: false, daemon: null });
    assert.ok(mac.missing[0].includes("docs.docker.com/desktop"));
    assert.ok(mac.missing[0].includes("mac-install"));

    const win = assess({
        ...readyMachine,
        platform: "win32",
        dockerCli: false,
        compose: false,
        daemon: null,
    });
    assert.ok(win.missing[0].includes("windows-install"));

    const linux = assess({
        ...readyMachine,
        platform: "linux",
        dockerCli: true,
        compose: true,
        daemon: false,
    });
    assert.ok(linux.missing.some(line => line.includes("daemon")));
});

test("the example .env placeholder secret blocks boot", () => {
    const report = assess({
        ...readyMachine,
        env: { ...readyMachine.env, BETTER_AUTH_SECRET: "BETTER_AUTH_SECRET" },
    });
    assert.ok(report.missing.some(line => line.includes("BETTER_AUTH_SECRET")));
});

test("chat and embeddings are warnings, not blockers", () => {
    const report = assess({
        ...readyMachine,
        env: {
            DATABASE_URL: readyMachine.env.DATABASE_URL,
            BETTER_AUTH_SECRET: readyMachine.env.BETTER_AUTH_SECRET,
            CHAT_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
            CHAT_API_KEY: "AIza...",
        },
    });
    assert.deepEqual(report.missing, []);
    assert.ok(report.warnings.some(line => line.includes("Chat")));
    assert.ok(report.warnings.some(line => line.includes("Embeddings")));
    assert.ok(report.warnings.some(line => line.includes("DEV_SEED_PASSWORD")));
});

test("an AI_BASE_URL pair counts as embeddings without OPENAI_API_KEY", () => {
    const report = assess({
        ...readyMachine,
        env: {
            DATABASE_URL: readyMachine.env.DATABASE_URL,
            BETTER_AUTH_SECRET: readyMachine.env.BETTER_AUTH_SECRET,
            GOOGLE_AI_API_KEY: "AIza-real-key-value",
            AI_BASE_URL: "https://api.openai.com/v1",
            AI_API_KEY: "sk-real-key-value",
        },
    });
    assert.ok(report.ok.some(line => line.includes("embedding endpoint")));
    assert.ok(!report.warnings.some(line => line.includes("Embeddings")));
});

test("a localhost chat URL with no key counts as configured", () => {
    const report = assess({
        ...readyMachine,
        env: {
            ...readyMachine.env,
            GOOGLE_AI_API_KEY: "",
            CHAT_BASE_URL: "http://localhost:11434/v1",
            CHAT_API_KEY: "",
        },
    });
    assert.ok(report.ok.some(line => line.includes("chat endpoint")));
});

test("a missing .env is a single blocker", () => {
    const report = assess({ ...readyMachine, envExists: false, env: {} });
    assert.equal(report.missing.length, 1);
    assert.ok(report.missing[0].includes(".env.example"));
});
