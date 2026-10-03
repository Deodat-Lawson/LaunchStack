/**
 * Request shapes for the workspace model routes, and the one rule they share:
 * a stored key is only ever sent to the address it was saved with. Testing or
 * listing a *different* address needs the key typed again, so a saved key
 * can't be pointed at a server someone else chose.
 */

import { z } from "zod";

import { MODEL_PROVIDER_IDS } from "~/lib/ai/model-providers";
import type { WorkspaceModelSelection } from "~/server/db/schema/workspace-models";

import { assertEndpointUrlAllowed } from "./endpoint-url";
import type { EndpointCandidate } from "./probe";
import { getWorkspaceEndpointRow, readWorkspaceEndpointKey } from "./store";

const choiceSchema = z
    .object({
        id: z.string().trim().min(1).max(200),
        vision: z.boolean(),
        reasoning: z.boolean(),
        structuredOutput: z.boolean().optional(),
    })
    .strict();

export const selectionSchema = z
    .object({
        default: choiceSchema,
        fast: choiceSchema.optional(),
        reasoning: choiceSchema.optional(),
        vision: choiceSchema.optional(),
    })
    .strict() satisfies z.ZodType<WorkspaceModelSelection>;

/** `apiKey` absent = keep or reuse the stored key; `null` = keyless. */
const endpointFields = {
    provider: z.enum(MODEL_PROVIDER_IDS),
    baseUrl: z.string().max(2000),
    apiKey: z.string().max(4000).nullable().optional(),
};

export const saveEndpointSchema = z
    .object({ ...endpointFields, models: selectionSchema.nullable() })
    .strict();

export const testEndpointSchema = z.object({ ...endpointFields, models: selectionSchema }).strict();

export const listModelsSchema = z.object(endpointFields).strict();

export class StoredKeyMismatchError extends Error {
    constructor() {
        super(
            "Enter the API key for this address. A saved key is only sent to the address it was saved with."
        );
        this.name = "StoredKeyMismatchError";
    }
}

/**
 * The address and key a test or listing should use. A typed key wins; with
 * none typed, the stored key is used only for the stored address.
 */
export async function resolveCandidate(
    companyId: bigint,
    input: { baseUrl: string; apiKey?: string | null }
): Promise<EndpointCandidate> {
    const baseUrl = await assertEndpointUrlAllowed(input.baseUrl);
    if (typeof input.apiKey === "string" && input.apiKey.trim() !== "") {
        return { baseUrl, apiKey: input.apiKey.trim() };
    }
    if (input.apiKey === null) return { baseUrl, apiKey: null };

    const row = await getWorkspaceEndpointRow(companyId);
    if (!row?.apiKeyCiphertext) return { baseUrl, apiKey: null };
    if (row.baseUrl !== baseUrl) throw new StoredKeyMismatchError();
    return { baseUrl, apiKey: readWorkspaceEndpointKey(row) };
}
