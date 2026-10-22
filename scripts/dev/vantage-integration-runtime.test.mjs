import assert from "node:assert/strict";
import { test } from "node:test";
import {
    ACCOUNTS,
    APP_HOST,
    APP_PORT,
    APP_URL,
    CONTAINER,
    DATABASE,
    DATABASE_HOST,
    DATABASE_PORT,
    DATABASE_USER,
    FIXTURE_FOLLOWING_WEEK_START,
    FIXTURE_MAIN_EVIDENCE_DATE,
    FIXTURE_WEEK_START,
    PROJECT,
    VOLUME,
    assertAppUrl,
    assertDatabaseUrl,
    assertLocalDockerEndpoint,
    assertOwnedContainer,
    assertOwnedVolume,
    accountsFor,
    childEnvironment,
    composePluginCandidates,
    createRunNamespace,
    discoverComposePlugin,
    fixtureIdsFor,
    isSafeRunNamespace,
    isFixtureWeekDate,
    workspaceSlugsFor,
} from "./vantage-integration-runtime.mjs";

const password = "a".repeat(48);
const databaseUrl = `postgres://${DATABASE_USER}:${password}@${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE}`;

test("rebuild runtime uses independent resources and one localhost auth origin", () => {
    assert.equal(PROJECT, "vantage-week2-rebuild-20261022");
    assert.equal(CONTAINER, "vantage-week2-rebuild-20261022-db");
    assert.equal(VOLUME, "vantage-week2-rebuild-20261022-data");
    assert.equal(DATABASE_PORT, 55436);
    assert.equal(APP_URL, "http://localhost:3103");
    assert.equal(APP_HOST, "localhost");
    assert.equal(APP_PORT, 3103);
    assert.equal(ACCOUNTS.length, 3);
    assert.notEqual(
        databaseUrl,
        "postgres://vantage_integration_e2e:password@127.0.0.1:55435/vantage_integration_e2e_20261019"
    );
});

test("database and app origin assertions reject the old demo or mixed auth origins", () => {
    assertDatabaseUrl(databaseUrl);
    assertAppUrl(APP_URL);
    for (const candidate of [
        "postgres://vantage_integration_e2e:password@127.0.0.1:55435/vantage_integration_e2e_20261019",
        `postgres://${DATABASE_USER}:${password}@localhost:${DATABASE_PORT}/${DATABASE}`,
    ])
        assert.throws(() => assertDatabaseUrl(candidate));
    for (const candidate of [
        "http://127.0.0.1:3103",
        "http://localhost:3102",
        "https://localhost:3103",
    ])
        assert.throws(() => assertAppUrl(candidate));
});

test("child environment pins database and auth origins while dropping inherited provider values", () => {
    const env = childEnvironment(
        {
            databaseUrl,
            databasePassword: password,
            authSecret: "b".repeat(64),
            companyId: "42",
            appUrl: APP_URL,
        },
        {
            PATH: "path",
            DATABASE_URL: "postgres://business/secret",
            BETTER_AUTH_URL: "http://127.0.0.1:3010",
            OPENAI_API_KEY: "must-not-cross-boundary",
            KEEP_ME: "not in system allowlist",
        }
    );
    assert.equal(env.DATABASE_URL, databaseUrl);
    assert.equal(env.MIGRATE_DATABASE_URL, databaseUrl);
    assert.equal(env.BETTER_AUTH_URL, APP_URL);
    assert.equal(env.APP_PUBLIC_URL, APP_URL);
    assert.equal(env.VANTAGE_TEST_USER_IDS, ACCOUNTS[0].id);
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.KEEP_ME, undefined);
    assert.equal(env.GMAIL_CONNECTOR_ENABLED, "false");
    assert.equal(env.PROPOSALS_EXECUTOR, "inline");
    assert.equal(env.CHAT_BASE_URL, "http://127.0.0.1:9/v1");
});

test("namespaced fresh runs derive stable isolated identities and fixtures", () => {
    const config = { runNamespace: "r0123456789abcdef" };
    const accounts = accountsFor(config);
    const repeatedAccounts = accountsFor(config);
    const fixtures = fixtureIdsFor(config);
    assert.equal(isSafeRunNamespace(config.runNamespace), true);
    assert.equal(isSafeRunNamespace("r0123456789abcde"), false);
    assert.equal(isSafeRunNamespace("R0123456789abcdef"), false);
    assert.deepEqual(accounts, repeatedAccounts);
    assert.equal(new Set(accounts.map(account => account.id)).size, 3);
    assert.equal(new Set(accounts.map(account => account.email)).size, 3);
    const slugs = workspaceSlugsFor(config);
    assert.deepEqual(slugs, workspaceSlugsFor(config));
    assert.notDeepEqual(accounts, ACCOUNTS);
    assert.notDeepEqual(fixtures, fixtureIdsFor({}));
    assert.match(fixtures.evidence, /vantage-0123456789abcdef/);
    assert.ok(Object.values(fixtures).every(value => value.length <= 64));
    assert.ok(Object.values(slugs).every(value => value.length <= 64));
    assert.ok(accounts.every(account => account.id.length <= 64 && account.email.length <= 64));
    assert.equal(createRunNamespace().length, 17);
    assert.match(createRunNamespace(), /^r[0-9a-f]{16}$/);
});

test("legacy runtime configs remain compatible with the original synthetic namespace", () => {
    assert.deepEqual(accountsFor({}), ACCOUNTS);
    assert.deepEqual(workspaceSlugsFor({}), {
        primary: "vantage-week2-rebuild-20261022",
        outside: "vantage-week2-outside-20261022",
    });
    assert.deepEqual(fixtureIdsFor({}), {
        evidence: "integration-interview-main-20261022",
        oldEvidence: "integration-interview-old-20261001",
        evidenceFiller: "integration-filler-evidence",
        definition: "integration-signups-definition",
        observation: "integration-signups-main-20261018",
        oldObservation: "integration-signups-old-20260920",
        previousObservation: "integration-signups-previous-20261011",
        observationFiller: "integration-filler-observation",
    });
});

test("main evidence fixture date belongs to the seeded agenda week", () => {
    assert.equal(FIXTURE_WEEK_START, "2026-10-12");
    assert.equal(FIXTURE_FOLLOWING_WEEK_START, "2026-10-19");
    assert.equal(FIXTURE_MAIN_EVIDENCE_DATE, "2026-10-18");
    assert.equal(isFixtureWeekDate(FIXTURE_MAIN_EVIDENCE_DATE), true);
    assert.equal(isFixtureWeekDate(FIXTURE_FOLLOWING_WEEK_START), false);
    assert.equal(isFixtureWeekDate("2026-10-10"), false);
});

test("child environment uses the configured fresh namespace subject", () => {
    const config = {
        ...{
            databaseUrl,
            databasePassword: password,
            authSecret: "b".repeat(64),
            companyId: "42",
            appUrl: APP_URL,
        },
        runNamespace: "r0123456789abcdef",
    };
    assert.equal(childEnvironment(config).VANTAGE_TEST_USER_IDS, accountsFor(config)[0].id);
});

test("compose discovery checks per-user, machine-wide and explicit plugin paths", () => {
    const inherited = {
        DOCKER_COMPOSE_PLUGIN_DIR: "C:/explicit/compose",
        LOCALAPPDATA: "C:/Users/test/AppData/Local",
        PROGRAMFILES: "C:/Program Files",
        "PROGRAMFILES(X86)": "C:/Program Files (x86)",
        USERPROFILE: "C:/Users/test",
    };
    const candidates = composePluginCandidates(inherited);
    assert.equal(candidates[0], "C:/explicit/compose");
    assert.ok(candidates.some(candidate => candidate.includes("C:\\Program Files")));
    assert.equal(
        discoverComposePlugin(
            inherited,
            file =>
                file.replaceAll("/", "\\") ===
                "C:\\Program Files\\Docker\\Docker\\resources\\cli-plugins\\docker-compose.exe"
        ),
        "C:\\Program Files\\Docker\\Docker\\resources\\cli-plugins"
    );
    assert.equal(
        discoverComposePlugin(inherited, () => false),
        null
    );
});

test("owned container and volume assertions pin the rebuild port and names", () => {
    assertLocalDockerEndpoint("npipe:////./pipe/dockerDesktopLinuxEngine");
    const labels = {
        "io.launchstack.integration-e2e": PROJECT,
        "com.docker.compose.project": PROJECT,
        "com.docker.compose.service": "db",
    };
    assertOwnedContainer({
        Name: `/${CONTAINER}`,
        Config: {
            Image: "pgvector/pgvector:pg16",
            Labels: labels,
            Env: [`POSTGRES_DB=${DATABASE}`, `POSTGRES_USER=${DATABASE_USER}`],
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
        Labels: { ...labels, "com.docker.compose.volume": "integration-data" },
    });
    assert.throws(() =>
        assertOwnedContainer({
            Name: `/${CONTAINER}`,
            Config: {
                Image: "pgvector/pgvector:pg16",
                Labels: labels,
                Env: [`POSTGRES_DB=${DATABASE}`, `POSTGRES_USER=${DATABASE_USER}`],
            },
            HostConfig: {
                PortBindings: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55435" }] },
            },
            Mounts: [{ Type: "volume", Name: VOLUME, Destination: "/var/lib/postgresql/data" }],
        })
    );
});
