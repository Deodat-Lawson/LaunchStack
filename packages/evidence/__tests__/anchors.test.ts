import { describe, expect, it } from "vitest";

import {
    anchorKey,
    isValidAnchorSpan,
    isValidCitationAnchor,
    parseAnchorKey,
    type CitationAnchor,
} from "../src/index";

const pageAnchor: CitationAnchor = {
    sourceId: 12,
    sourceVersionId: 34,
    span: { kind: "page", page: 5 },
};

describe("anchorKey", () => {
    it("builds the documented forms for all three span kinds", () => {
        expect(anchorKey(pageAnchor)).toBe("src:12/ver:34/page:5");
        expect(
            anchorKey({
                sourceId: 12,
                sourceVersionId: 34,
                span: { kind: "page", page: 5, endPage: 8 },
            })
        ).toBe("src:12/ver:34/page:5-8");
        expect(
            anchorKey({
                sourceId: 12,
                sourceVersionId: 34,
                span: { kind: "time", startSeconds: 12.5, endSeconds: 31.2 },
            })
        ).toBe("src:12/ver:34/time:12.5-31.2");
        expect(
            anchorKey({
                sourceId: 12,
                sourceVersionId: 34,
                span: { kind: "char", start: 100, end: 250 },
            })
        ).toBe("src:12/ver:34/char:100-250");
    });

    it("ignores chunkId and quote", () => {
        expect(anchorKey({ ...pageAnchor, chunkId: 991, quote: "some quoted text" })).toBe(
            anchorKey(pageAnchor)
        );
    });

    it("collapses endPage === page to the single-page form", () => {
        expect(
            anchorKey({
                sourceId: 12,
                sourceVersionId: 34,
                span: { kind: "page", page: 5, endPage: 5 },
            })
        ).toBe("src:12/ver:34/page:5");
    });

    it("throws on invalid anchors instead of producing malformed keys", () => {
        expect(() =>
            anchorKey({
                sourceId: 12,
                sourceVersionId: 34,
                span: { kind: "page", page: 8, endPage: 5 },
            })
        ).toThrow(RangeError);
        expect(() => anchorKey({ ...pageAnchor, sourceId: 0 })).toThrow(RangeError);
        expect(() =>
            anchorKey({
                sourceId: 12,
                sourceVersionId: 34,
                span: { kind: "time", startSeconds: 31.2, endSeconds: 12.5 },
            })
        ).toThrow(RangeError);
    });
});

describe("parseAnchorKey round-trips", () => {
    const anchors: CitationAnchor[] = [
        pageAnchor,
        {
            sourceId: 12,
            sourceVersionId: 34,
            span: { kind: "page", page: 5, endPage: 8 },
        },
        {
            sourceId: 1,
            sourceVersionId: 2,
            span: { kind: "time", startSeconds: 12.5, endSeconds: 31.2 },
        },
        {
            sourceId: 7,
            sourceVersionId: 9,
            span: { kind: "time", startSeconds: 0, endSeconds: 0.30000000000000004 },
        },
        {
            sourceId: 12,
            sourceVersionId: 34,
            span: { kind: "char", start: 100, end: 250 },
        },
        {
            sourceId: 3,
            sourceVersionId: 4,
            span: { kind: "char", start: 0, end: 0 },
        },
    ];

    it.each(anchors.map(a => [anchorKey(a), a] as const))(
        "anchor -> key -> anchor for %s",
        (key, anchor) => {
            expect(parseAnchorKey(key)).toEqual({
                sourceId: anchor.sourceId,
                sourceVersionId: anchor.sourceVersionId,
                span: anchor.span,
            });
        }
    );

    it.each(anchors.map(a => [anchorKey(a)] as const))("key -> anchor -> key for %s", key => {
        expect(anchorKey(parseAnchorKey(key)!)).toBe(key);
    });

    it("preserves float precision in time spans", () => {
        const parsed = parseAnchorKey("src:1/ver:2/time:12.5-31.2");
        expect(parsed?.span).toEqual({
            kind: "time",
            startSeconds: 12.5,
            endSeconds: 31.2,
        });
    });

    it("accepts the non-canonical equal-endpoint page form", () => {
        expect(parseAnchorKey("src:12/ver:34/page:5-5")).toEqual({
            sourceId: 12,
            sourceVersionId: 34,
            span: { kind: "page", page: 5, endPage: 5 },
        });
    });
});

describe("parseAnchorKey malformed input", () => {
    it.each([
        [""],
        ["garbage"],
        ["src:12/ver:34"],
        ["src:12/ver:34/page:5/extra"],
        ["ver:34/src:12/page:5"],
        ["src:0/ver:34/page:5"],
        ["src:-1/ver:34/page:5"],
        ["src:12/ver:34/page:0"],
        ["src:12/ver:34/page:5.5"],
        ["src:12/ver:34/page:8-5"],
        ["src:12/ver:34/line:5"],
        ["src:12/ver:34/time:12.5"],
        ["src:12/ver:34/time:31.2-12.5"],
        ["src:12/ver:34/time:-1-5"],
        ["src:12/ver:34/time:1e3-2e3"],
        ["src:12/ver:34/char:250-100"],
        ["src:12/ver:34/char:1.5-2"],
        ["src:12/ver:34/char:100"],
        ["src:12/ver:34/page:5 "],
        [" src:12/ver:34/page:5"],
        ["src:12/ver:34/page:99999999999999999999"],
        ["src:99999999999999999999/ver:34/page:5"],
    ])("returns null (never throws) for %j", key => {
        expect(parseAnchorKey(key)).toBeNull();
    });
});

describe("span validation", () => {
    it("rejects inverted ranges", () => {
        expect(isValidAnchorSpan({ kind: "page", page: 8, endPage: 5 })).toBe(false);
        expect(isValidAnchorSpan({ kind: "time", startSeconds: 31.2, endSeconds: 12.5 })).toBe(
            false
        );
        expect(isValidAnchorSpan({ kind: "char", start: 250, end: 100 })).toBe(false);
    });

    it("accepts equal endpoints", () => {
        expect(isValidAnchorSpan({ kind: "page", page: 5, endPage: 5 })).toBe(true);
        expect(isValidAnchorSpan({ kind: "time", startSeconds: 3, endSeconds: 3 })).toBe(true);
        expect(isValidAnchorSpan({ kind: "char", start: 10, end: 10 })).toBe(true);
    });

    it("rejects non-integer pages/offsets and negative or non-finite seconds", () => {
        expect(isValidAnchorSpan({ kind: "page", page: 1.5 })).toBe(false);
        expect(isValidAnchorSpan({ kind: "page", page: 0 })).toBe(false);
        expect(isValidAnchorSpan({ kind: "char", start: -1, end: 5 })).toBe(false);
        expect(isValidAnchorSpan({ kind: "char", start: 0.5, end: 5 })).toBe(false);
        expect(isValidAnchorSpan({ kind: "time", startSeconds: -0.1, endSeconds: 5 })).toBe(false);
        expect(
            isValidAnchorSpan({
                kind: "time",
                startSeconds: 0,
                endSeconds: Number.POSITIVE_INFINITY,
            })
        ).toBe(false);
    });

    it("requires positive integer ids on the full anchor", () => {
        expect(isValidCitationAnchor(pageAnchor)).toBe(true);
        expect(isValidCitationAnchor({ ...pageAnchor, sourceId: 0 })).toBe(false);
        expect(isValidCitationAnchor({ ...pageAnchor, sourceVersionId: 1.5 })).toBe(false);
    });
});
