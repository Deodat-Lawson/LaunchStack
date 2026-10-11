/**
 * Bluesky post text rules: length is counted in graphemes (300) and bytes
 * (3000), and links and hashtags are only clickable when the record carries
 * `facets` that point at them by UTF-8 byte offsets.
 * https://docs.bsky.app/docs/advanced-guides/post-richtext
 */

export const BLUESKY_MAX_GRAPHEMES = 300;
export const BLUESKY_MAX_TEXT_BYTES = 3000;

const encoder = new TextEncoder();

export function utf8Length(text: string): number {
    return encoder.encode(text).length;
}

let segmenter: Intl.Segmenter | null = null;

/** User-perceived characters: one emoji, flag or accented letter counts once. */
export function graphemeLength(text: string): number {
    segmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text)).length;
}

export type FacetFeature =
    | { $type: "app.bsky.richtext.facet#link"; uri: string }
    | { $type: "app.bsky.richtext.facet#tag"; tag: string };

export interface Facet {
    index: { byteStart: number; byteEnd: number };
    features: FacetFeature[];
}

/** An http(s) URL at the start of the text or after whitespace or an opening bracket/quote. */
const URL_PATTERN = /(?<=^|[\s(["'“‘])https?:\/\/[^\s<>"]+/giu;
const TRAILING_PUNCTUATION = /[.,;:!?'"”’]+$/u;

/** A `#` or `＃` after whitespace (or at the start), then a tag that is not only digits. */
const TAG_PATTERN = /(?<=^|\s)[#＃]([^\s#＃]*[^\d\s\p{P}][^\s#＃]*)/gu;
const MAX_TAG_LENGTH = 64;

/** Link and hashtag facets for `text`, ordered by position. */
export function detectFacets(text: string): Facet[] {
    const facets: Facet[] = [];
    const span = (start: number, length: number) => {
        const byteStart = utf8Length(text.slice(0, start));
        return { byteStart, byteEnd: byteStart + utf8Length(text.slice(start, start + length)) };
    };

    for (const match of text.matchAll(URL_PATTERN)) {
        let uri = match[0];
        for (;;) {
            const before = uri;
            uri = uri.replace(TRAILING_PUNCTUATION, "");
            // A closing bracket belongs to the sentence unless the URL opened one.
            if (uri.endsWith(")") && !uri.includes("(")) uri = uri.slice(0, -1);
            if (uri === before) break;
        }
        if (!/^https?:\/\/[^/?#\s]+\.[^/?#\s]+/i.test(uri)) continue;
        facets.push({
            index: span(match.index, uri.length),
            features: [{ $type: "app.bsky.richtext.facet#link", uri }],
        });
    }

    for (const match of text.matchAll(TAG_PATTERN)) {
        const tag = match[1]!.replace(/\p{P}+$/u, "");
        if (!tag || [...tag].length > MAX_TAG_LENGTH) continue;
        if (facets.some(f => overlaps(f.index, span(match.index, 1)))) continue;
        facets.push({
            index: span(match.index, 1 + tag.length),
            features: [{ $type: "app.bsky.richtext.facet#tag", tag }],
        });
    }

    return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}

function overlaps(
    a: { byteStart: number; byteEnd: number },
    b: { byteStart: number; byteEnd: number }
): boolean {
    return a.byteStart < b.byteEnd && b.byteStart < a.byteEnd;
}

/**
 * Pixel size from the image header (PNG, GIF, JPEG, WebP), or null. Bluesky
 * clients use the embed's `aspectRatio` to lay the image out before it
 * loads; without it they guess and crop.
 */
export function imageDimensions(data: Uint8Array): { width: number; height: number } | null {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const at = (i: number) => data[i] ?? -1;
    const ascii = (start: number, text: string) =>
        [...text].every((ch, i) => at(start + i) === ch.charCodeAt(0));
    const sized = (width: number, height: number) =>
        width > 0 && height > 0 ? { width, height } : null;

    try {
        // PNG: signature, then the IHDR chunk's width and height.
        if (at(0) === 0x89 && ascii(1, "PNG") && data.length >= 24) {
            return sized(view.getUint32(16), view.getUint32(20));
        }
        // GIF: logical screen size, little-endian.
        if (ascii(0, "GIF8") && data.length >= 10) {
            return sized(view.getUint16(6, true), view.getUint16(8, true));
        }
        // WebP: RIFF container with a VP8 / VP8L / VP8X chunk.
        if (ascii(0, "RIFF") && ascii(8, "WEBP") && data.length >= 30) {
            if (ascii(12, "VP8 ")) {
                return sized(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
            }
            if (ascii(12, "VP8L")) {
                const bits = view.getUint32(21, true);
                return sized((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
            }
            if (ascii(12, "VP8X")) {
                const width = 1 + (at(24) | (at(25) << 8) | (at(26) << 16));
                const height = 1 + (at(27) | (at(28) << 8) | (at(29) << 16));
                return sized(width, height);
            }
            return null;
        }
        // JPEG: walk the markers to the first start-of-frame.
        if (at(0) === 0xff && at(1) === 0xd8) {
            let offset = 2;
            while (offset + 9 < data.length) {
                if (at(offset) !== 0xff) return null;
                const marker = at(offset + 1);
                if (marker === 0xff) {
                    offset++;
                    continue;
                }
                const length = view.getUint16(offset + 2);
                const isFrame =
                    marker >= 0xc0 &&
                    marker <= 0xcf &&
                    marker !== 0xc4 &&
                    marker !== 0xc8 &&
                    marker !== 0xcc;
                if (isFrame) {
                    return sized(view.getUint16(offset + 7), view.getUint16(offset + 5));
                }
                offset += 2 + length;
            }
        }
    } catch {
        return null;
    }
    return null;
}
