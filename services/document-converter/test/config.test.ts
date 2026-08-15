import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const validEnv = {
    CONVERTER_API_KEY: "secret",
    ALLOWED_FETCH_ORIGINS: "http://app:3000",
};

describe("loadConfig", () => {
    it("applies documented defaults", () => {
        const config = loadConfig(validEnv);
        expect(config.port).toBe(8002);
        expect(config.doclingServeTimeoutMs).toBe(600_000);
        expect(config.maxFetchBytes).toBe(104_857_600);
        expect(config.fetchTimeoutMs).toBe(120_000);
        expect(config.doclingServeUrl).toBeUndefined();
        expect(config.allowedFetchOrigins).toEqual(["http://app:3000"]);
    });

    it("refuses to start without CONVERTER_API_KEY, explaining why", () => {
        expect(() => loadConfig({ ALLOWED_FETCH_ORIGINS: "http://app:3000" })).toThrowError(
            /CONVERTER_API_KEY/
        );
        expect(() => loadConfig({ ALLOWED_FETCH_ORIGINS: "http://app:3000" })).toThrowError(
            /fails closed/
        );
    });

    it("treats an empty CONVERTER_API_KEY as unset (fail closed)", () => {
        expect(() => loadConfig({ ...validEnv, CONVERTER_API_KEY: "  " })).toThrowError(
            /CONVERTER_API_KEY/
        );
    });

    it("requires ALLOWED_FETCH_ORIGINS", () => {
        expect(() => loadConfig({ CONVERTER_API_KEY: "k" })).toThrowError(/ALLOWED_FETCH_ORIGINS/);
    });

    it("normalizes allowlist entries to origins and drops duplicates", () => {
        const config = loadConfig({
            ...validEnv,
            ALLOWED_FETCH_ORIGINS:
                "http://app:3000/some/path, https://S3.internal:9000/bucket ,http://app:3000",
        });
        expect(config.allowedFetchOrigins).toEqual(["http://app:3000", "https://s3.internal:9000"]);
    });

    it("rejects non-http(s) allowlist entries", () => {
        expect(() =>
            loadConfig({ ...validEnv, ALLOWED_FETCH_ORIGINS: "file:///etc" })
        ).toThrowError(/only http and https/);
    });

    it("rejects OCR_DEFAULT_PROVIDER=MARKER with an actionable message naming DOCLING", () => {
        const attempt = () => loadConfig({ ...validEnv, OCR_DEFAULT_PROVIDER: "MARKER" });
        expect(attempt).toThrowError(/MARKER/);
        expect(attempt).toThrowError(/DOCLING/);
    });

    it("rejects unknown providers, listing the valid ones", () => {
        expect(() => loadConfig({ ...validEnv, OCR_DEFAULT_PROVIDER: "TESSERACT" })).toThrowError(
            /DOCLING, NATIVE_PDF, AZURE, LANDING_AI, DATALAB/
        );
    });

    it("accepts a valid provider case-insensitively", () => {
        const config = loadConfig({
            ...validEnv,
            OCR_DEFAULT_PROVIDER: "landing_ai",
        });
        expect(config.defaultProvider).toBe("LANDING_AI");
    });

    it("lists EVERY invalid field in one readable error", () => {
        const attempt = () =>
            loadConfig({
                PORT: "not-a-number",
                OCR_DEFAULT_PROVIDER: "MARKER",
                DOCLING_SERVE_URL: "not a url",
            });
        expect(attempt).toThrowError(/PORT/);
        expect(attempt).toThrowError(/CONVERTER_API_KEY/);
        expect(attempt).toThrowError(/ALLOWED_FETCH_ORIGINS/);
        expect(attempt).toThrowError(/OCR_DEFAULT_PROVIDER/);
        expect(attempt).toThrowError(/DOCLING_SERVE_URL/);
    });

    it("strips trailing slashes from DOCLING_SERVE_URL", () => {
        const config = loadConfig({
            ...validEnv,
            DOCLING_SERVE_URL: "http://docling-serve:5001/",
        });
        expect(config.doclingServeUrl).toBe("http://docling-serve:5001");
    });

    it("parses numeric overrides", () => {
        const config = loadConfig({
            ...validEnv,
            PORT: "9100",
            MAX_FETCH_BYTES: "1024",
            DOCLING_SERVE_TIMEOUT_MS: "1000",
        });
        expect(config.port).toBe(9100);
        expect(config.maxFetchBytes).toBe(1024);
        expect(config.doclingServeTimeoutMs).toBe(1000);
    });
});
