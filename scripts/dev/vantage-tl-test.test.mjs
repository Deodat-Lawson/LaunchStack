import assert from "node:assert/strict";
import { test } from "node:test";
import {
    assertLocalDockerEndpoint,
    assertOwnedContainer,
    assertOwnedVolume,
    childEnvironment,
    parsePassword,
} from "./vantage-tl-test.mjs";

const labels = {
    "io.launchstack.tl-test": "contract-v1",
    "com.docker.compose.project": "launchstack-vantage-tl",
};
const container = () => ({
    Name: "/launchstack-vantage-tl-db",
    Config: {
        Image: "pgvector/pgvector:pg16",
        Labels: { ...labels, "com.docker.compose.service": "db" },
        Env: ["POSTGRES_DB=vantage_tl_contract_v1", "POSTGRES_USER=vantage_tl"],
    },
    HostConfig: { PortBindings: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55434" }] } },
    Mounts: [
        {
            Type: "volume",
            Name: "launchstack-vantage-tl-data",
            Destination: "/var/lib/postgresql/data",
        },
    ],
});
test("pins migration and test targets despite unrelated inherited URLs, without mutating the parent", () => {
    const original = {
        DATABASE_URL: "postgres://external/business",
        MIGRATE_DATABASE_URL: "postgres://external/override",
        VANTAGE_TL_TEST_DATABASE_URL: "postgres://external/tests",
        KEEP_ME: "unchanged",
        NODE_ENV: "production",
        COMPOSE_REMOVE_ORPHANS: "1",
    };
    const result = childEnvironment("local_password_123456", original);
    for (const key of [
        "DATABASE_URL",
        "MIGRATE_DATABASE_URL",
        "VANTAGE_TL_TEST_DATABASE_URL",
        "VANTAGE_TEST_DATABASE_URL",
    ]) {
        const url = new URL(result[key]);
        assert.equal(url.hostname, "127.0.0.1");
        assert.equal(url.port, "55434");
        assert.equal(url.pathname, "/vantage_tl_contract_v1");
    }
    assert.equal(original.MIGRATE_DATABASE_URL, "postgres://external/override");
    assert.equal(result.KEEP_ME, "unchanged");
    assert.equal(result.NODE_ENV, "test");
    assert.equal(result.COMPOSE_REMOVE_ORPHANS, "false");
});
test("accepts only local Docker socket transports", () => {
    assertLocalDockerEndpoint("npipe:////./pipe/dockerDesktopLinuxEngine");
    assertLocalDockerEndpoint("unix:///var/run/docker.sock");
    for (const remote of [
        "ssh://remote",
        "tcp://remote:2376",
        "npipe:////other-computer/pipe/docker_engine",
        undefined,
    ])
        assert.throws(() => assertLocalDockerEndpoint(remote), /local/);
});
test("rejects unrelated resources, exposed ports and foreign data mounts", () => {
    assertOwnedContainer(container());
    for (const mutate of [
        c => {
            c.Config.Labels = {};
        },
        c => {
            c.HostConfig.PortBindings["5432/tcp"][0].HostIp = "0.0.0.0";
        },
        c => {
            c.Mounts[0].Name = "business-data";
        },
        c => {
            c.Config.Env[0] = "POSTGRES_DB=business";
        },
    ]) {
        const bad = container();
        mutate(bad);
        assert.throws(() => assertOwnedContainer(bad));
    }
    const volume = {
        Name: "launchstack-vantage-tl-data",
        Labels: { ...labels, "com.docker.compose.volume": "tl-data" },
    };
    assertOwnedVolume(volume);
    assert.throws(() => assertOwnedVolume({ ...volume, Labels: {} }));
});
test("local settings cannot redirect the database or load arbitrary shell/environment values", () => {
    assert.equal(parsePassword("# defaults\nVANTAGE_TL_TEST_PASSWORD=\n"), "");
    assert.equal(
        parsePassword("VANTAGE_TL_TEST_PASSWORD=local_password_123456\r\n"),
        "local_password_123456"
    );
    for (const text of [
        "DATABASE_URL=postgres://external/business",
        "VANTAGE_TL_TEST_PASSWORD=short",
        "VANTAGE_TL_TEST_PASSWORD=$(command)",
    ])
        assert.throws(() => parsePassword(text));
});
