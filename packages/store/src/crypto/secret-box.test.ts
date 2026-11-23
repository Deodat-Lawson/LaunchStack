import { createCipheriv } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
    CiphertextDecodeError,
    configureSecretBox,
    decryptSecret,
    encryptSecret,
    MissingSecretsKeyError,
} from "./secret-box";

const oldKey = Buffer.alloc(32, 7);
const newKey = Buffer.alloc(32, 9).toString("base64");

afterEach(() => configureSecretBox({ key: undefined }));

describe("secret box persisted compatibility", () => {
    it("decrypts a legacy v1 connector envelope without AAD after rotation", () => {
        const iv = Buffer.alloc(12, 3);
        const cipher = createCipheriv("aes-256-gcm", oldKey, iv);
        const body = Buffer.concat([cipher.update("connector-secret", "utf8"), cipher.final()]);
        const legacy = Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), body]);
        configureSecretBox({
            key: newKey,
            currentVersion: 2,
            previousKeys: { 1: oldKey.toString("base64") },
        });
        expect(decryptSecret(legacy.toString("base64"))).toBe("connector-secret");
        expect(encryptSecret("new-secret").keyVersion).toBe(2);
    });

    it("binds report ciphertext to its company, owner and run", () => {
        configureSecretBox({ key: newKey, currentVersion: 2 });
        const context = "company:1/owner:2/run:3";
        const { ciphertext } = encryptSecret("evidence", context);
        expect(decryptSecret(ciphertext, context)).toBe("evidence");
        expect(() => decryptSecret(ciphertext, "company:1/owner:2/run:4")).toThrow(
            CiphertextDecodeError
        );
        expect(() => decryptSecret(ciphertext)).toThrow(CiphertextDecodeError);
        const bytes = Buffer.from(ciphertext, "base64");
        bytes[0] = 3;
        expect(() => decryptSecret(bytes.toString("base64"), context)).toThrow(
            CiphertextDecodeError
        );
    });

    it("clears registered keys and leaves configuration intact on invalid version", () => {
        configureSecretBox({ key: oldKey.toString("base64") });
        const { ciphertext } = encryptSecret("connector");
        expect(() => configureSecretBox({ key: newKey, currentVersion: 256 })).toThrow();
        expect(decryptSecret(ciphertext)).toBe("connector");
        configureSecretBox({ key: undefined });
        expect(() => decryptSecret(ciphertext)).toThrow(MissingSecretsKeyError);
    });
});
