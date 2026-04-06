import { db } from "~/server/db";
import { company, users, companyApiKeys } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import {
    handleApiError,
    createSuccessResponse,
    createValidationError,
} from "~/lib/api-utils";
import {
    isValidEmbeddingConfig,
    DEFAULT_EMBEDDING_CONFIG,
    type CompanyEmbeddingConfig,
} from "~/lib/ai/embedding-config";
import { encryptApiKey } from "~/lib/crypto/api-key-encryption";
import { createCompanyEmbeddingTable } from "~/lib/db/company-embeddings";

type PostBody = {
    userId: string;
    name: string;
    email: string;
    embeddingProvider?: string;
    embeddingModel?: string;
    embeddingDimensions?: number;
    providerApiKey?: string;
};

export async function POST(request: Request) {
    try {
        const { userId, name, email, embeddingProvider, embeddingModel, embeddingDimensions, providerApiKey } = (await request.json()) as PostBody;

        if (!name?.trim()) {
            return createValidationError(
                "User name is required. Please ensure you are logged in with a complete profile.",
            );
        }

        // Check if user already exists
        const [existingUser] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.userId, userId));

        if (existingUser) {
            return createValidationError(
                "You are already registered. Please sign in instead.",
            );
        }

        const workspaceName = `${name}'s Workspace`;

        // Build embedding config if provided
        let embeddingConfig: CompanyEmbeddingConfig | undefined;
        if (embeddingProvider && embeddingModel && embeddingDimensions) {
            const cfg: CompanyEmbeddingConfig = {
                provider: embeddingProvider as CompanyEmbeddingConfig["provider"],
                model: embeddingModel,
                dimensions: embeddingDimensions,
            };
            if (isValidEmbeddingConfig(cfg)) {
                embeddingConfig = cfg;
            }
        }

        const [newCompany] = await db
            .insert(company)
            .values({
                name: workspaceName,
                type: "personal",
                numberOfEmployees: "1",
                embeddingConfig: embeddingConfig ?? DEFAULT_EMBEDDING_CONFIG,
            })
            .returning({ id: company.id });

        if (!newCompany) {
            return createValidationError(
                "Could not create workspace. Please try again later.",
            );
        }

        const companyId = BigInt(newCompany.id);

        await db.insert(users).values({
            userId,
            companyId,
            name,
            email,
            status: "verified",
            role: "owner",
        });

        // Store API key if provided
        if (providerApiKey && embeddingConfig) {
            const encrypted = encryptApiKey(providerApiKey);
            await db.insert(companyApiKeys).values({
                companyId,
                provider: embeddingConfig.provider,
                encryptedApiKey: encrypted.ciphertext,
                keyIv: encrypted.iv,
                keyTag: encrypted.tag,
            });
        }

        // Create per-company embedding table
        const resolvedConfig = embeddingConfig ?? DEFAULT_EMBEDDING_CONFIG;
        await createCompanyEmbeddingTable(Number(companyId), resolvedConfig.dimensions);

        return createSuccessResponse(
            { userId, role: "owner" },
            "Personal workspace created successfully.",
        );
    } catch (error: unknown) {
        console.error("Error during solo workspace signup:", error);
        return handleApiError(error);
    }
}
