/**
 * String helpers.
 *
 * `??` cannot express "fall back when blank" — an empty string is not nullish —
 * and blank-vs-absent is the distinction that matters everywhere a user types a
 * title, folder or label. These two functions keep that intent explicit.
 */

/** Trimmed value, or `undefined` when it is missing or blank. */
export function nonEmpty(value: string | null | undefined): string | undefined {
    const trimmed = value?.trim();
    if (trimmed === undefined || trimmed === "") return undefined;
    return trimmed;
}

/** Trimmed value, or `fallback` when it is missing or blank. */
export function trimmedOr(value: string | null | undefined, fallback: string): string {
    return nonEmpty(value) ?? fallback;
}
