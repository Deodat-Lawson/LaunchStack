import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
    CONTAINER,
    DATABASE,
    DATABASE_PORT,
    PROJECT,
    USER,
    VOLUME,
    assertLocalDockerEndpoint,
    assertOwnedContainer,
    assertOwnedVolume,
    childEnvironment,
    parsePassword,
} from "./vantage-integration-tl-test.mjs";

test("generated local credentials stay outside version control", () => {
    const result = spawnSync(
        "git",
        ["check-ignore", "scripts/dev/vantage-integration-tl.env.local"],
        {
            cwd: fileURLToPath(new URL("../../", import.meta.url)),
            encoding: "utf8",
            windowsHide: true,
        }
    );
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "scripts/dev/vantage-integration-tl.env.local");
});

test("TL rebuild launcher is isolated from the original 55434 contract", () => {
    assert.equal(PROJECT, "launchstack-vantage-week2-tl-20261022");
    assert.equal(DATABASE_PORT, 55437);
    assert.equal(DATABASE, "vantage_week2_tl_contract_v1");
    assert.equal(USER, "vantage_week2_tl");
    assert.equal(CONTAINER, `${PROJECT}-db`);
    assert.equal(VOLUME, `${PROJECT}-data`);
    assert.notEqual(DATABASE_PORT, 55434);
});

test("TL child settings pin the rebuilt database and disable live integrations", () => {
    const env = childEnvironment("local_password_123456", {
        PATH: "path",
        DATABASE_URL: "postgres://business/secret",
        OPENAI_API_KEY: "must-not-cross-boundary",
    });
    const url = new URL(env.DATABASE_URL);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, String(DATABASE_PORT));
    assert.equal(url.pathname, `/${DATABASE}`);
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.EMAIL_SENDING_ENABLED, "false");
    assert.equal(env.GMAIL_CONNECTOR_ENABLED, "false");
    assert.equal(env.PROPOSALS_EXECUTOR, "inline");
    assert.equal(env.CHAT_BASE_URL, "http://127.0.0.1:9/v1");
});

test("TL resource assertions protect the rebuilt project and port", () => {
    assertLocalDockerEndpoint("unix:///var/run/docker.sock");
    const labels = {
        "io.launchstack.tl-test": "contract-v1",
        "com.docker.compose.project": PROJECT,
        "com.docker.compose.service": "db",
    };
    assertOwnedContainer({
        Name: `/${CONTAINER}`,
        Config: {
            Image: "pgvector/pgvector:pg16",
            Labels: labels,
            Env: [`POSTGRES_DB=${DATABASE}`, `POSTGRES_USER=${USER}`],
        },
        HostConfig: {
            PortBindings: {
                "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: String(DATABASE_PORT) }],
            },
        },
        Mounts: [{ Type: "volume", Name: VOLUME, Destination: "/var/lib/postgresql/data" }],
    });
    assertOwnedVolume({
        Name: VOLUME,
        Labels: { ...labels, "com.docker.compose.volume": "tl-data" },
    });
    assert.throws(() => parsePassword("VANTAGE_TL_TEST_PASSWORD=short"));
    assert.equal(
        parsePassword("VANTAGE_TL_TEST_PASSWORD=local_password_123456\n"),
        "local_password_123456"
    );
});
