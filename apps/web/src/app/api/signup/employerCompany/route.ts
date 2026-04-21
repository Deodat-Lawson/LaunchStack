import {db} from "~/server/db";
import {company, users} from "@launchstack/core/db/schema";
import {eq} from "drizzle-orm";
import {handleApiError, createSuccessResponse, createValidationError} from "~/lib/api-utils";
import { initTokenAccount, TOKEN_SIGNUP_BONUS } from "~/lib/credits";
import { validateRequestBody, EmployerCompanySignupSchema } from "~/lib/validation";
import { upsertCompanyCredentials } from "@launchstack/core/embeddings";

export async function POST(request: Request) {
    try {
        const validation = await validateRequestBody(request, EmployerCompanySignupSchema);
        if (!validation.success) return validation.response;
        const {
            userId,
            name,
            email,
            companyName,
            numberOfEmployees,
            embeddingIndexKey,
            embeddingOpenAIApiKey,
            embeddingHuggingFaceApiKey,
            embeddingOllamaBaseUrl,
            embeddingOllamaModel,
        } = validation.data;

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

        const [newCompany] = await db
            .insert(company)
            .values({
                name: companyName,
                numberOfEmployees: numberOfEmployees || "0",
                embeddingIndexKey: embeddingIndexKey?.trim() || null,
            })
            .returning({ id: company.id });

        if(!newCompany) {
            console.error("Company creation returned no data. Database insert failed.");
            return createValidationError(
                "Could not create company. Please try again later."
            );
        }

        const companyId = BigInt(newCompany.id);

        // Persist embedding provider credentials into the encrypted table.
        // Empty/null values are skipped so we never write empty ciphertext.
        const credentialsInput: {
            openAIApiKey?: string | null;
            huggingFaceApiKey?: string | null;
            ollamaBaseUrl?: string | null;
            ollamaModel?: string | null;
        } = {};
        if (embeddingOpenAIApiKey?.trim()) {
            credentialsInput.openAIApiKey = embeddingOpenAIApiKey.trim();
        }
        if (embeddingHuggingFaceApiKey?.trim()) {
            credentialsInput.huggingFaceApiKey = embeddingHuggingFaceApiKey.trim();
        }
        if (embeddingOllamaBaseUrl?.trim()) {
            credentialsInput.ollamaBaseUrl = embeddingOllamaBaseUrl.trim();
        }
        if (embeddingOllamaModel?.trim()) {
            credentialsInput.ollamaModel = embeddingOllamaModel.trim();
        }

        if (Object.keys(credentialsInput).length > 0) {
            try {
                await upsertCompanyCredentials(newCompany.id, credentialsInput);
            } catch (credErr) {
                console.error("Failed to persist embedding credentials during signup:", credErr);
                // Fatal — the company row is already created; bubble up so
                // the caller sees the failure and can retry with valid input.
                return handleApiError(credErr);
            }
        }

        await db.insert(users).values({
            userId,
            companyId,
            name,
            email,
            status: "verified",
            role: "owner",
        });

        // Initialize credit account with signup bonus
        await initTokenAccount(companyId, TOKEN_SIGNUP_BONUS);

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
