import { describe, expect, it } from "vitest";
import { generationModelMetadataV1 } from "./generation-metadata-v1";

const ciphertext = Buffer.concat([Buffer.from([1]), Buffer.alloc(35, 7)]).toString("base64");
const envelope = {
    schemaVersion: "encrypted-vantage-context-demo/v1",
    version: 3,
    keyVersion: 1,
    ciphertext,
};
describe("native generation metadata isolation", () => {
    it("retains only the existing encrypted sidecar envelope, without old provider or arbitrary fields", () => {
        const previous = {
            mode: "ai",
            oldProvider: "obsolete",
            vantageContextDemoV1: { ...envelope, plaintext: "must not copy" },
        };
        const generated = {
            mode: "rules",
            promptVersion: "current",
            vantageContextDemoV1: { plaintext: "injected" },
        };
        expect(generationModelMetadataV1(generated, previous)).toEqual({
            mode: "rules",
            promptVersion: "current",
            vantageContextDemoV1: envelope,
        });
        expect(previous.vantageContextDemoV1.plaintext).toBe("must not copy");
        expect(generated.vantageContextDemoV1.plaintext).toBe("injected");
    });
    it.each([
        null,
        { ...envelope, schemaVersion: "plaintext" },
        { ...envelope, version: 0 },
        { ...envelope, keyVersion: 2 },
        { ...envelope, ciphertext: "human review plaintext" },
        { ...envelope, ciphertext: Buffer.alloc(35).toString("base64") },
        { ...envelope, ciphertext: "AQ==" },
    ])("does not copy malformed or plaintext namespace %j", invalid => {
        expect(
            generationModelMetadataV1(
                { mode: "rules", vantageContextDemoV1: envelope },
                { vantageContextDemoV1: invalid }
            )
        ).toEqual({ mode: "rules" });
    });
    it("keeps ordinary native generation metadata when no encrypted namespace exists", () => {
        expect(
            generationModelMetadataV1({ mode: "rules", usage: { totalTokens: 0 } }, null)
        ).toEqual({ mode: "rules", usage: { totalTokens: 0 } });
    });
});
