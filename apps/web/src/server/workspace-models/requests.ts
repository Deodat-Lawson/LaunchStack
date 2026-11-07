/**
 * Request shapes for the workspace model routes, and the one rule they share:
 * a stored key is only ever sent to the address it was saved with. Testing or
 * listing a *different* address needs the key typed again, so a saved key
 * can't be pointed at a server someone else chose.
 */

import { z } from "zod";

import { MAX_OFFERED_LABEL_CHARS, MAX_OFFERED_MODELS } from "~/lib/ai/model-picks";
import { MODEL_PROVIDER_IDS } from "~/lib/ai/model-providers";

import type { OfferedDraft, SelectionDraft } from "./config";
import { assertEndpointUrlAllowed } from "./endpoint-url";
import type { EndpointCandidate } from "./probe";
import { getWorkspaceEndpointRow, readWorkspaceEndpointKey } from "./store";

/**
 * A price as typed, US dollars per 1M tokens. Loose on purpose: a missing
 * side or a number out of bounds is refused by `selectionProblem`, which says
 * which in words; a schema refusal can only say the setup isn't valid. Null
 * or absent fields are empty ones, and a price left all empty is no price.
 */
const pricingSchema = z
    .object({
        input: z.number().nullable().optional(),
        output: z.number().nullable().optional(),
        cachedInput: z.number().nullable().optional(),
    })
    .strict();

const choiceSchema = z
    .object({
        id: z.string().trim().min(1).max(200),
        vision: z.boolean(),
        reasoning: z.boolean(),
        structuredOutput: z.boolean().optional(),
        pricing: pricingSchema.nullable().optional(),
    })
    .strict();

/**
 * A model offered in Ask. Loose on length and count for the same reason as
 * prices: `offeredListProblem` says what is wrong in words. The bounds here
 * only stop a request nobody's form would send.
 */
const offeredSchema = z
    .object({
        id: z.string().trim().min(1).max(200),
        key: z.string().max(40).optional(),
        label: z.string().max(MAX_OFFERED_LABEL_CHARS * 4),
        vision: z.boolean(),
        reasoning: z.boolean(),
        structuredOutput: z.boolean().optional(),
        pricing: pricingSchema.nullable().optional(),
    })
    .strict() satisfies z.ZodType<OfferedDraft>;

const offeredListSchema = z.array(offeredSchema).max(MAX_OFFERED_MODELS * 4);

/**
 * `offered` absent keeps what is offered: the API keys screen saves the four
 * routes and knows nothing of the list Models keeps.
 */
export const selectionSchema = z
    .object({
        default: choiceSchema,
        fast: choiceSchema.optional(),
        reasoning: choiceSchema.optional(),
        vision: choiceSchema.optional(),
        offered: offeredListSchema.optional(),
    })
    .strict() satisfies z.ZodType<SelectionDraft>;

/** Models & usage › Models saves the offered list on its own. */
export const saveOfferedSchema = z.object({ offered: offeredListSchema }).strict();

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
