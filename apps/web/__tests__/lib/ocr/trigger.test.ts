import { parseProvider } from "@launchstack/conversion/ocr/trigger";

describe("parseProvider", () => {
    it.each(["DOCLING", "docling"])("accepts OSS provider override %s", provider => {
        expect(parseProvider(provider)).toBe(provider.toUpperCase());
    });

    // ADR-004 removed MARKER as an implementation-less alias for Docling.
    // `source-events` still rewrites historical dispatch rows that name it,
    // but the provider parser must no longer accept it as an override.
    it("rejects the removed MARKER provider", () => {
        expect(parseProvider("MARKER")).toBeUndefined();
    });
});
