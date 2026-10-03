/**
 * Tolerant JSON extraction from model replies: plain JSON, fenced JSON, or
 * JSON with prose around it.
 */

export function extractJson(text: string): unknown {
    const trimmed = text.trim();
    const attempts = [trimmed];
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
    if (fenced?.[1]) attempts.push(fenced[1].trim());
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace)
        attempts.push(trimmed.slice(firstBrace, lastBrace + 1));
    for (const candidate of attempts) {
        try {
            return JSON.parse(candidate) as unknown;
        } catch {
            // try the next shape
        }
    }
    return undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

export function asString(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    return undefined;
}

export function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

export function asNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))
        return Number(value);
    return undefined;
}

export function clampStance(value: unknown, fallback: number): -2 | -1 | 0 | 1 | 2 {
    const n = asNumber(value);
    const v = n === undefined ? fallback : Math.round(n);
    return Math.max(-2, Math.min(2, v)) as -2 | -1 | 0 | 1 | 2;
}
