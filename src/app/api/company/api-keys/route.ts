import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq, and } from "drizzle-orm";

import { db } from "~/server/db";
import { users, company, companyApiKeys } from "~/server/db/schema";
import { encryptApiKey, decryptApiKey, maskApiKey } from "~/lib/crypto/api-key-encryption";
import {
    isEmbeddingProvider,
    resolveEmbeddingConfig,
    type EmbeddingProvider,
} from "~/lib/ai/embedding-config";
import { getEmbeddingsForCompany } from "~/lib/ai/embedding-factory";

const AUTHORIZED_ROLES = new Set(["employer", "owner"]);

async function getAuthorizedUser(userId: string) {
    const [userInfo] = await db
        .select({ companyId: users.companyId, role: users.role })
        .from(users)
        .where(eq(users.userId, userId));

    if (!userInfo) return null;
    if (!AUTHORIZED_ROLES.has(userInfo.role)) return null;
    return userInfo;
}

/**
 * GET /api/company/api-keys
 * Returns the list of stored API keys (masked) for the company.
 */
export async function GET() {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const [userInfo] = await db
            .select({ companyId: users.companyId })
            .from(users)
            .where(eq(users.userId, userId));

        if (!userInfo) {
            return NextResponse.json({ error: "User not found" }, { status: 400 });
        }

        const keys = await db
            .select({
                provider: companyApiKeys.provider,
                encryptedApiKey: companyApiKeys.encryptedApiKey,
                keyIv: companyApiKeys.keyIv,
                keyTag: companyApiKeys.keyTag,
                label: companyApiKeys.label,
                lastUsedAt: companyApiKeys.lastUsedAt,
                createdAt: companyApiKeys.createdAt,
            })
            .from(companyApiKeys)
            .where(eq(companyApiKeys.companyId, userInfo.companyId));

        const maskedKeys = keys.map((k) => {
            let masked = "****";
            try {
                const plaintext = decryptApiKey(k.encryptedApiKey, k.keyIv, k.keyTag);
                masked = maskApiKey(plaintext);
            } catch {
                // Decryption failed, show generic mask
            }
            return {
                provider: k.provider,
                maskedKey: masked,
                label: k.label,
                lastUsedAt: k.lastUsedAt,
                createdAt: k.createdAt,
            };
        });

        return NextResponse.json({ keys: maskedKeys });
    } catch (error) {
        console.error("[company/api-keys] GET error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 },
        );
    }
}

interface PostBody {
    provider: string;
    apiKey: string;
    label?: string;
}

/**
 * POST /api/company/api-keys
 * Stores or updates an API key for a provider.
 * Validates the key by making a test embedding call.
 */
export async function POST(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userInfo = await getAuthorizedUser(userId);
        if (!userInfo) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const body = (await request.json()) as PostBody;
        const { provider, apiKey, label } = body;

        if (!provider || !apiKey) {
            return NextResponse.json(
                { error: "provider and apiKey are required" },
                { status: 400 },
            );
        }

        if (!isEmbeddingProvider(provider)) {
            return NextResponse.json(
                { error: `Invalid provider: ${provider}` },
                { status: 400 },
            );
        }

        // Validate the API key by making a test embedding call
        try {
            const testConfig = { provider: provider as EmbeddingProvider, model: getDefaultModel(provider as EmbeddingProvider), dimensions: getDefaultDimensions(provider as EmbeddingProvider) };
            const embeddings = getEmbeddingsForCompany(testConfig, apiKey);
            await embeddings.embedQuery("test");
        } catch (testError) {
            const msg = testError instanceof Error ? testError.message : "Unknown error";
            return NextResponse.json(
                { error: `API key validation failed: ${msg}` },
                { status: 400 },
            );
        }

        // Encrypt and store
        const encrypted = encryptApiKey(apiKey);

        // Upsert: delete existing key for this provider, then insert
        await db
            .delete(companyApiKeys)
            .where(
                and(
                    eq(companyApiKeys.companyId, userInfo.companyId),
                    eq(companyApiKeys.provider, provider),
                )
            );

        await db.insert(companyApiKeys).values({
            companyId: userInfo.companyId,
            provider,
            encryptedApiKey: encrypted.ciphertext,
            keyIv: encrypted.iv,
            keyTag: encrypted.tag,
            label: label ?? null,
        });

        return NextResponse.json({
            success: true,
            maskedKey: maskApiKey(apiKey),
        });
    } catch (error) {
        console.error("[company/api-keys] POST error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 },
        );
    }
}

interface DeleteBody {
    provider: string;
}

/**
 * DELETE /api/company/api-keys
 * Removes an API key for a provider.
 * If the deleted key is for the active embedding provider, resets to OpenAI default.
 */
export async function DELETE(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userInfo = await getAuthorizedUser(userId);
        if (!userInfo) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const body = (await request.json()) as DeleteBody;
        const { provider } = body;

        if (!provider) {
            return NextResponse.json(
                { error: "provider is required" },
                { status: 400 },
            );
        }

        await db
            .delete(companyApiKeys)
            .where(
                and(
                    eq(companyApiKeys.companyId, userInfo.companyId),
                    eq(companyApiKeys.provider, provider),
                )
            );

        // If the deleted key was for the active embedding provider, reset to default
        const [companyRow] = await db
            .select({ embeddingConfig: company.embeddingConfig })
            .from(company)
            .where(eq(company.id, Number(userInfo.companyId)));

        const currentConfig = resolveEmbeddingConfig(companyRow?.embeddingConfig);
        if (currentConfig.provider === provider && provider !== "openai") {
            const { DEFAULT_EMBEDDING_CONFIG } = await import("~/lib/ai/embedding-config");
            await db
                .update(company)
                .set({ embeddingConfig: DEFAULT_EMBEDDING_CONFIG })
                .where(eq(company.id, Number(userInfo.companyId)));
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[company/api-keys] DELETE error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 },
        );
    }
}

function getDefaultModel(provider: EmbeddingProvider): string {
    const defaults: Record<EmbeddingProvider, string> = {
        openai: "text-embedding-3-large",
        google: "text-embedding-004",
        cohere: "embed-english-v3.0",
        voyage: "voyage-3",
    };
    return defaults[provider];
}

function getDefaultDimensions(provider: EmbeddingProvider): number {
    const defaults: Record<EmbeddingProvider, number> = {
        openai: 3072,
        google: 768,
        cohere: 1024,
        voyage: 1024,
    };
    return defaults[provider];
}
