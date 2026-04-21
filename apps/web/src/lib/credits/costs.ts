/**
 * Legacy re-export shim. The cost constants + calculators + TokenService
 * enum now live in @launchstack/core/credits so features can use them
 * without reaching back into apps/web. TOKEN_SIGNUP_BONUS stays here
 * because it reads process.env at import time, which is apps/web policy.
 */

export type { TokenService } from "@launchstack/core/credits";
export {
    TOKEN_COSTS,
    embeddingTokens,
    llmChatTokens,
    transcriptionTokens,
    estimateTranscriptionTokens,
    ocrTokens,
    ocrProviderToTokenKey,
} from "@launchstack/core/credits";

/** Default signup bonus: 10 million tokens */
export const TOKEN_SIGNUP_BONUS = parseInt(
    process.env.TOKEN_SIGNUP_BONUS ?? "10000000",
    10,
);
