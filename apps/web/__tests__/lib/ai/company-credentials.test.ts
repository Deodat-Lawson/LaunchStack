/**
 * A workspace's OpenAI-compatible embeddings key is only usable with the
 * endpoint it belongs to: `resolveEffectiveEmbeddingConfig` never pairs a
 * company key with the deployment's URL. These cover the URL's trip through
 * the credentials table and into the effective config. The DB is mocked; the
 * secret box is real.
 */

import { randomBytes } from "node:crypto";

import { configureDatabase, type DbClient } from "@launchstack/store/client";
import { configureSecretBox, decryptSecret, encryptSecret } from "@launchstack/store/crypto";
import {
    configureCompanyEmbeddingDefaults,
    getCompanyCredentialsPlaintext,
    getCompanyEmbeddingConfig,
    getRedactedCredentials,
    resolveEffectiveEmbeddingConfig,
    upsertCompanyCredentials,
} from "@launchstack/llm/embeddings";

const selectMock = jest.fn();
const insertMock = jest.fn();
configureDatabase({ select: selectMock, insert: insertMock } as unknown as DbClient);

beforeAll(() => configureSecretBox({ key: randomBytes(32).toString("base64") }));

/** select(...).from(...).where(...).limit(1) resolving to `rows`. */
function selectChain(rows: unknown[]) {
    return {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(rows),
    };
}

/** insert(...).values(...).onConflictDoUpdate(...) capturing what was written. */
function captureUpsert() {
    const values = jest.fn().mockReturnThis();
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    insertMock.mockReturnValueOnce({ values, onConflictDoUpdate });
    return { values, onConflictDoUpdate };
}

function credentialsRow(overrides: Record<string, unknown> = {}) {
    return {
        companyId: 7,
        openAIApiKeyCiphertext: encryptSecret("sk-tenant-1234").ciphertext,
        openAIApiKeyLast4: "1234",
        openAIBaseUrl: "https://embeddings.tenant.example/v1",
        huggingFaceApiKeyCiphertext: null,
        huggingFaceApiKeyLast4: null,
        ollamaBaseUrl: null,
        ollamaModel: null,
        encryptionKeyVersion: 1,
        updatedAt: new Date(),
        ...overrides,
    };
}

describe("company embedding credentials: the endpoint URL", () => {
    beforeEach(() => jest.clearAllMocks());

    it("returns the stored URL beside the decrypted key", async () => {
        selectMock.mockReturnValueOnce(selectChain([credentialsRow()]));

        const creds = await getCompanyCredentialsPlaintext(7);

        expect(creds).toMatchObject({
            openAIApiKey: "sk-tenant-1234",
            openAIBaseUrl: "https://embeddings.tenant.example/v1",
        });
    });

    it("returns the URL whole in the redacted view; it is not a secret", async () => {
        selectMock.mockReturnValueOnce(selectChain([credentialsRow()]));

        const redacted = await getRedactedCredentials(7);

        expect(redacted.openAI).toEqual({ hasKey: true, last4: "1234" });
        expect(redacted.openAIBaseUrl).toBe("https://embeddings.tenant.example/v1");
        expect(JSON.stringify(redacted)).not.toContain("sk-tenant");
    });

    it("redacted view of a key with no URL says so", async () => {
        selectMock.mockReturnValueOnce(selectChain([credentialsRow({ openAIBaseUrl: null })]));

        const redacted = await getRedactedCredentials(7);

        expect(redacted.openAI.hasKey).toBe(true);
        expect(redacted.openAIBaseUrl).toBeNull();
    });

    it("upsert writes a trimmed URL in plaintext beside the encrypted key", async () => {
        const { values, onConflictDoUpdate } = captureUpsert();

        await upsertCompanyCredentials(7, {
            openAIApiKey: "sk-new-9876",
            openAIBaseUrl: "  https://api.openai.com/v1  ",
        });

        const written = values.mock.calls[0]![0] as Record<string, unknown>;
        expect(written.openAIBaseUrl).toBe("https://api.openai.com/v1");
        expect(decryptSecret(written.openAIApiKeyCiphertext as string)).toBe("sk-new-9876");
        const set = (onConflictDoUpdate.mock.calls[0]![0] as { set: Record<string, unknown> }).set;
        expect(set.openAIBaseUrl).toBe("https://api.openai.com/v1");
    });

    it("upsert leaves the URL alone when it is undefined", async () => {
        const { values } = captureUpsert();

        await upsertCompanyCredentials(7, { ollamaModel: "nomic-embed-text" });

        expect(values.mock.calls[0]![0]).not.toHaveProperty("openAIBaseUrl");
    });

    it.each([null, "", "   "])("upsert clears the URL for %p", async cleared => {
        const { values } = captureUpsert();

        await upsertCompanyCredentials(7, { openAIBaseUrl: cleared });

        expect((values.mock.calls[0]![0] as Record<string, unknown>).openAIBaseUrl).toBeNull();
    });
});

describe("getCompanyEmbeddingConfig carries the URL to the embedder", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // The deployment has its own pair; a company key must never borrow its URL.
        configureCompanyEmbeddingDefaults({
            embeddingIndexKey: "legacy-openai-1536",
            openAIApiKey: "deployment-key",
            openAIBaseUrl: "https://deployment.example/v1",
        });
        // The company row is selected with an explicit projection; the
        // credentials row without one.
        selectMock.mockImplementation((projection?: unknown) =>
            projection
                ? selectChain([{ activeIndexKey: "legacy-openai-1536", legacyIndexKey: null }])
                : selectChain([credentialsRow()])
        );
    });

    it("returns the company's URL with its key", async () => {
        const config = await getCompanyEmbeddingConfig(7);

        expect(config).toMatchObject({
            embeddingIndexKey: "legacy-openai-1536",
            openAIApiKey: "sk-tenant-1234",
            openAIBaseUrl: "https://embeddings.tenant.example/v1",
        });
    });

    it("so the effective config sends the company key to the company's endpoint", async () => {
        const effective = resolveEffectiveEmbeddingConfig(
            (await getCompanyEmbeddingConfig(7)) ?? undefined
        );

        expect(effective.openAIApiKey).toBe("sk-tenant-1234");
        expect(effective.openAIBaseUrl).toBe("https://embeddings.tenant.example/v1");
    });

    it("a key stored without a URL still never reaches the deployment's endpoint", async () => {
        selectMock.mockImplementation((projection?: unknown) =>
            projection
                ? selectChain([{ activeIndexKey: "legacy-openai-1536", legacyIndexKey: null }])
                : selectChain([credentialsRow({ openAIBaseUrl: null })])
        );

        const effective = resolveEffectiveEmbeddingConfig(
            (await getCompanyEmbeddingConfig(7)) ?? undefined
        );

        expect(effective.openAIApiKey).toBe("sk-tenant-1234");
        expect(effective.openAIBaseUrl).toBeUndefined();
    });
});
