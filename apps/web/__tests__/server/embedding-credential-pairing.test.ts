import {
    configureCompanyEmbeddingDefaults,
    resolveEffectiveEmbeddingConfig,
} from "@launchstack/core/embeddings";

/**
 * A credential and the endpoint it is sent to must come from the same source.
 *
 * These used to be backstopped by a hardcoded `https://api.openai.com/v1`
 * default, so a key that arrived without a URL still reached its own vendor.
 * That default is gone, which makes independent resolution unsafe: a company's
 * key falling through to the deployment's URL would post a credential to whatever
 * provider the operator configured globally.
 */
describe("embedding credential/endpoint pairing", () => {
    const deployment = {
        embeddingIndexKey: "legacy-openai-1536",
        openAIApiKey: "deployment-key",
        openAIBaseUrl: "https://api.siliconflow.cn/v1",
    };

    beforeEach(() => configureCompanyEmbeddingDefaults(deployment));

    it("uses the deployment pair when the company overrides nothing", () => {
        const effective = resolveEffectiveEmbeddingConfig({});
        expect(effective.openAIApiKey).toBe("deployment-key");
        expect(effective.openAIBaseUrl).toBe("https://api.siliconflow.cn/v1");
    });

    it("never sends a company key to the deployment's endpoint", () => {
        const effective = resolveEffectiveEmbeddingConfig({
            openAIApiKey: "tenant-openai-key",
        });

        expect(effective.openAIApiKey).toBe("tenant-openai-key");
        // The deployment URL must NOT be borrowed. Absent a URL of its own the
        // request fails in generateEmbeddings, which is the safe outcome: the key
        // is never transmitted anywhere.
        expect(effective.openAIBaseUrl).toBeUndefined();
    });

    it("keeps a company pair together when the company supplies both", () => {
        const effective = resolveEffectiveEmbeddingConfig({
            openAIApiKey: "tenant-openai-key",
            openAIBaseUrl: "https://api.openai.com/v1",
        });

        expect(effective.openAIApiKey).toBe("tenant-openai-key");
        expect(effective.openAIBaseUrl).toBe("https://api.openai.com/v1");
    });

    it("does not let a company base URL adopt the deployment's key", () => {
        // The mirror case: a URL without a credential must not pick up the
        // deployment credential either.
        const effective = resolveEffectiveEmbeddingConfig({
            openAIBaseUrl: "https://tenant.example/v1",
        });

        expect(effective.openAIApiKey).toBe("deployment-key");
        expect(effective.openAIBaseUrl).toBe("https://api.siliconflow.cn/v1");
    });
});
