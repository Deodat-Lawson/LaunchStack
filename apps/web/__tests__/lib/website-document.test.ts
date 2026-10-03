import {
    MIN_READABLE_WORDS,
    WEBSITE_DOCUMENT_KIND,
    hasReadableText,
    visibleWordCount,
    websiteDocumentMarker,
    websiteHost,
    websiteMarkerOf,
    wordCount,
} from "~/lib/website-document";
import { getDocumentDisplayType } from "~/app/employer/documents/types/document";

/**
 * A saved web page is an ordinary source with a marker in its `ocrMetadata`
 * (its creation key is stored hashed, so nothing else says what it is), and
 * it is kept only when the page had text on it. Both decide what people see:
 * the website viewer instead of a white sandboxed frame, and no empty sources.
 */
describe("website document", () => {
    it("round-trips what the importers write", () => {
        const marker = websiteDocumentMarker({
            url: "https://acme.com/",
            capturedAt: new Date("2026-10-17T12:00:00Z"),
        });
        expect(marker).toEqual({
            kind: WEBSITE_DOCUMENT_KIND,
            url: "https://acme.com/",
            capturedAt: "2026-10-17T12:00:00.000Z",
        });
        // OCR completion merges its own fields beside the marker.
        expect(websiteMarkerOf({ ...marker, totalChunks: 6 })).toEqual(marker);
    });

    it("ignores rows that are not saved pages, and an address that is not a web page", () => {
        expect(websiteMarkerOf(null)).toBeNull();
        expect(websiteMarkerOf([WEBSITE_DOCUMENT_KIND])).toBeNull();
        expect(websiteMarkerOf({ kind: "claude-artifact", sourceUrl: "https://x.com" })).toBeNull();
        expect(websiteMarkerOf({ kind: WEBSITE_DOCUMENT_KIND })).toBeNull();
        expect(
            websiteMarkerOf({ kind: WEBSITE_DOCUMENT_KIND, url: "javascript:alert(1)" })
        ).toBeNull();
        expect(websiteMarkerOf({ kind: WEBSITE_DOCUMENT_KIND, url: "https://acme.com" })).toEqual({
            kind: WEBSITE_DOCUMENT_KIND,
            url: "https://acme.com/",
            capturedAt: null,
        });
    });

    it("names a site by its host, without www", () => {
        expect(websiteHost("https://www.acme.com/about")).toBe("acme.com");
        expect(websiteHost("https://docs.acme.com/")).toBe("docs.acme.com");
        expect(websiteHost("not a url")).toBe("not a url");
    });

    it("opens a saved page as a website, whatever its stored file is", () => {
        const stored = { url: "/api/files/9", title: "Acme — Rockets", mimeType: "text/html" };
        expect(getDocumentDisplayType(stored)).toBe("text");
        expect(
            getDocumentDisplayType({
                ...stored,
                ocrMetadata: { ...websiteDocumentMarker({ url: "https://acme.com/" }) },
            })
        ).toBe("website");
    });

    it("counts words in running text, and each CJK character as one", () => {
        expect(wordCount("We make rockets — fast, cheap & reusable.")).toBe(6);
        expect(wordCount("2026 · 42 · ---")).toBe(0);
        expect(wordCount("我们制造火箭")).toBe(6);
    });

    it("counts only what a reader sees with scripts off", () => {
        const shell =
            "<html><head><title>Acme — the rocket company for small teams</title>" +
            "<style>body{font-family:Inter}</style></head>" +
            "<body><noscript>You need to enable JavaScript to run this app.</noscript>" +
            '<div id="root"></div><script>window.__DATA__={"words":"many many many"}</script>' +
            "<!-- a comment with words in it --></body></html>";
        expect(visibleWordCount(shell)).toBe(0);
        expect(hasReadableText(shell)).toBe(false);
    });

    it("keeps a real homepage, however short", () => {
        const copy = Array.from({ length: MIN_READABLE_WORDS }, (_, i) => `word${i}`).join(" ");
        const page = `<html><head><title>Acme</title></head><body><header><h1>${copy}</h1></header></body></html>`;
        expect(visibleWordCount(page)).toBe(MIN_READABLE_WORDS);
        expect(hasReadableText(page)).toBe(true);
        expect(hasReadableText(page.replace("word0 ", ""))).toBe(false);
    });
});
