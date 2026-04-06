import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq, and } from "drizzle-orm";

import { db } from "~/server/db";
import { users, company, document, companyApiKeys } from "~/server/db/schema";
import {
    type CompanyEmbeddingConfig,
    type EmbeddingProvider,
    SUPPORTED_EMBEDDING_MODELS,
    DEFAULT_EMBEDDING_CONFIG,
    EMBEDDING_PROVIDERS,
    isValidEmbeddingConfig,
    isEmbeddingProvider,
    resolveEmbeddingConfig,
} from "~/lib/ai/embedding-config";
import {
    createCompanyEmbeddingTable,
    dropCompanyEmbeddingTable,
    companyEmbeddingTableExists,
} from "~/lib/db/company-embeddings";

const AUTHORIZED_ROLES = new Set(["employer", "owner"]);

/**
 * GET /api/company/embedding-config
 * Returns the company's current embedding configuration.
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

        const [companyRow] = await db
            .select({ embeddingConfig: company.embeddingConfig })
            .from(company)
            .where(eq(company.id, Number(userInfo.companyId)));

        const config = resolveEmbeddingConfig(companyRow?.embeddingConfig);

        // Check which providers have stored API keys
        const storedKeys = await db
            .select({ provider: companyApiKeys.provider })
            .from(companyApiKeys)
            .where(eq(companyApiKeys.companyId, userInfo.companyId));
        const connectedProviders = storedKeys.map((k) => k.provider);

        return NextResponse.json({
            config,
            supportedModels: SUPPORTED_EMBEDDING_MODELS,
            connectedProviders,
        });
    } catch (error) {
        console.error("[company/embedding-config] GET error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 },
        );
    }
}

interface PostBody {
    provider: string;
    model: string;
    dimensions: number;
}

/**
 * POST /api/company/embedding-config
 * Updates the company's embedding configuration.
 * Only owner/employer roles can modify this.
 */
export async function POST(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const [userInfo] = await db
            .select({ companyId: users.companyId, role: users.role })
            .from(users)
            .where(eq(users.userId, userId));

        if (!userInfo) {
            return NextResponse.json({ error: "User not found" }, { status: 400 });
        }

        if (!AUTHORIZED_ROLES.has(userInfo.role)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const body = (await request.json()) as PostBody;
        const newConfig: CompanyEmbeddingConfig = {
            provider: body.provider as CompanyEmbeddingConfig["provider"],
            model: body.model,
            dimensions: body.dimensions,
        };

        if (!isValidEmbeddingConfig(newConfig)) {
            return NextResponse.json(
                {
                    error: "Unsupported embedding model",
                    supportedModels: SUPPORTED_EMBEDDING_MODELS,
                },
                { status: 400 },
            );
        }

        // For non-OpenAI providers, check that an API key is stored
        if (newConfig.provider !== "openai") {
            const [keyRow] = await db
                .select({ id: companyApiKeys.id })
                .from(companyApiKeys)
                .where(
                    and(
                        eq(companyApiKeys.companyId, userInfo.companyId),
                        eq(companyApiKeys.provider, newConfig.provider),
                    )
                );
            if (!keyRow) {
                return NextResponse.json(
                    { error: `No API key stored for ${newConfig.provider}. Please add one first.` },
                    { status: 400 },
                );
            }
        }

        // Check if the company has existing documents (warn about model change)
        const [docCount] = await db
            .select({ count: eq(document.companyId, userInfo.companyId) })
            .from(document)
            .where(eq(document.companyId, userInfo.companyId))
            .limit(1);

        const currentConfig = await db
            .select({ embeddingConfig: company.embeddingConfig })
            .from(company)
            .where(eq(company.id, Number(userInfo.companyId)));

        const oldConfig = resolveEmbeddingConfig(currentConfig[0]?.embeddingConfig);
        const modelChanged = oldConfig.model !== newConfig.model;
        const dimensionsChanged = oldConfig.dimensions !== newConfig.dimensions;
        const hasDocuments = !!docCount;

        // Update the company's embedding config
        await db
            .update(company)
            .set({ embeddingConfig: newConfig })
            .where(eq(company.id, Number(userInfo.companyId)));

        // Manage the per-company embedding table
        const companyIdNum = Number(userInfo.companyId);
        if (dimensionsChanged) {
            // Dimensions changed — drop and recreate the table
            await dropCompanyEmbeddingTable(companyIdNum);
            await createCompanyEmbeddingTable(companyIdNum, newConfig.dimensions);
        } else {
            // Ensure the table exists (may be first time setup)
            const exists = await companyEmbeddingTableExists(companyIdNum);
            if (!exists) {
                await createCompanyEmbeddingTable(companyIdNum, newConfig.dimensions);
            }
        }

        return NextResponse.json({
            success: true,
            config: newConfig,
            warning:
                modelChanged && hasDocuments
                    ? "Embedding model changed. Existing documents were embedded with a different model and need to be re-embedded for accurate search results."
                    : undefined,
        });
    } catch (error) {
        console.error("[company/embedding-config] POST error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 },
        );
    }
}
