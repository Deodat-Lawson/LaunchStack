import { db } from "~/server/db";
import { company } from "@launchstack/store/schema";
import { users, userCompanyMemberships } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { handleApiError, createSuccessResponse, createValidationError } from "~/lib/api-utils";
import { ensureTokenAccount } from "~/lib/credits";
import { validateRequestBody, EmployerCompanySignupSchema } from "~/lib/validation";
import { upsertCompanyCredentials, type CredentialUpsertInput } from "@launchstack/llm/embeddings";
import {
    WorkspaceEndpointUrlError,
    assertEndpointUrlAllowed,
} from "~/server/workspace-models/endpoint-url";
import { generateUniqueSlug } from "~/lib/workspace-slug";
import { requireAuthIdentity } from "~/lib/require-workspace-context";

export async function POST(request: Request) {
    try {
        const identity = await requireAuthIdentity();
        if (!identity.success) return identity.response;

        const validation = await validateRequestBody(request, EmployerCompanySignupSchema);
        if (!validation.success) return validation.response;
        const {
            name,
            email,
            companyName,
            numberOfEmployees,
            embeddingIndexKey,
            embeddingOpenAIApiKey,
            embeddingOpenAIBaseUrl,
            embeddingHuggingFaceApiKey,
            embeddingOllamaBaseUrl,
            embeddingOllamaModel,
        } = validation.data;
        const userId = identity.data.authUserId;

        // Names are unique only by this check — the column carries no database
        // constraint. The signup form pre-fills an available suggestion and
        // lets the person edit it, so a conflict here is now something they
        // can see and fix rather than a dead end.
        const [existingCompany] = await db
            .select()
            .from(company)
            .where(eq(company.name, companyName));

        if (existingCompany) {
            return createValidationError(
                "Company already exists. Please use a different company name."
            );
        }

        // A key is only ever sent to the address it was entered with, so one
        // without an address could never be used.
        if (embeddingOpenAIApiKey?.trim() && !embeddingOpenAIBaseUrl?.trim()) {
            return createValidationError(
                "Add the embeddings endpoint URL that goes with the API key."
            );
        }

        // Same address policy as Settings › Processing, checked before the
        // company row exists so a bad address doesn't leave one behind.
        let openAIBaseUrl: string | undefined;
        if (embeddingOpenAIBaseUrl?.trim()) {
            try {
                openAIBaseUrl = await assertEndpointUrlAllowed(embeddingOpenAIBaseUrl);
            } catch (urlErr) {
                if (urlErr instanceof WorkspaceEndpointUrlError) {
                    return createValidationError(urlErr.message);
                }
                throw urlErr;
            }
        }

        const slug = await generateUniqueSlug(companyName);

        const [newCompany] = await db
            .insert(company)
            .values({
                name: companyName,
                slug,
                // `?? ""` first so the `||` default (which must also catch
                // empty strings) operates on a plain string.
                numberOfEmployees: (numberOfEmployees ?? "") || "0",
                embeddingIndexKey: (embeddingIndexKey?.trim() ?? "") || null,
            })
            .returning({ id: company.id });

        if (!newCompany) {
            console.error("Company creation returned no data. Database insert failed.");
            return createValidationError("Could not create company. Please try again later.");
        }

        const companyId = BigInt(newCompany.id);

        // Persist embedding provider credentials into the encrypted table.
        // Empty/null values are skipped so we never write empty ciphertext.
        const credentialsInput: CredentialUpsertInput = {};
        if (embeddingOpenAIApiKey?.trim()) {
            credentialsInput.openAIApiKey = embeddingOpenAIApiKey.trim();
        }
        if (openAIBaseUrl) {
            credentialsInput.openAIBaseUrl = openAIBaseUrl;
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

        const [insertedUser] = await db
            .insert(users)
            .values({
                userId,
                companyId,
                name,
                email,
            })
            .returning({ id: users.id });

        if (insertedUser) {
            await db.insert(userCompanyMemberships).values({
                userId: BigInt(insertedUser.id),
                companyId,
                role: "owner",
                status: "active",
            });
        }

        // Always create the account so usage is recorded from the first
        // document. ensureTokenAccount applies the signup grant only where a
        // balance is enforced — on a self-hosted instance nothing enforces it
        // and nothing can top it up, so a notional 10M would be a number
        // nobody reads.
        await ensureTokenAccount(companyId);

        return createSuccessResponse(
            { userId, role: "owner" },
            "Company and owner account created successfully."
        );
    } catch (error: unknown) {
        console.error("Error during employer company signup:", error);
        if (error instanceof Error) {
            console.error("Error message:", error.message);
            console.error("Error stack:", error.stack);
        }
        return handleApiError(error);
    }
}
