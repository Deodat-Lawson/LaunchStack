/**
 * Just enough of ICU MessageFormat to say which arguments and tags a message
 * uses, so the catalogue test can check that a translation asks for the same
 * values as the English it replaces. Throws on unbalanced braces. Formatting
 * itself is next-intl's.
 */

export interface MessageShape {
    /** `{name}`, `{count, plural, …}` — every argument, at any depth. */
    arguments: Set<string>;
    /** `<link>…</link>` — rich-text tags. */
    tags: Set<string>;
}

export function messageShape(message: string): MessageShape {
    const shape: MessageShape = { arguments: new Set(), tags: new Set() };
    const end = parseText(message, 0, false, shape);
    if (end !== message.length) throw new Error(`Unexpected "}" at ${end} in: ${message}`);
    return shape;
}

const TAG = /<\/?([A-Za-z][\w-]*)\s*\/?>/g;

/** Text up to an unquoted `{` (an argument) or, inside a case, its closing `}`. */
function parseText(s: string, start: number, inCase: boolean, shape: MessageShape): number {
    let i = start;
    let text = "";
    while (i < s.length) {
        const ch = s[i]!;
        if (ch === "'") {
            // '' is a literal quote; '{…}' quotes syntax characters.
            if (s[i + 1] === "'") {
                i += 2;
                continue;
            }
            if (s[i + 1] === "{" || s[i + 1] === "}" || s[i + 1] === "#") {
                const close = s.indexOf("'", i + 1);
                i = close === -1 ? s.length : close + 1;
                continue;
            }
        }
        if (ch === "{") {
            collectTags(text, shape);
            text = "";
            i = parseArgument(s, i + 1, shape);
            continue;
        }
        if (ch === "}") {
            if (!inCase) return i;
            break;
        }
        text += ch;
        i++;
    }
    collectTags(text, shape);
    return i;
}

function collectTags(text: string, shape: MessageShape): void {
    for (const match of text.matchAll(TAG)) shape.tags.add(match[1]!);
}

function parseArgument(s: string, start: number, shape: MessageShape): number {
    let i = start;
    const nameEnd = findAny(s, i, ",}");
    const name = s.slice(i, nameEnd).trim();
    if (!name) throw new Error(`Empty argument at ${start} in: ${s}`);
    shape.arguments.add(name);
    i = nameEnd;
    if (s[i] === "}") return i + 1;
    i++;
    const typeEnd = findAny(s, i, ",}");
    const type = s.slice(i, typeEnd).trim();
    i = typeEnd;
    if (s[i] === "}") return i + 1;
    i++;
    if (type === "plural" || type === "select" || type === "selectordinal") {
        while (i < s.length) {
            while (/\s/.test(s[i] ?? "")) i++;
            if (s[i] === "}") return i + 1;
            const keyEnd = findAny(s, i, "{ \t\n");
            const key = s.slice(i, keyEnd);
            i = keyEnd;
            while (/\s/.test(s[i] ?? "")) i++;
            if (key.startsWith("offset:")) continue;
            if (s[i] !== "{") throw new Error(`Expected "{" after "${key}" in: ${s}`);
            i = parseText(s, i + 1, true, shape);
            if (s[i] !== "}") throw new Error(`Unclosed case "${key}" in: ${s}`);
            i++;
        }
        throw new Error(`Unclosed ${type} in: ${s}`);
    }
    // number/date/time styles: skip to the argument's own closing brace.
    let depth = 1;
    while (i < s.length && depth > 0) {
        if (s[i] === "{") depth++;
        else if (s[i] === "}") depth--;
        i++;
    }
    if (depth !== 0) throw new Error(`Unclosed argument in: ${s}`);
    return i;
}

function findAny(s: string, from: number, chars: string): number {
    for (let i = from; i < s.length; i++) if (chars.includes(s[i]!)) return i;
    throw new Error(`Unterminated argument in: ${s}`);
}
