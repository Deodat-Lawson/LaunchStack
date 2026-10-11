/**
 * LinkedIn's Posts API reads `commentary` as "little text format": the
 * characters below are markup, and an unescaped one makes LinkedIn truncate
 * the post at that point or reject it. Every reserved character is
 * backslash-escaped, so what the author typed is what LinkedIn shows.
 *
 * Hashtags (`#launch`) become LinkedIn's hashtag template
 * (`{hashtag|\#|launch}`) so they stay clickable, the form LinkedIn's own
 * little-format docs use; a `#` that does not start a word (`#1`, `a#b`,
 * `/#/`) is escaped like any other reserved character.
 * https://learn.microsoft.com/linkedin/marketing/community-management/shares/little-text-format
 */

const RESERVED = /[\\|{}@[\]()<>#*_~]/g;

/** `#` at a word start, followed by a word holding at least one letter. */
const HASHTAG = /(?<![\p{L}\p{N}_&\\/])#((?=[\p{N}_]*\p{L})[\p{L}\p{N}_]+)/gu;

function escapeReserved(text: string): string {
    return text.replace(RESERVED, ch => `\\${ch}`);
}

export function escapeLinkedInCommentary(
    text: string,
    options: { hashtags?: boolean } = {}
): string {
    if (options.hashtags === false) return escapeReserved(text);

    let out = "";
    let last = 0;
    for (const match of text.matchAll(HASHTAG)) {
        const start = match.index;
        const tag = match[1]!;
        out += escapeReserved(text.slice(last, start));
        out += `{hashtag|\\#|${escapeReserved(tag)}}`;
        last = start + 1 + tag.length;
    }
    return out + escapeReserved(text.slice(last));
}
