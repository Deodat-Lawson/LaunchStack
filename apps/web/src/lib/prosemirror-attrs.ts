/**
 * Coercion for ProseMirror node attributes.
 *
 * Attributes are typed `unknown` — a node can legally carry any JSON value —
 * so both the server-side exporters and the read-only renderer need one safe
 * way to turn one into text. A bare `String()` would happily print
 * `[object Object]` into a document.
 */

/** The first value that is a usable primitive, or the empty string. */
export function attrText(...values: unknown[]): string {
    for (const value of values) {
        if (typeof value === "string") {
            if (value !== "") return value;
            continue;
        }
        if (typeof value === "number" || typeof value === "boolean") {
            return String(value);
        }
    }
    return "";
}

/** The first value that is a finite number, else `fallback`. */
export function attrNumber(value: unknown, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}
