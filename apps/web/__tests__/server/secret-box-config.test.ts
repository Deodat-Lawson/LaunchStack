import { parseSecretBoxConfiguration } from "~/server/secret-box-config";
import { configureSecretBox, encryptSecret, decryptSecret } from "@launchstack/store/crypto";

describe("encryption startup configuration", () => {
    afterEach(() => configureSecretBox({ key: undefined }));
    it("defaults to the legacy key version", () => {
        expect(parseSecretBoxConfiguration({})).toEqual({
            key: undefined,
            currentVersion: 1,
            previousKeys: {},
        });
    });
    it("restores old ciphertext after a restart with retained keys", () => {
        const key = Buffer.alloc(32, 3).toString("base64");
        configureSecretBox(parseSecretBoxConfiguration({ key }));
        const prior = encryptSecret("prior-report");
        configureSecretBox(
            parseSecretBoxConfiguration({
                key: Buffer.alloc(32, 4).toString("base64"),
                currentVersion: "2",
                previousKeys: JSON.stringify({ 1: key }),
            })
        );
        expect(decryptSecret(prior.ciphertext)).toBe("prior-report");
        expect(encryptSecret("next-report").keyVersion).toBe(2);
    });
    it.each(["{", "[]", "null", '{"invalid":"sensitive-value"}', '{"1":"sensitive-value"}'])(
        "rejects malformed key maps without echoing them",
        previousKeys => {
            expect(() =>
                parseSecretBoxConfiguration({ currentVersion: "2", key: "unused", previousKeys })
            ).toThrow(/SECRET_BOX_PREVIOUS_KEYS/);
            try {
                parseSecretBoxConfiguration({ currentVersion: "2", key: "unused", previousKeys });
            } catch (error) {
                expect((error as Error).message).not.toContain("sensitive-value");
            }
        }
    );
    it.each(["0", "256", "1.5", "NaN"])("rejects invalid active key versions", currentVersion => {
        expect(() => parseSecretBoxConfiguration({ currentVersion })).toThrow(/CURRENT_VERSION/);
    });
});
