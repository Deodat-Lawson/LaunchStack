/**
 * LinkedIn "little text" — the format of a post's `commentary`. Reserved
 * characters must be backslash-escaped even outside templates; mentions are
 * `@[Name](urn:li:organization:123)` and hashtags `{hashtag|\#|tag}`.
 *
 * The stand-in renders it the way a reader on LinkedIn would see it and
 * reports reserved characters the client forgot to escape — the real
 * network silently mangles or truncates those posts.
 */

export const LITTLE_TEXT_RESERVED = "|{}@[]()<>#\\*_~";

const HASHTAG = /^\{hashtag\|\\#\|([^}]*)\}/;
const MENTION = /^@\[((?:\\.|[^\]\\])*)\]\((urn:li:(?:person|organization|company):[^)\s]+)\)/;

export interface LittleTextResult {
    /** What a reader sees. */
    text: string;
    /** One line per unescaped reserved character. */
    issues: string[];
}

function unescape(text: string): string {
    return text.replace(/\\(.)/g, "$1");
}

export function renderLittleText(raw: string): LittleTextResult {
    let text = "";
    const issues: string[] = [];
    let i = 0;
    while (i < raw.length) {
        const c = raw[i]!;
        if (c === "\\") {
            if (i + 1 < raw.length) {
                text += raw[i + 1];
                i += 2;
            } else {
                issues.push(`Trailing unescaped "\\" at ${i}`);
                i += 1;
            }
            continue;
        }
        if (c === "{") {
            const tag = HASHTAG.exec(raw.slice(i));
            if (tag) {
                text += `#${tag[1]}`;
                i += tag[0].length;
                continue;
            }
        }
        if (c === "@") {
            const mention = MENTION.exec(raw.slice(i));
            if (mention) {
                text += unescape(mention[1]!);
                i += mention[0].length;
                continue;
            }
        }
        if (LITTLE_TEXT_RESERVED.includes(c)) {
            issues.push(
                `Unescaped "${c}" at ${i} — LinkedIn requires "\\${c}"; unescaped, the post can be cut off here`
            );
        }
        text += c;
        i += 1;
    }
    return { text, issues };
}

/** Escape plain text for `commentary` (what a correct client does). */
export function escapeLittleText(plain: string): string {
    let out = "";
    for (const c of plain) out += LITTLE_TEXT_RESERVED.includes(c) ? `\\${c}` : c;
    return out;
}
