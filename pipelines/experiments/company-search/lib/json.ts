/**
 * Result files are read by people and diffed in review: objects are indented,
 * but a list of plain values (a curve, a list of words) stays on one line.
 */
export function stringifyResults(value: unknown): string {
    const pretty = JSON.stringify(value, null, 2);
    const flat = pretty.replace(
        /\[\n\s+((?:-?\d[\d.eE+-]*|"(?:[^"\\]|\\.)*"|null|true|false)(?:,\n\s+(?:-?\d[\d.eE+-]*|"(?:[^"\\]|\\.)*"|null|true|false))*)\n\s+\]/g,
        (_, inner: string) => `[${inner.replace(/,\n\s+/g, ", ")}]`
    );
    return `${flat}\n`;
}
