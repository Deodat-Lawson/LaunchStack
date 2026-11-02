/**
 * What a model a workspace brings costs, as its admin says in Workspace ›
 * Bring your own keys: US dollars per 1M tokens, what their provider charges.
 * A priced model's calls show a cost and weigh against the Standard model's
 * price in usage and limits; an unpriced one counts its tokens one for one.
 *
 * Client-safe: the Settings form checks a price as it is typed, and the save
 * route checks it again with the same bounds.
 */

/** Above this a price is a typo (a per-token price pasted as per-million, an extra zero). */
export const MAX_PRICE_PER_MTOK = 10_000;

/** A finite number from 0 to {@link MAX_PRICE_PER_MTOK}. */
export function isPlausiblePrice(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= MAX_PRICE_PER_MTOK
    );
}

/** {@link MAX_PRICE_PER_MTOK} as the English sentences write it. */
export const MAX_PRICE_TEXT = MAX_PRICE_PER_MTOK.toLocaleString("en-US");
