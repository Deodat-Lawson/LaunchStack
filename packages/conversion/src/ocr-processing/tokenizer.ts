/**
 * Token counting for chunk budgets.
 *
 * Budgets used to be characters divided by four. For English prose that is
 * close; for the content this corpus actually holds — outlines dense with
 * punctuation and indentation, code, tables, CJK text — it drifts, always in
 * the direction of chunks larger than intended, and nothing then enforced the
 * embedding model's real input limit. The same estimate was also written to
 * `token_count` and billed against.
 *
 * So: a real tokenizer when one can be loaded, the estimate as a declared
 * fallback. Loading is lazy and failure is never fatal — an ingestion run
 * must not die because a BPE table could not be read.
 */

export interface TokenCounter {
    count(text: string): number;
    /** `tiktoken:<encoding>` or `estimate:<chars-per-token>`, for logs and stored provenance. */
    readonly id: string;
    /** False when this is the character estimate rather than a real tokenizer. */
    readonly exact: boolean;
}

/** The fallback: the historical estimate, now explicitly labelled as one. */
export function estimateCounter(charsPerToken = 4): TokenCounter {
    return {
        id: `estimate:${charsPerToken}`,
        exact: false,
        count: (text: string) => Math.ceil(text.length / charsPerToken),
    };
}

/**
 * Which BPE encoding a model uses. Only the families this deployment can be
 * configured with are listed; anything unknown falls back to `cl100k_base`,
 * whose counts are within a few percent for most modern tokenizers and is
 * still far closer than dividing by four.
 */
function encodingFor(model: string): "cl100k_base" | "o200k_base" {
    const name = model.toLowerCase();
    if (name.includes("gpt-4o") || name.includes("o200k") || name.includes("text-embedding-4")) {
        return "o200k_base";
    }
    return "cl100k_base";
}

const cache = new Map<string, TokenCounter>();

/**
 * The BPE table for an encoding. Imported by name rather than by an
 * interpolated path so the two possibilities are statically resolvable and
 * a bundler can see them.
 */
async function loadRanks(encoding: "cl100k_base" | "o200k_base") {
    if (encoding === "o200k_base") {
        return (await import("js-tiktoken/ranks/o200k_base")).default;
    }
    return (await import("js-tiktoken/ranks/cl100k_base")).default;
}

/**
 * A tokenizer-backed counter for `model`, or the estimate when the tokenizer
 * cannot be loaded. Cached per encoding: the BPE tables are megabytes and the
 * ingestion path counts thousands of strings per document.
 */
export async function tokenCounterFor(model: string, charsPerToken = 4): Promise<TokenCounter> {
    const encoding = encodingFor(model);
    const cached = cache.get(encoding);
    if (cached) return cached;

    try {
        // Imported dynamically so a tokenizer failure degrades to the estimate
        // instead of breaking the module graph at load time.
        const { Tiktoken } = await import("js-tiktoken/lite");
        const encoder = new Tiktoken(await loadRanks(encoding));
        const counter: TokenCounter = {
            id: `tiktoken:${encoding}`,
            exact: true,
            count: (text: string) => {
                if (text.length === 0) return 0;
                try {
                    return encoder.encode(text).length;
                } catch {
                    // Lone surrogates and other malformed input can throw;
                    // one bad string must not fail the document.
                    return Math.ceil(text.length / charsPerToken);
                }
            },
        };
        cache.set(encoding, counter);
        console.log(`[Tokenizer] Using ${counter.id} for model "${model}"`);
        return counter;
    } catch (error) {
        console.warn(
            `[Tokenizer] Could not load a tokenizer for "${model}" (${String(error)}); ` +
                `falling back to a ${charsPerToken} chars-per-token estimate.`
        );
        const fallback = estimateCounter(charsPerToken);
        cache.set(encoding, fallback);
        return fallback;
    }
}

/** Reset the cache. Tests only. */
export function resetTokenCounterCache(): void {
    cache.clear();
}
