import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
    APP_URL,
    FIXTURE_FILE,
    CREDENTIALS_FILE,
    assertDatabaseUrl,
    assertRuntimeFile,
    approvedProvider,
    assertApprovedAzureEndpoint,
    demoEnvironment,
} from "./vantage-context-demo-runtime.mjs";
import { childEnvironment } from "./vantage-integration-tl-test.mjs";

const databaseUrl =
    "postgres://vantage_week2_tl:synthetic-test-password@127.0.0.1:55437/vantage_week2_tl_contract_v1";
test("accepts only the existing local TL database, never old/prod targets", () => {
    assert.equal(assertDatabaseUrl(databaseUrl).port, "55437");
    for (const candidate of [
        databaseUrl.replace("127.0.0.1", "database.example.invalid"),
        databaseUrl.replace("55437", "55435"),
        databaseUrl.replace("55437", "55436"),
        databaseUrl.replace("vantage_week2_tl_contract_v1", "production"),
        databaseUrl + "?sslmode=require",
    ])
        assert.throws(() => assertDatabaseUrl(candidate));
});
test("requires explicit approved Azure settings without substituting a model", () => {
    assert.throws(() => approvedProvider({}), /CHAT_BASE_URL/);
    for (const endpoint of [
        "https://openrouter.ai/api/v1/",
        "https://synthetic.openai.azure.com/openai/v1/?api-key=bad",
        "http://synthetic.openai.azure.com/openai/v1/",
    ])
        assert.throws(
            () =>
                approvedProvider({
                    CHAT_BASE_URL: endpoint,
                    CHAT_API_KEY: "synthetic",
                    CHAT_MODELS_CONFIG: "relative.yaml",
                }),
            /approved Azure/
        );
});
test("the tracked credential-free Azure configuration is the default for explicit live mode", () => {
    const provider = approvedProvider({
        CHAT_BASE_URL: "https://synthetic.openai.azure.com/openai/v1/",
        CHAT_API_KEY: "synthetic-only",
    });
    assert.match(provider.CHAT_MODELS_CONFIG, /chat-models\.vantage-demo\.azure\.yaml$/);
    assert.equal(provider.CHAT_API_KEY, "synthetic-only");
});
test("accepts the same Azure v1 resource path with or without a trailing slash", () => {
    for (const endpoint of [
        "https://synthetic.openai.azure.com/openai/v1",
        "https://synthetic.openai.azure.com/openai/v1/",
    ])
        assert.equal(assertApprovedAzureEndpoint(endpoint).hostname, "synthetic.openai.azure.com");
    for (const endpoint of [
        "https://synthetic.openai.azure.com/openai/v2",
        "https://synthetic.openai.azure.com/openai/v1?api-key=synthetic",
        "https://other.example.invalid/openai/v1/",
    ])
        assert.throws(() => assertApprovedAzureEndpoint(endpoint));
});
test("binds native Vantage gate and real BetterAuth origin to the server-owned fixture", () => {
    const base = childEnvironment("synthetic-test-password", {
        PATH: process.env.PATH,
        PRODUCTION_TOKEN: "must-not-inherit",
        AUTH_GOOGLE_CLIENT_SECRET: "must-not-inherit",
    });
    const secret = {
        authSecret: "synthetic-auth-secret",
        loginPassword: "never-in-environment",
        embeddingSecretsKey: "synthetic-key",
    };
    const fixture = { companyId: "123", actorId: "sophia-fixture-owned" };
    const env = demoEnvironment(base, secret, fixture);
    assert.equal(env.NODE_ENV, "development");
    assert.equal(env.BETTER_AUTH_URL, APP_URL);
    assert.equal(env.BETTER_AUTH_SECRET, secret.authSecret);
    assert.equal(env.EMBEDDING_SECRETS_KEY, secret.embeddingSecretsKey);
    assert.equal(env.VANTAGE_TEST_COMPANY_ID, "123");
    assert.equal(env.VANTAGE_TEST_USER_IDS, fixture.actorId);
    assert.equal(env.VANTAGE_CONTEXT_DEMO_FIXTURE, FIXTURE_FILE);
    assert.equal(env.VANTAGE_CONTEXT_DEMO_CREDENTIALS, CREDENTIALS_FILE);
    assert.equal(env.VANTAGE_CONTEXT_DEMO_GENERATION_MODE, "replay");
    assert.equal(env.VANTAGE_TL_TEST_MODE, "true");
    assert.equal(env.GMAIL_CONNECTOR_ENABLED, "false");
    assert.equal(env.GOOGLE_DOCS_EDITING_ENABLED, "false");
    assert.equal(env.EMAIL_SENDING_ENABLED, "false");
    assert.equal(env.CHAT_BASE_URL, "http://127.0.0.1:9/v1");
    assert.equal(env.PRODUCTION_TOKEN, undefined);
    assert.equal(env.AUTH_GOOGLE_CLIENT_SECRET, undefined);
    assert.equal(Object.values(env).includes(secret.loginPassword), false);
});
test("retained fixtures keep their original reporting cutoff", () => {
    const env = demoEnvironment(
        childEnvironment("synthetic-test-password"),
        {
            authSecret: "synthetic-auth-secret",
            embeddingSecretsKey: "synthetic-key",
        },
        { companyId: "123", actorId: "synthetic", weeks: [{ asOf: "2026-10-26T23:59:00.000Z" }] }
    );
    assert.equal(env.VANTAGE_CONTEXT_DEMO_AS_OF, "2026-10-26T23:59:00.000Z");
});
test("explicit portable verification uses separate owned resources and a separate app port", () => {
    const moduleUrl = new URL("./vantage-context-demo-runtime.mjs", import.meta.url).href;
    const tlUrl = new URL("./vantage-integration-tl-test.mjs", import.meta.url).href;
    const result = spawnSync(
        process.execPath,
        [
            "--input-type=module",
            "-e",
            `
        import assert from 'node:assert/strict';
        import {APP_URL, assertDatabaseUrl} from ${JSON.stringify(moduleUrl)};
        import {PROJECT, DATABASE_PORT, LOCAL_ENV, childEnvironment} from ${JSON.stringify(tlUrl)};
        assert.equal(APP_URL, 'http://localhost:3105');
        assert.equal(DATABASE_PORT, 55438);
        assert.equal(PROJECT, 'launchstack-vantage-week2-tl-20261022-portable');
        assert.equal(LOCAL_ENV.includes('test-output') && LOCAL_ENV.endsWith('tl-test.env.local'), true);
        assert.equal(assertDatabaseUrl(childEnvironment('synthetic-password').DATABASE_URL).port, '55438');
        assert.throws(()=>assertDatabaseUrl(childEnvironment('synthetic-password').DATABASE_URL.replace(':55438/', ':55437/')));
    `,
        ],
        {
            env: {
                ...process.env,
                VANTAGE_CONTEXT_DEMO_DB_PORT: "55438",
                VANTAGE_CONTEXT_DEMO_APP_PORT: "3105",
            },
            encoding: "utf8",
            windowsHide: true,
        }
    );
    assert.equal(result.status, 0, result.stderr);
});
test("runtime paths remain ignored and scoped to this checkout", () => {
    assert.equal(assertRuntimeFile(FIXTURE_FILE), FIXTURE_FILE);
    assert.throws(() => assertRuntimeFile("C:/outside/fixture.json"), /checkout/);
});
