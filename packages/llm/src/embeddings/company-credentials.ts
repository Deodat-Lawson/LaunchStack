import { eq } from "drizzle-orm";

import { getDb } from "@launchstack/store/client";
import { companyEmbeddingCredentials } from "@launchstack/store/schema";
import { CiphertextDecodeError, decryptSecret, encryptSecret } from "@launchstack/store/crypto";

/**
 * Per-company embedding provider credentials, separated from the rest of
 * the `company` row so the secrets can be (a) kept out of wider row reads
 * and (b) stored encrypted.
 *
 * API keys (OpenAI, Hugging Face) are AES-256-GCM ciphertext. Non-secret
 * config (Ollama base URL / model) is plaintext.
 *
 * This table is the only source of credentials. The legacy plaintext columns
 * that used to live on `company` are gone.
 */

export interface CompanyCredentialsPlaintext {
    openAIApiKey: string | null;
    huggingFaceApiKey: string | null;
    ollamaBaseUrl: string | null;
    ollamaModel: string | null;
}

export interface RedactedCredentials {
    openAI: { hasKey: boolean; last4: string | null };
    huggingFace: { hasKey: boolean; last4: string | null };
    ollamaBaseUrl: string | null;
    ollamaModel: string | null;
}

export interface CredentialUpsertInput {
    /** `undefined` = leave unchanged. `null` or `""` = clear the stored value. */
    openAIApiKey?: string | null;
    huggingFaceApiKey?: string | null;
    ollamaBaseUrl?: string | null;
    ollamaModel?: string | null;
}

function toNumericId(companyId: bigint | number | string): number | null {
    const n = typeof companyId === "bigint" ? Number(companyId) : Number(companyId);
    return Number.isFinite(n) ? n : null;
}

function last4(value: string | null | undefined): string | null {
    if (!value || value.length < 4) return null;
    return value.slice(-4);
}

/**
 * Fetch the decrypted credentials for server-side use (embedding API calls).
 * Callers must never return these strings to the browser or log them.
 *
 * If the ciphertext is present but cannot be decrypted (bad key, corrupt
 * data) we return null for that field and log — silently swallowing would
 * mask rotation bugs.
 */
export async function getCompanyCredentialsPlaintext(
    companyId: bigint | number | string
): Promise<CompanyCredentialsPlaintext | null> {
    const id = toNumericId(companyId);
    if (id === null) return null;

    const [encrypted] = await getDb()
        .select()
        .from(companyEmbeddingCredentials)
        .where(eq(companyEmbeddingCredentials.companyId, id))
        .limit(1);

    if (!encrypted) return null;

    const decryptOrNull = (ciphertext: string | null | undefined): string | null => {
        if (!ciphertext) return null;
        try {
            return decryptSecret(ciphertext);
        } catch (err) {
            if (err instanceof CiphertextDecodeError) {
                console.error(
                    `[company-credentials] Failed to decrypt credential for company ${id}: ${err.message}`
                );
                return null;
            }
            throw err;
        }
    };

    return {
        openAIApiKey: decryptOrNull(encrypted.openAIApiKeyCiphertext),
        huggingFaceApiKey: decryptOrNull(encrypted.huggingFaceApiKeyCiphertext),
        ollamaBaseUrl: encrypted.ollamaBaseUrl ?? null,
        ollamaModel: encrypted.ollamaModel ?? null,
    };
}

/**
 * Fetch a redacted summary safe to return to the browser. Says whether
 * each secret is set and exposes only the last 4 characters.
 */
export async function getRedactedCredentials(
    companyId: bigint | number | string
): Promise<RedactedCredentials> {
    const id = toNumericId(companyId);
    if (id === null) {
        return {
            openAI: { hasKey: false, last4: null },
            huggingFace: { hasKey: false, last4: null },
            ollamaBaseUrl: null,
            ollamaModel: null,
        };
    }

    const [encrypted] = await getDb()
        .select({
            openAIApiKeyCiphertext: companyEmbeddingCredentials.openAIApiKeyCiphertext,
            openAIApiKeyLast4: companyEmbeddingCredentials.openAIApiKeyLast4,
            huggingFaceApiKeyCiphertext: companyEmbeddingCredentials.huggingFaceApiKeyCiphertext,
            huggingFaceApiKeyLast4: companyEmbeddingCredentials.huggingFaceApiKeyLast4,
            ollamaBaseUrl: companyEmbeddingCredentials.ollamaBaseUrl,
            ollamaModel: companyEmbeddingCredentials.ollamaModel,
        })
        .from(companyEmbeddingCredentials)
        .where(eq(companyEmbeddingCredentials.companyId, id))
        .limit(1);

    return {
        openAI: {
            hasKey: Boolean(encrypted?.openAIApiKeyCiphertext),
            last4: encrypted?.openAIApiKeyLast4 ?? null,
        },
        huggingFace: {
            hasKey: Boolean(encrypted?.huggingFaceApiKeyCiphertext),
            last4: encrypted?.huggingFaceApiKeyLast4 ?? null,
        },
        ollamaBaseUrl: encrypted?.ollamaBaseUrl ?? null,
        ollamaModel: encrypted?.ollamaModel ?? null,
    };
}

/**
 * Upsert credentials for a company. Fields set to `undefined` are left
 * alone; fields set to `null` or empty string are cleared.
 */
export async function upsertCompanyCredentials(
    companyId: bigint | number | string,
    input: CredentialUpsertInput
): Promise<void> {
    const id = toNumericId(companyId);
    if (id === null) {
        throw new Error(`upsertCompanyCredentials: invalid companyId ${String(companyId)}`);
    }

    const patch: Partial<typeof companyEmbeddingCredentials.$inferInsert> = {};
    let hasEncryptedChange = false;

    if (input.openAIApiKey !== undefined) {
        if (input.openAIApiKey === null || input.openAIApiKey === "") {
            patch.openAIApiKeyCiphertext = null;
            patch.openAIApiKeyLast4 = null;
        } else {
            const { ciphertext } = encryptSecret(input.openAIApiKey);
            patch.openAIApiKeyCiphertext = ciphertext;
            patch.openAIApiKeyLast4 = last4(input.openAIApiKey);
            hasEncryptedChange = true;
        }
    }

    if (input.huggingFaceApiKey !== undefined) {
        if (input.huggingFaceApiKey === null || input.huggingFaceApiKey === "") {
            patch.huggingFaceApiKeyCiphertext = null;
            patch.huggingFaceApiKeyLast4 = null;
        } else {
            const { ciphertext } = encryptSecret(input.huggingFaceApiKey);
            patch.huggingFaceApiKeyCiphertext = ciphertext;
            patch.huggingFaceApiKeyLast4 = last4(input.huggingFaceApiKey);
            hasEncryptedChange = true;
        }
    }

    if (input.ollamaBaseUrl !== undefined) {
        patch.ollamaBaseUrl =
            input.ollamaBaseUrl && input.ollamaBaseUrl.trim().length > 0
                ? input.ollamaBaseUrl.trim()
                : null;
    }

    if (input.ollamaModel !== undefined) {
        patch.ollamaModel =
            input.ollamaModel && input.ollamaModel.trim().length > 0
                ? input.ollamaModel.trim()
                : null;
    }

    if (Object.keys(patch).length === 0) {
        return;
    }

    patch.updatedAt = new Date();
    if (hasEncryptedChange) patch.encryptionKeyVersion = 1;

    await getDb()
        .insert(companyEmbeddingCredentials)
        .values({ companyId: id, ...patch })
        .onConflictDoUpdate({
            target: companyEmbeddingCredentials.companyId,
            set: patch,
        });
}
