/**
 * The trimmed text, or undefined when it is missing or blank, so a blank
 * value falls through a `??` the same way a missing one does.
 */
export function nonBlank(value: string | null | undefined): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    return trimmed;
}
