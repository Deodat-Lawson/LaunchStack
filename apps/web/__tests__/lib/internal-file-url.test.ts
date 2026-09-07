import {
    buildInternalFileUrl,
    isInternalFileUrl,
    originsEqual,
    parseInternalFileId,
} from "@launchstack/store/crypto";

describe("internal file URL helpers", () => {
    it.each([
        ["/api/files/123", 123],
        ["/api/files/123/", 123],
        ["/api/files/123?download=1", 123],
        ["https://app.example/api/files/123/", 123],
        ["https://evil.example/api/files/123?download=1", 123],
    ])("parses the file id from %s", (url, expectedId) => {
        expect(parseInternalFileId(url)).toBe(expectedId);
    });

    it.each([
        "/api/files/123/extra",
        "/api/files/123abc",
        "https://app.example/x/api/files/123",
        "https://app.example/api/files/123-suffix",
    ])("rejects non-canonical internal file paths: %s", url => {
        expect(parseInternalFileId(url)).toBeNull();
    });

    it("builds a canonical URL from the configured app origin", () => {
        expect(buildInternalFileUrl("https://app.example/dashboard", 123)).toBe(
            "https://app.example/api/files/123"
        );
    });

    it("rejects non-HTTP app origins", () => {
        expect(() => buildInternalFileUrl("ftp://app.example", 123)).toThrow(/HTTP origin/);
    });

    it("compares origins exactly", () => {
        expect(originsEqual("https://app.example/api/files/123", "https://app.example")).toBe(true);
        expect(originsEqual("https://app.example.evil/api/files/123", "https://app.example")).toBe(
            false
        );
        expect(originsEqual("http://app.example/api/files/123", "https://app.example")).toBe(false);
    });

    it("accepts relative and configured-origin internal URLs only", () => {
        expect(isInternalFileUrl("/api/files/123", "https://app.example")).toBe(true);
        expect(isInternalFileUrl("https://app.example/api/files/123/", "https://app.example")).toBe(
            true
        );
        expect(isInternalFileUrl("https://evil.example/api/files/123", "https://app.example")).toBe(
            false
        );
    });
});
