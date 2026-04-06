import {db} from "~/server/db";
import {company, users, companyApiKeys} from "~/server/db/schema";
import {eq} from "drizzle-orm";
import {handleApiError, createSuccessResponse, createValidationError} from "~/lib/api-utils";
import {
    isValidEmbeddingConfig,
    isEmbeddingProvider,
    DEFAULT_EMBEDDING_CONFIG,
    type CompanyEmbeddingConfig,
} from "~/lib/ai/embedding-config";
import { encryptApiKey } from "~/lib/crypto/api-key-encryption";
import { createCompanyEmbeddingTable } from "~/lib/db/company-embeddings";

type PostBody = {
    userId: string;
    companyName: string;
    name: string;
    email: string;
    numberOfEmployees: string;
    embeddingProvider?: string;
    embeddingModel?: string;
    embeddingDimensions?: number;
    providerApiKey?: string;
}

export async function POST(request: Request) {
    try {
        const {userId, name, email, companyName, numberOfEmployees, embeddingProvider, embeddingModel, embeddingDimensions, providerApiKey} = (await request.json()) as PostBody;

        // Validate required fields
        if (!name?.trim()) {
            return createValidationError(
                "User name is required. Please ensure you are logged in with a complete profile."
            );
        }

        // Check if company already exists
        const [existingCompany] = await db
            .select()
            .from(company)
            .where(eq(company.name, companyName));

        if (existingCompany) {
            return createValidationError(
                "Company already exists. Please use a different company name."
            );
        }

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
                name: companyName,
                numberOfEmployees: numberOfEmployees || "0",
                embeddingConfig: embeddingConfig ?? DEFAULT_EMBEDDING_CONFIG,
            })
            .returning({ id: company.id });

        if(!newCompany) {
            console.error("Company creation returned no data. Database insert failed.");
            return createValidationError(
                "Could not create company. Please try again later."
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
            "Company and owner account created successfully."
        );
    }
    catch (error: unknown) {
        console.error("Error during employer company signup:", error);
        if (error instanceof Error) {
            console.error("Error message:", error.message);
            console.error("Error stack:", error.stack);
        }
        return handleApiError(error);
    }
}
