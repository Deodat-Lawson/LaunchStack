import assert from "node:assert/strict";
import test from "node:test";
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
    assert.equal(env.VANTAGE_TL_TEST_MODE, "true");
    assert.equal(env.GMAIL_CONNECTOR_ENABLED, "false");
    assert.equal(env.GOOGLE_DOCS_EDITING_ENABLED, "false");
    assert.equal(env.EMAIL_SENDING_ENABLED, "false");
    assert.equal(env.CHAT_BASE_URL, "http://127.0.0.1:9/v1");
    assert.equal(env.PRODUCTION_TOKEN, undefined);
    assert.equal(env.AUTH_GOOGLE_CLIENT_SECRET, undefined);
    assert.equal(Object.values(env).includes(secret.loginPassword), false);
});
test("runtime paths remain ignored and scoped to this checkout", () => {
    assert.equal(assertRuntimeFile(FIXTURE_FILE), FIXTURE_FILE);
    assert.throws(() => assertRuntimeFile("C:/outside/fixture.json"), /checkout/);
});
