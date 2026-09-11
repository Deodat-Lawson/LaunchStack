import {
    configureSecretBox,
    encryptSecret,
    decryptSecret,
    MissingSecretsKeyError,
    CiphertextDecodeError,
} from "@launchstack/store/crypto";

function setKey() {
    // Deterministic 32-byte key for tests — never use in production. The slot
    // is authoritative (ADR-002): secret-box no longer falls back to
    // process.env, so tests register the key the way the engine does.
    configureSecretBox({ key: Buffer.alloc(32, 7).toString("base64") });
}

describe("secret-box", () => {
    afterEach(() => {
        configureSecretBox({ key: undefined });
    });

    it("round-trips a typical API key", () => {
        setKey();
        const plaintext = "test-secret-" + "a".repeat(40);
        const { ciphertext, keyVersion } = encryptSecret(plaintext);
        expect(keyVersion).toBe(1);
        expect(ciphertext).not.toContain(plaintext);
        expect(decryptSecret(ciphertext)).toBe(plaintext);
    });

    it("produces different ciphertext for the same plaintext (fresh IV)", () => {
        setKey();
        const plaintext = "repeatable-key";
        const a = encryptSecret(plaintext).ciphertext;
        const b = encryptSecret(plaintext).ciphertext;
        expect(a).not.toBe(b);
        expect(decryptSecret(a)).toBe(plaintext);
        expect(decryptSecret(b)).toBe(plaintext);
    });

    it("refuses to encrypt empty plaintext", () => {
        setKey();
        expect(() => encryptSecret("")).toThrow(/empty/i);
    });

    it("throws MissingSecretsKeyError when no key is configured", () => {
        configureSecretBox({ key: undefined });
        expect(() => encryptSecret("anything")).toThrow(MissingSecretsKeyError);
    });

    it("rejects tampered ciphertext", () => {
        setKey();
        const { ciphertext } = encryptSecret("protected-value");
        // Flip a byte in the middle of the payload.
        const bytes = Buffer.from(ciphertext, "base64");
        bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
        const tampered = bytes.toString("base64");
        expect(() => decryptSecret(tampered)).toThrow(CiphertextDecodeError);
    });

    it("rejects payload that decodes to too few bytes", () => {
        setKey();
        expect(() => decryptSecret("dG9vc2hvcnQ=")).toThrow(CiphertextDecodeError);
    });
});
